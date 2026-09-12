-- SQL owns monetary aggregation, including batch reads and projections.
CREATE FUNCTION public.casa_pot_summaries_v2(p_ids uuid[],p_projection_entry uuid DEFAULT NULL)
RETURNS TABLE(polla_id uuid,paid_entries integer,gross_cop bigint,prize_cop bigint,house_cop bigint,
  entry_prize_cop bigint,projected_prize_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH totals AS (
    SELECT p.id,p.prize_kind,p.house_cut_pct,p.entry_price_cop,count(e.id)::integer AS paid,
      coalesce(sum(e.amount_cop),0)::bigint AS gross,
      CASE WHEN p_projection_entry IS NULL THEN p.entry_price_cop
        ELSE coalesce((SELECT CASE WHEN x.status='pagada' THEN 0 ELSE x.amount_cop END
          FROM public.casa_entries x WHERE x.id=p_projection_entry AND x.polla_id=p.id),0) END AS extra
    FROM public.casa_pollas p LEFT JOIN public.casa_entries e ON e.polla_id=p.id AND e.status='pagada'
    WHERE p.id=ANY(p_ids) GROUP BY p.id
  ), prizes AS (
    SELECT *, CASE WHEN prize_kind='objeto' THEN 0 ELSE floor(gross::numeric*(100-house_cut_pct)/100)::bigint END AS prize
    FROM totals
  )
  SELECT id,paid,gross,prize,gross-prize,
    CASE WHEN prize_kind='objeto' THEN 0 ELSE floor(entry_price_cop::numeric*(100-house_cut_pct)/100)::bigint END,
    CASE WHEN prize_kind='objeto' THEN 0 ELSE floor((gross::numeric+extra)*(100-house_cut_pct)/100)::bigint END
  FROM prizes;
$$;

CREATE FUNCTION public.casa_settle_polla_v2(p_polla_id uuid,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; d public.casa_object_draws; v_prize bigint; v_paid integer;
  v_top integer; v_winners integer; v_each bigint:=0; v_remainder bigint:=0; v_outcome text; v_user uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  p := public.casa_v2_lock_polla(p_polla_id,true);
  IF p.status<>'cerrada' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CLOSE_FIRST'; END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE polla_id=p.id;
  IF FOUND THEN
    IF d.state<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED'; END IF;
    RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
      'draw_id',d.id,'prize_cop',0,'winners',0,'each_cop',0,'top_points',d.top_points);
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_entries e LEFT JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id
    WHERE e.polla_id=p.id AND e.status='pendiente' AND
      (e.proof_path IS NOT NULL OR (a.state='uploading' AND a.expires_at>clock_timestamp()))) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PENDING_PROOFS',DETAIL='Revisa los comprobantes pendientes y espera las cargas en curso.';
  END IF;
  SELECT paid_entries,prize_cop INTO v_paid,v_prize FROM public.casa_pot_summaries_v2(ARRAY[p.id]);
  IF v_paid=0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES',DETAIL='Esta polla no tiene inscripciones pagadas.'; END IF;
  IF p.kind='partidos' AND EXISTS(SELECT 1 FROM public.casa_polla_matches pm JOIN public.matches m ON m.id=pm.match_id
    WHERE pm.polla_id=p.id AND m.final_verified_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNVERIFIED_MATCHES',DETAIL='Faltan partidos por verificar.';
  END IF;
  IF p.kind='manual' AND EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id AND resolved_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNRESOLVED_QUESTIONS',DETAIL='Faltan preguntas por resolver.';
  END IF;
  IF p.prize_kind='objeto' AND nullif(btrim(p.prize_object),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_REQUIRED';
  END IF;
  IF p.kind='rifa' THEN
    IF p.drawn_number IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_NUMBER_REQUIRED'; END IF;
    SELECT user_id INTO v_user FROM public.casa_entries WHERE polla_id=p.id AND status='pagada' AND ticket_number=p.drawn_number;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNSOLD_TICKET',DETAIL='La boleta sorteada no está pagada. No se ha adjudicado el premio.'; END IF;
    v_winners:=1;
  ELSE
    PERFORM public.casa_score_polla(p.id);
    SELECT max(points) INTO v_top FROM public.casa_leaderboard(p.id);
    IF v_top IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES'; END IF;
    IF v_top=0 THEN
      UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,
        settled_chat_id=p_chat_id,settlement_outcome='house_retained_zero_points',settlement_prize_cop=v_prize WHERE id=p.id;
      RETURN jsonb_build_object('contract',2,'outcome','house_retained_zero_points','polla_id',p.id,'status','resuelta',
        'prize_cop',0,'retained_prize_cop',v_prize,'winners',0,'each_cop',0,'top_points',0);
    END IF;
    IF v_top<0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POINTS'; END IF;
    SELECT count(*) INTO v_winners FROM public.casa_leaderboard(p.id) WHERE points=v_top;
    IF p.prize_kind='objeto' AND v_winners>1 THEN
      INSERT INTO public.casa_object_draws(polla_id,prize_object,top_points)
        VALUES(p.id,p.prize_object,v_top) RETURNING * INTO d;
      INSERT INTO public.casa_object_draw_candidates(draw_id,user_id,points,ticket)
        SELECT d.id,user_id,points,row_number() OVER(ORDER BY user_id)::integer
        FROM public.casa_leaderboard(p.id) WHERE points=v_top;
      RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
        'draw_id',d.id,'prize_cop',0,'winners',0,'candidates',v_winners,'each_cop',0,'top_points',v_top);
    END IF;
  END IF;
  v_each:=v_prize/v_winners;
  v_remainder:=v_prize-v_each*v_winners;
  v_outcome:=CASE WHEN p.prize_kind='objeto' THEN 'object_awarded' ELSE 'money_awarded' END;
  IF p.kind='rifa' THEN
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      VALUES(p.id,v_user,1,NULL,v_prize,'Boleta '||p.drawn_number||' — '||p.draw_method,p.prize_kind,
        CASE WHEN p.prize_kind='objeto' THEN p.prize_object END);
  ELSE
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      SELECT p.id,user_id,1,points,v_each+CASE WHEN n<=v_remainder THEN 1 ELSE 0 END,
        CASE WHEN v_winners>1 THEN 'Empate en '||v_top||' puntos' END,p.prize_kind,
        CASE WHEN p.prize_kind='objeto' THEN p.prize_object END
      FROM (SELECT user_id,points,row_number() OVER(ORDER BY user_id) n FROM public.casa_leaderboard(p.id) WHERE points=v_top) winners;
  END IF;
  UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,settled_chat_id=p_chat_id,
    settlement_outcome=v_outcome,settlement_prize_cop=v_prize WHERE id=p.id;
  RETURN jsonb_build_object('contract',2,'outcome',v_outcome,'polla_id',p.id,'status','resuelta',
    'prize_cop',v_prize,'winners',v_winners,'each_cop',v_each,'remainder',v_remainder,'top_points',v_top);
END $$;

CREATE FUNCTION public.casa_resolve_question_v2(p_polla_id uuid,p_question_id uuid,p_option_id uuid,p_text text,
  p_contract integer,p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; q public.casa_questions; n integer;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p.kind<>'manual' OR p.status NOT IN ('abierta','cerrada') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POLLA_KIND'; END IF;
  SELECT * INTO q FROM public.casa_questions WHERE id=p_question_id AND polla_id=p.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='QUESTION_NOT_FOUND'; END IF;
  IF q.resolved_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_RESOLVED'; END IF;
  IF q.input_kind='opciones' AND (p_text IS NOT NULL OR p_option_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.casa_options WHERE id=p_option_id AND question_id=q.id)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_ANSWER';
  ELSIF q.input_kind='texto' AND (p_option_id IS NOT NULL OR nullif(btrim(p_text),'') IS NULL OR length(p_text)>120) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_ANSWER';
  END IF;
  UPDATE public.casa_questions SET resolved_option_id=p_option_id,resolved_text=btrim(p_text),resolved_at=clock_timestamp() WHERE id=q.id;
  PERFORM public.casa_score_polla(p.id);
  SELECT count(*) INTO n FROM public.casa_questions WHERE polla_id=p.id AND resolved_at IS NULL;
  RETURN jsonb_build_object('faltan',n,'status',p.status);
END $$;

CREATE FUNCTION public.casa_set_drawn_number_v2(p_polla_id uuid,p_number integer,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p.kind<>'rifa' OR p.status NOT IN ('abierta','cerrada') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POLLA_KIND'; END IF;
  IF p_number IS NULL OR p_number<1 OR p_number>p.ticket_count THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_TICKET'; END IF;
  UPDATE public.casa_pollas SET drawn_number=p_number WHERE id=p.id;
  RETURN jsonb_build_object('numero',p_number,'vendida',EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id AND status='pagada' AND ticket_number=p_number));
END $$;

CREATE FUNCTION public.casa_archive_polla_v2(p_polla_id uuid,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id AND state='pending') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PENDING';
  END IF;
  IF p.archived_at IS NULL THEN
    UPDATE public.casa_pollas SET archived_at=clock_timestamp(),archived_by=p_actor_id WHERE id=p.id;
  END IF;
  RETURN jsonb_build_object('slug',p.slug,'archived',true);
END $$;

CREATE FUNCTION public.casa_change_status_v2(p_polla_id uuid,p_action text,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; s public.casa_polla_status;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p_action='publicar' AND p.status='borrador' THEN
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
  UPDATE public.casa_pollas SET status=s WHERE id=p.id;
  RETURN jsonb_build_object('slug',p.slug,'status',s);
END $$;

CREATE FUNCTION public.casa_begin_draw_confirmation_v2(p_draw_id uuid,p_winner_id uuid,p_request_id uuid,
  p_sha256 text,p_content_type text,p_bytes bigint,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.casa_object_draws; a public.casa_draw_confirmation_attempts; v_id uuid; v_ext text;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING';
  END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE id=p_draw_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.casa_pollas WHERE id=d.polla_id FOR UPDATE;
  SELECT * INTO d FROM public.casa_object_draws WHERE id=p_draw_id FOR UPDATE;
  SELECT * INTO a FROM public.casa_draw_confirmation_attempts WHERE request_id=p_request_id AND superseded_by IS NULL;
  IF FOUND THEN
    IF a.draw_id<>d.id OR a.winner_id IS DISTINCT FROM p_winner_id OR a.actor_id IS DISTINCT FROM p_actor_id
      OR a.content_sha256 IS DISTINCT FROM p_sha256 OR a.content_type IS DISTINCT FROM p_content_type OR a.content_bytes IS DISTINCT FROM p_bytes THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REQUEST_CONFLICT';
    END IF;
    RETURN jsonb_build_object('attempt_id',a.id,'evidence_path',a.evidence_path,'state',a.state);
  END IF;
  IF d.state<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_RESOLVED'; END IF;
  PERFORM public.casa_v2_lock_polla(d.polla_id,true);
  IF p_request_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.casa_object_draw_candidates WHERE draw_id=d.id AND user_id=p_winner_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_DRAW_WINNER';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_content_type IS NULL
    OR p_content_type NOT IN ('video/mp4','video/webm','video/quicktime') OR p_bytes IS NULL OR p_bytes<1 OR p_bytes>52428800 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_EVIDENCE';
  END IF;
  v_id:=gen_random_uuid();
  v_ext:=CASE p_content_type WHEN 'video/webm' THEN 'webm' WHEN 'video/quicktime' THEN 'mov' ELSE 'mp4' END;
  INSERT INTO public.casa_draw_confirmation_attempts(id,draw_id,request_id,winner_id,actor_id,evidence_path,content_type,content_bytes,content_sha256)
    VALUES(v_id,d.id,p_request_id,p_winner_id,p_actor_id,'draws/'||d.id||'/'||v_id||'.'||v_ext,p_content_type,p_bytes,p_sha256)
    RETURNING * INTO a;
  RETURN jsonb_build_object('attempt_id',a.id,'evidence_path',a.evidence_path,'state',a.state);
END $$;

CREATE FUNCTION public.casa_confirm_object_draw_v2(p_attempt_id uuid,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.casa_draw_confirmation_attempts; d public.casa_object_draws;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO a FROM public.casa_draw_confirmation_attempts WHERE id=p_attempt_id AND actor_id=p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE id=a.draw_id;
  PERFORM 1 FROM public.casa_pollas WHERE id=d.polla_id FOR UPDATE;
  SELECT * INTO d FROM public.casa_object_draws WHERE id=a.draw_id FOR UPDATE;
  IF d.state='resolved' THEN
    IF d.confirmation_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_RESOLVED'; END IF;
    RETURN jsonb_build_object('outcome','object_awarded','winner_id',d.winner_id,'changed',false);
  END IF;
  PERFORM public.casa_v2_lock_polla(d.polla_id,true);
  IF NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING';
  END IF;
  SELECT * INTO a FROM public.casa_draw_confirmation_attempts WHERE id=p_attempt_id;
  IF a.superseded_by IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='casa-draw-evidence' AND name=a.evidence_path) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='EVIDENCE_NOT_UPLOADED';
  END IF;
  INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,prize_kind,prize_object,note)
    VALUES(d.polla_id,a.winner_id,1,d.top_points,0,'objeto',d.prize_object,'Sorteo de desempate '||d.id);
  UPDATE public.casa_draw_confirmation_attempts SET state='confirmed',confirmed_at=clock_timestamp() WHERE id=a.id;
  UPDATE public.casa_object_draws SET state='resolved',winner_id=a.winner_id,resolved_at=clock_timestamp(),
    resolved_by=p_actor_id,confirmation_id=a.id WHERE id=d.id;
  UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,
    settlement_outcome='object_awarded',settlement_prize_cop=0 WHERE id=d.polla_id;
  RETURN jsonb_build_object('outcome','object_awarded','winner_id',a.winner_id,'changed',true);
END $$;

CREATE FUNCTION public.casa_record_delivery_v2(p_payout_id uuid,p_reference text,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.casa_payouts;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF length(btrim(coalesce(p_reference,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
  SELECT * INTO a FROM public.casa_payouts WHERE id=p_payout_id;
  IF NOT FOUND OR a.prize_kind<>'objeto' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_AWARD_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.casa_pollas WHERE id=a.polla_id FOR UPDATE;
  SELECT * INTO a FROM public.casa_payouts WHERE id=p_payout_id FOR UPDATE;
  IF a.delivered_at IS NULL THEN
    UPDATE public.casa_payouts SET delivered_at=clock_timestamp(),delivered_by=p_actor_id,delivery_reference=nullif(btrim(p_reference),'')
      WHERE id=a.id RETURNING * INTO a;
  END IF;
  RETURN jsonb_build_object('delivered_at',a.delivered_at,'delivery_reference',a.delivery_reference);
END $$;

REVOKE ALL ON FUNCTION public.casa_pot_summaries_v2(uuid[],uuid),public.casa_settle_polla_v2(uuid,integer,uuid,bigint),
  public.casa_resolve_question_v2(uuid,uuid,uuid,text,integer,uuid,bigint),public.casa_set_drawn_number_v2(uuid,integer,integer,uuid,bigint),
  public.casa_archive_polla_v2(uuid,uuid,integer),public.casa_change_status_v2(uuid,text,integer,uuid,bigint),
  public.casa_begin_draw_confirmation_v2(uuid,uuid,uuid,text,text,bigint,uuid,integer),
  public.casa_confirm_object_draw_v2(uuid,uuid,integer),public.casa_record_delivery_v2(uuid,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_pot_summaries_v2(uuid[],uuid),public.casa_settle_polla_v2(uuid,integer,uuid,bigint),
  public.casa_resolve_question_v2(uuid,uuid,uuid,text,integer,uuid,bigint),public.casa_set_drawn_number_v2(uuid,integer,integer,uuid,bigint),
  public.casa_archive_polla_v2(uuid,uuid,integer),public.casa_change_status_v2(uuid,text,integer,uuid,bigint),
  public.casa_begin_draw_confirmation_v2(uuid,uuid,uuid,text,text,bigint,uuid,integer),
  public.casa_confirm_object_draw_v2(uuid,uuid,integer),public.casa_record_delivery_v2(uuid,text,uuid,integer) TO service_role;
