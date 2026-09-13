-- Fixed prizes and scheduled publication. Existing money and history remain untouched.
-- Publication is a timestamp gate on reads/entry writes: no cron or paid scheduler.
ALTER TABLE public.casa_pollas
  ADD COLUMN pot_mode text NOT NULL DEFAULT 'proporcional' CHECK (pot_mode IN ('proporcional','fijo')),
  ADD COLUMN fixed_prize_cop bigint,
  ADD COLUMN publication_mode text NOT NULL DEFAULT 'ahora' CHECK (publication_mode IN ('ahora','programada','oculta')),
  ADD CONSTRAINT casa_fixed_prize_valid CHECK (
    (pot_mode='fijo' AND prize_kind='pozo' AND house_cut_pct=0 AND fixed_prize_cop IS NOT NULL AND fixed_prize_cop BETWEEN 1 AND 1000000000)
    OR (pot_mode='proporcional' AND fixed_prize_cop IS NULL));
CREATE INDEX casa_publication_due_idx ON public.casa_pollas(opens_at,closes_at)
  WHERE archived_at IS NULL AND status='abierta';

-- Guard direct Data API reads too. Child policies resolve through the parent's
-- RLS, so neither a pool's description nor its questions/match links leak early.
ALTER POLICY casa_pollas_read ON public.casa_pollas
  USING (status<>'borrador' AND archived_at IS NULL AND publication_mode<>'oculta' AND opens_at<=now());
ALTER POLICY casa_questions_read ON public.casa_questions
  USING (EXISTS(SELECT 1 FROM public.casa_pollas p WHERE p.id=polla_id));
ALTER POLICY casa_options_read ON public.casa_options
  USING (EXISTS(SELECT 1 FROM public.casa_questions q WHERE q.id=question_id));
ALTER POLICY casa_polla_matches_read ON public.casa_polla_matches
  USING (EXISTS(SELECT 1 FROM public.casa_pollas p WHERE p.id=polla_id));

CREATE OR REPLACE FUNCTION public.casa_pot_summaries_v2(p_ids uuid[],p_projection_entry uuid DEFAULT NULL)
RETURNS TABLE(polla_id uuid,paid_entries integer,gross_cop bigint,prize_cop bigint,house_cop bigint,
  entry_prize_cop bigint,projected_prize_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH totals AS (
    SELECT p.id,p.prize_kind,p.pot_mode,p.fixed_prize_cop,p.house_cut_pct,p.entry_price_cop,count(e.id)::integer AS paid,
      coalesce(sum(e.amount_cop),0)::bigint AS gross,
      CASE WHEN p_projection_entry IS NULL THEN p.entry_price_cop
        ELSE coalesce((SELECT CASE WHEN x.status='pagada' THEN 0 ELSE x.amount_cop END
          FROM public.casa_entries x WHERE x.id=p_projection_entry AND x.polla_id=p.id),0) END AS extra
    FROM public.casa_pollas p LEFT JOIN public.casa_entries e ON e.polla_id=p.id AND e.status='pagada'
    WHERE p.id=ANY(p_ids) GROUP BY p.id
  ), prizes AS (
    SELECT *, CASE WHEN prize_kind='objeto' THEN 0 WHEN pot_mode='fijo' THEN fixed_prize_cop ELSE floor(gross::numeric*(100-house_cut_pct)/100)::bigint END AS prize
    FROM totals
  )
  SELECT id,paid,gross,prize,gross-prize,
    CASE WHEN prize_kind='objeto' OR pot_mode='fijo' THEN 0 ELSE floor(entry_price_cop::numeric*(100-house_cut_pct)/100)::bigint END,
    CASE WHEN prize_kind='objeto' THEN 0 WHEN pot_mode='fijo' THEN fixed_prize_cop ELSE floor((gross::numeric+extra)*(100-house_cut_pct)/100)::bigint END
  FROM prizes;
$$;

CREATE OR REPLACE FUNCTION public.casa_polla_pot(p_polla_id uuid)
RETURNS TABLE(paid_entries integer,gross_cop bigint,prize_cop bigint,house_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT paid_entries,gross_cop,prize_cop,house_cop FROM public.casa_pot_summaries_v2(ARRAY[p_polla_id]);
$$;

CREATE OR REPLACE FUNCTION public.casa_create_polla_v2(p_config jsonb,p_slug text,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; q jsonb; opt text; qid uuid; mid uuid; i integer:=0; j integer;
  closing timestamptz; v_count integer; v_publish boolean; v_mode text; v_pot text; v_open timestamptz; v_fixed bigint;
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
  v_mode:=coalesce(p_config->>'publicationMode',CASE WHEN coalesce((p_config->>'publish')::boolean,false) THEN 'ahora' ELSE 'oculta' END);
  v_pot:=coalesce(p_config->>'potMode','proporcional');
  IF v_mode NOT IN ('ahora','programada','oculta') OR v_pot NOT IN ('proporcional','fijo') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  v_fixed:=CASE WHEN v_pot='fijo' THEN (p_config->>'fixedPrizeCop')::bigint END;
  IF v_pot='fijo' AND (p_config->>'prizeKind'<>'pozo' OR v_fixed IS NULL OR v_fixed NOT BETWEEN 1 AND 1000000000
    OR (p_config->>'houseCutPct')::integer IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
  END IF;
  v_open:=CASE WHEN v_mode='programada' THEN (p_config->>'publishesAt')::timestamptz ELSE clock_timestamp() END;
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
  IF v_mode='programada' AND (v_open IS NULL OR v_open<=clock_timestamp() OR v_open>=closing) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLICATION_DATE';
  END IF;
  v_publish := v_mode<>'oculta';
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
    ticket_count,draw_method,payout_method,payout_account,payout_account_name,created_by,pot_mode,fixed_prize_cop,publication_mode,opens_at)
  VALUES(p_slug,p_config->>'name',p_config->>'description',(p_config->>'kind')::public.casa_polla_kind,
    CASE WHEN p_config->>'kind'='partidos' THEN p_config->>'tournament' END,
    CASE WHEN p_config->>'kind'='partidos' THEN (p_config->>'scoringMode')::public.casa_scoring_mode END,
    (p_config->>'entryPriceCop')::integer,CASE WHEN p_config->>'prizeKind'='objeto' THEN 100 ELSE (p_config->>'houseCutPct')::integer END,p_config->>'prizeKind',
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeObject' END,
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeImagePath' END,
    3,3,1,'borrador',closing,p_config->>'closeMode',
    CASE WHEN p_config->>'kind'='rifa' THEN (p_config->>'ticketCount')::integer END,
    CASE WHEN p_config->>'kind'='rifa' THEN p_config->>'drawMethod' END,
    p_config->>'payoutMethod',p_config->>'payoutAccount',p_config->>'payoutAccountName',p_actor_id,v_pot,v_fixed,v_mode,v_open) RETURNING * INTO p;
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
  RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'publicada',v_mode='ahora','programada',v_mode='programada','opens_at',v_open);
END $$;

CREATE OR REPLACE FUNCTION public.casa_change_status_v2(p_polla_id uuid,p_action text,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; s public.casa_polla_status;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p_action='publicar' AND (p.status='borrador' OR (p.status='abierta' AND p.opens_at>clock_timestamp())) THEN
    IF p.prize_kind='objeto' AND p.kind<>'rifa'
      AND NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING';
    END IF;
    IF p.closes_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED'; END IF;
    IF p.entry_price_cop>0 AND (nullif(btrim(p.payout_method),'') IS NULL OR nullif(btrim(p.payout_account),'') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PAYMENT_ACCOUNT_REQUIRED';
    END IF;
    IF p.prize_kind='objeto' AND nullif(btrim(p.prize_object),'') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_REQUIRED';
    END IF;
    IF p.kind='partidos' AND NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p.id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_MATCHES';
    END IF;
    IF p.kind='manual' AND (NOT EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id) OR EXISTS(
      SELECT 1 FROM public.casa_questions q WHERE q.polla_id=p.id AND q.input_kind='opciones'
        AND (SELECT count(*) FROM public.casa_options o WHERE o.question_id=q.id)<2)) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_QUESTIONS';
    END IF;
    s:='abierta';
  ELSIF p_action='cerrar' AND p.status='abierta' THEN s:='cerrada';
  ELSIF p_action='anular' AND p.status IN ('borrador','abierta') THEN s:='anulada';
  ELSE RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_TRANSITION'; END IF;
  UPDATE public.casa_pollas SET status=s,
    publication_mode=CASE WHEN p_action='publicar' THEN 'ahora' ELSE publication_mode END,
    opens_at=CASE WHEN p_action='publicar' THEN clock_timestamp() ELSE opens_at END WHERE id=p.id;
  RETURN jsonb_build_object('slug',p.slug,'status',s);
END $$;

-- Only an unpublished pool or one with zero entries may be hidden/rescheduled.
-- The parent lock serializes the visibility change against new proof reservations.
CREATE FUNCTION public.casa_set_publication_v2(p_polla_id uuid,p_mode text,p_opens_at timestamptz,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p_mode NOT IN ('ahora','programada','oculta') OR p_mode IS NULL OR p.status NOT IN ('borrador','abierta') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_TRANSITION';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PUBLICATION_HAS_ENTRIES';
  END IF;
  IF p_mode='ahora' AND p.status='abierta' AND p.opens_at<=clock_timestamp() THEN
    RETURN jsonb_build_object('ok',true,'slug',p.slug);
  END IF;
  IF p_mode<>'oculta' THEN
    IF p_mode='programada' AND (p_opens_at IS NULL OR p_opens_at<=clock_timestamp() OR p_opens_at>=p.closes_at) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLICATION_DATE';
    END IF;
    -- Reuse ALL publication preconditions (payment account, object protocol, contents).
    IF p.status='abierta' THEN UPDATE public.casa_pollas SET status='borrador' WHERE id=p.id; END IF;
    PERFORM public.casa_change_status_v2(p.id,'publicar',2,p_actor_id,NULL);
  END IF;
  UPDATE public.casa_pollas SET publication_mode=p_mode,
    status=CASE WHEN p_mode='oculta' THEN 'borrador'::public.casa_polla_status ELSE 'abierta'::public.casa_polla_status END,
    opens_at=CASE WHEN p_mode='programada' THEN p_opens_at ELSE clock_timestamp() END WHERE id=p.id;
  RETURN jsonb_build_object('ok',true,'slug',p.slug,'publication_mode',p_mode);
END $$;
REVOKE ALL ON FUNCTION public.casa_set_publication_v2(uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_set_publication_v2(uuid,text,timestamptz,uuid,integer) TO service_role;

-- Preserve the recovery/idempotency behavior; add the gate before ANY reservation.
DO $$ DECLARE definition text; needle text;
BEGIN
  SELECT pg_get_functiondef('public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer)'::regprocedure) INTO definition;
  needle:='p := public.casa_v2_lock_polla(p_polla_id);';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect payment reservation baseline'; END IF;
  EXECUTE replace(definition,needle,needle||'
  IF p.publication_mode=''oculta'' OR p.status=''borrador'' OR p.opens_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE=''55000'',MESSAGE=''POLLA_NOT_PUBLISHED'';
  END IF;');
END $$;

-- New helper; existing four-argument preview remains compatible with older clients.
CREATE FUNCTION public.casa_fixed_prize_preview_v2(p_price integer,p_fixed bigint,p_tickets integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 10000000 OR p_fixed IS NULL OR p_fixed NOT BETWEEN 1 AND 1000000000
    OR p_tickets IS NULL OR p_tickets NOT BETWEEN 2 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
  END IF;
  RETURN jsonb_build_object('entry_prize',0,'entry_house',p_price,'ten_prize',p_fixed,'all_prize',p_fixed,
    'fixed_prize',p_fixed,'ten_balance',p_price::bigint*10-p_fixed,'all_balance',p_price::bigint*p_tickets-p_fixed);
END $$;
REVOKE ALL ON FUNCTION public.casa_fixed_prize_preview_v2(integer,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_fixed_prize_preview_v2(integer,bigint,integer) TO service_role;
