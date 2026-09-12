-- Reads return explicit fields, and creation is one transaction (including questions).
CREATE FUNCTION public.casa_my_entry_v2(p_polla_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('id',id,'polla_id',polla_id,'user_id',user_id,'status',status,
    'amount_cop',amount_cop,'proof_path',proof_path,'current_proof_attempt_id',current_proof_attempt_id,
    'proof_uploaded_at',proof_uploaded_at,'reviewed_at',reviewed_at,'reject_reason',reject_reason,
    'ticket_number',ticket_number,'created_at',created_at)
  FROM public.casa_entries WHERE polla_id=p_polla_id AND user_id=p_user_id
  ORDER BY CASE status WHEN 'pagada' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'rechazada' THEN 2 ELSE 3 END,
    created_at DESC,id LIMIT 1;
$$;

CREATE FUNCTION public.casa_create_polla_v2(p_config jsonb,p_slug text,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; q jsonb; opt text; qid uuid; mid uuid; i integer:=0; j integer;
  closing timestamptz; v_count integer; v_publish boolean;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_config->>'kind' NOT IN ('partidos','manual','rifa') OR p_config->>'prizeKind' NOT IN ('pozo','objeto')
    OR length(btrim(coalesce(p_config->>'name','')))<3 OR length(coalesce(p_slug,''))<1 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  IF p_config->>'prizeKind'='objeto' AND length(btrim(coalesce(p_config->>'prizeObject','')))<3 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OBJECT_REQUIRED';
  END IF;
  closing := (p_config->>'closesAt')::timestamptz;
  IF p_config->>'kind'='partidos' THEN
    SELECT count(*),min(m.scheduled_at)-interval '5 minutes' INTO v_count,closing
      FROM public.matches m WHERE m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_config->'matchIds'));
    IF v_count<1 OR v_count>30 OR v_count<>jsonb_array_length(p_config->'matchIds') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MATCHES';
    END IF;
    IF p_config->>'closeMode'<>'auto' THEN closing := (p_config->>'closesAt')::timestamptz; END IF;
  ELSIF p_config->>'closeMode'='auto' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  IF closing IS NULL OR closing<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INSCRIPTIONS_CLOSED'; END IF;
  v_publish := coalesce((p_config->>'publish')::boolean,false);
  IF v_publish AND p_config->>'prizeKind'='objeto' AND p_config->>'kind'<>'rifa'
    AND NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING';
  END IF;
  IF v_publish AND (p_config->>'entryPriceCop')::integer>0 AND
    (nullif(btrim(p_config->>'payoutMethod'),'') IS NULL OR nullif(btrim(p_config->>'payoutAccount'),'') IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PAYMENT_ACCOUNT_REQUIRED';
  END IF;
  INSERT INTO public.casa_pollas(slug,name,description,kind,tournament,scoring_mode,entry_price_cop,house_cut_pct,
    prize_kind,prize_object,prize_image_path,points_result,points_exact,points_one_team,status,closes_at,close_mode,
    ticket_count,draw_method,payout_method,payout_account,payout_account_name,created_by)
  VALUES(p_slug,p_config->>'name',p_config->>'description',(p_config->>'kind')::public.casa_polla_kind,
    CASE WHEN p_config->>'kind'='partidos' THEN p_config->>'tournament' END,
    CASE WHEN p_config->>'kind'='partidos' THEN (p_config->>'scoringMode')::public.casa_scoring_mode END,
    (p_config->>'entryPriceCop')::integer,(p_config->>'houseCutPct')::integer,p_config->>'prizeKind',
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeObject' END,
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeImagePath' END,
    3,3,1,'borrador',closing,p_config->>'closeMode',
    CASE WHEN p_config->>'kind'='rifa' THEN (p_config->>'ticketCount')::integer END,
    CASE WHEN p_config->>'kind'='rifa' THEN p_config->>'drawMethod' END,
    p_config->>'payoutMethod',p_config->>'payoutAccount',p_config->>'payoutAccountName',p_actor_id) RETURNING * INTO p;
  IF p.kind='partidos' THEN
    FOR mid IN SELECT value::uuid FROM jsonb_array_elements_text(p_config->'matchIds') LOOP
      INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) VALUES(p.id,mid,i); i:=i+1;
    END LOOP;
  ELSIF p.kind='manual' THEN
    IF coalesce(jsonb_array_length(p_config->'questions'),0) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_QUESTIONS';
    END IF;
    FOR q IN SELECT value FROM jsonb_array_elements(p_config->'questions') LOOP
      IF q->>'inputKind'='opciones' AND coalesce(jsonb_array_length(q->'options'),0)<2 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_QUESTIONS';
      END IF;
      INSERT INTO public.casa_questions(polla_id,prompt,order_index,points,input_kind)
        VALUES(p.id,q->>'prompt',i,(q->>'points')::integer,q->>'inputKind') RETURNING id INTO qid;
      i:=i+1; j:=0;
      IF q->>'inputKind'='opciones' THEN
        FOR opt IN SELECT value FROM jsonb_array_elements_text(q->'options') LOOP
          INSERT INTO public.casa_options(question_id,label,order_index) VALUES(qid,opt,j); j:=j+1;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  IF v_publish THEN UPDATE public.casa_pollas SET status='abierta' WHERE id=p.id; END IF;
  RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'publicada',v_publish);
END $$;

CREATE TRIGGER casa_00_contract_insert BEFORE INSERT ON public.casa_pollas
FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_options
FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_polla_matches
FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();

REVOKE ALL ON FUNCTION public.casa_my_entry_v2(uuid,uuid),public.casa_create_polla_v2(jsonb,text,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_my_entry_v2(uuid,uuid),public.casa_create_polla_v2(jsonb,text,uuid,integer) TO service_role;

CREATE FUNCTION public.casa_payment_details_v2(p_polla_id uuid,p_projection_entry uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT to_jsonb(s)||jsonb_build_object('entry_house_cop',p.entry_price_cop-s.entry_prize_cop)
    FROM public.casa_pot_summaries_v2(ARRAY[p_polla_id],p_projection_entry) s
    JOIN public.casa_pollas p ON p.id=s.polla_id;
$$;
CREATE FUNCTION public.casa_house_total_v2(p_ids uuid[])
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(sum(house_cop),0)::bigint FROM public.casa_pot_summaries_v2(p_ids);
$$;
REVOKE ALL ON FUNCTION public.casa_payment_details_v2(uuid,uuid),public.casa_house_total_v2(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_payment_details_v2(uuid,uuid),public.casa_house_total_v2(uuid[]) TO service_role;

CREATE FUNCTION public.casa_prize_preview_v2(p_price integer,p_cut integer,p_tickets integer,p_object boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_each bigint;
BEGIN
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 10000000 OR p_cut IS NULL OR p_cut NOT BETWEEN 0 AND 100
    OR p_tickets IS NULL OR p_tickets NOT BETWEEN 2 AND 1000 OR p_object IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  v_each:=CASE WHEN p_object THEN 0 ELSE floor(p_price::numeric*(100-p_cut)/100)::bigint END;
  RETURN jsonb_build_object('entry_prize',v_each,'entry_house',p_price-v_each,
    'ten_prize',CASE WHEN p_object THEN 0 ELSE floor(p_price::numeric*10*(100-p_cut)/100)::bigint END,
    'all_prize',CASE WHEN p_object THEN 0 ELSE floor(p_price::numeric*p_tickets*(100-p_cut)/100)::bigint END);
END $$;
REVOKE ALL ON FUNCTION public.casa_prize_preview_v2(integer,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_prize_preview_v2(integer,integer,integer,boolean) TO service_role;
