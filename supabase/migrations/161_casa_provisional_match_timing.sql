-- Unknown kickoff times remain playable until evidence of play.
-- Auto registration deadlines use confirmed times; an explicit fallback is
-- retained while all times are unknown. Existing rows and ACLs are preserved.

CREATE OR REPLACE FUNCTION public.casa_guard_pick_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; m public.matches; q public.casa_questions;
BEGIN
  IF TG_OP='UPDATE' AND
    (to_jsonb(NEW)-'points_earned'-'updated_at') IS NOT DISTINCT FROM
    (to_jsonb(OLD)-'points_earned'-'updated_at') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.polla_id,NEW.entry_id,NEW.user_id,NEW.match_id,NEW.question_id)
    IS DISTINCT FROM (OLD.polla_id,OLD.entry_id,OLD.user_id,OLD.match_id,OLD.question_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='No se puede mover un pronóstico a otra inscripción o partido.';
  END IF;
  IF (SELECT mode FROM public.casa_operation_control WHERE singleton FOR SHARE)='paused' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPERATIONS_PAUSED';
  END IF;
  BEGIN
    SELECT * INTO p FROM public.casa_pollas WHERE id=NEW.polla_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='La polla se está actualizando. Intenta guardar de nuevo.';
  END;
  IF NOT FOUND OR p.archived_at IS NOT NULL OR p.status NOT IN ('abierta','cerrada') OR
    EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esta polla ya no recibe pronósticos. Los anteriores se conservaron.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.id=NEW.entry_id AND e.polla_id=p.id
    AND e.user_id=NEW.user_id AND (e.status='pagada' OR (e.status='pendiente' AND e.proof_path IS NOT NULL))) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Primero tienes que inscribirte a la polla.';
  END IF;
  IF NEW.match_id IS NOT NULL THEN
    SELECT m1.* INTO m FROM public.matches m1 JOIN public.casa_polla_matches pm ON pm.match_id=m1.id
      WHERE pm.polla_id=p.id AND m1.id=NEW.match_id;
    IF NOT FOUND OR p.kind<>'partidos' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Ese partido no pertenece a la polla.';
    END IF;
    IF NOT (m.status='scheduled' OR (m.status='cancelled' AND coalesce(m.elapsed,0)=0))
      OR coalesce(m.elapsed,0)>0 OR m.final_verified_at IS NOT NULL
      OR (m.scheduled_at_confirmed AND m.scheduled_at-interval '5 minutes'<=clock_timestamp())
      OR EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p.id AND match_id=m.id AND voided_at IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Los pronósticos se cierran 5 minutos antes del partido.';
    END IF;
  ELSE
    SELECT * INTO q FROM public.casa_questions WHERE id=NEW.question_id AND polla_id=p.id;
    IF NOT FOUND OR p.kind<>'manual' OR q.resolved_at IS NOT NULL OR p.status<>'abierta' OR p.closes_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esta pregunta ya no recibe respuestas.';
    END IF;
    IF NEW.option_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.casa_options WHERE id=NEW.option_id AND question_id=q.id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='La opción no pertenece a esta pregunta.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.casa_create_polla_v2(p_config jsonb, p_slug text, p_actor_id uuid, p_contract integer)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE p public.casa_pollas; q jsonb; opt text; qid uuid; mid uuid; i integer:=0; j integer;
  closing timestamptz; v_count integer; v_publish boolean; v_mode text; v_pot text; v_open timestamptz; v_fixed bigint;
  v_max numeric;
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
   ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
  END IF;
  -- Migración 131: participaciones por persona (1..50, por defecto 10). En rifas manda la boleta.
  IF p_config ? 'maxEntriesPerUser' AND jsonb_typeof(p_config->'maxEntriesPerUser') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MAX_ENTRIES';
  END IF;
  v_max:=CASE WHEN p_config->>'kind'='rifa' THEN 10 ELSE coalesce((p_config->>'maxEntriesPerUser')::numeric,10) END;
  IF v_max NOT BETWEEN 1 AND 50 OR v_max::numeric%1<>0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MAX_ENTRIES';
  END IF;
  v_open:=CASE WHEN v_mode='programada' THEN (p_config->>'publishesAt')::timestamptz ELSE clock_timestamp() END;
  closing := (p_config->>'closesAt')::timestamptz;
  IF p_config->>'kind'='partidos' THEN
    SELECT count(*),min(m.scheduled_at) FILTER (WHERE m.scheduled_at_confirmed)-interval '5 minutes' INTO v_count,closing
      FROM public.matches m WHERE m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_config->'matchIds'));
    IF v_count<1 OR v_count>30 OR v_count<>jsonb_array_length(p_config->'matchIds') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MATCHES';
    END IF;
    IF p_config->>'closeMode'<>'auto' OR closing IS NULL THEN closing := (p_config->>'closesAt')::timestamptz; END IF;
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
    ticket_count,draw_method,payout_method,payout_account,payout_account_name,created_by,pot_mode,fixed_prize_cop,publication_mode,opens_at,max_entries_per_user)
  VALUES(p_slug,p_config->>'name',p_config->>'description',(p_config->>'kind')::public.casa_polla_kind,
    CASE WHEN p_config->>'kind'='partidos' THEN p_config->>'tournament' END,
    CASE WHEN p_config->>'kind'='partidos' THEN (p_config->>'scoringMode')::public.casa_scoring_mode END,
    (p_config->>'entryPriceCop')::integer,CASE WHEN p_config->>'prizeKind'='objeto' THEN 100 ELSE (p_config->>'houseCutPct')::integer END,p_config->>'prizeKind',
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeObject' END,
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeImagePath' END,
    3,3,0,'borrador',closing,p_config->>'closeMode',
    CASE WHEN p_config->>'kind'='rifa' THEN (p_config->>'ticketCount')::integer END,
    CASE WHEN p_config->>'kind'='rifa' THEN p_config->>'drawMethod' END,
    p_config->>'payoutMethod',p_config->>'payoutAccount',p_config->>'payoutAccountName',p_actor_id,v_pot,v_fixed,v_mode,v_open,v_max) RETURNING * INTO p;
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
END $function$;

CREATE OR REPLACE FUNCTION public.casa_recompute_auto_close(p_polla_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record; v_close timestamptz; v_contract text;
BEGIN
  -- SKIP LOCKED: si otra operación tiene la polla (pronóstico, pago, reparto),
  -- no se espera; el siguiente cambio de horario la vuelve a revisar.
  SELECT id, kind, close_mode, status, archived_at, closes_at, opens_at, publication_mode
    INTO p FROM public.casa_pollas WHERE id = p_polla_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR p.kind <> 'partidos' OR p.close_mode <> 'auto' OR p.archived_at IS NOT NULL
     OR p.status NOT IN ('borrador', 'abierta') OR p.closes_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  SELECT min(m.scheduled_at) - interval '5 minutes' INTO v_close
    FROM public.casa_polla_matches l JOIN public.matches m ON m.id = l.match_id
   WHERE l.polla_id = p.id AND l.voided_at IS NULL AND m.scheduled_at_confirmed;
  IF v_close IS NULL OR v_close = p.closes_at THEN RETURN false; END IF;
  -- Una publicación programada tiene que abrir antes de cerrar.
  IF p.publication_mode = 'programada' AND p.opens_at >= v_close THEN RETURN false; END IF;

  v_contract := current_setting('app.casa_contract', true);
  PERFORM set_config('app.casa_contract', '2', true);
  UPDATE public.casa_pollas SET closes_at = v_close WHERE id = p.id;
  PERFORM set_config('app.casa_contract', coalesce(v_contract, ''), true);
  RETURN true;
END $$;

-- Keep the existing schedule trigger; precision can change without the timestamp.
CREATE TRIGGER casa_auto_close_on_precision
  AFTER UPDATE OF scheduled_at_confirmed ON public.matches
  FOR EACH ROW WHEN (OLD.scheduled_at_confirmed IS DISTINCT FROM NEW.scheduled_at_confirmed)
  EXECUTE FUNCTION public.casa_auto_close_after_schedule_change();


-- Patch the editor in place; preserve its existing audit and authorization.
DO $patch$
DECLARE definition text; needle text;
BEGIN
  SELECT pg_get_functiondef('public.casa_edit_polla_v2(uuid,jsonb,uuid[],uuid[],uuid,integer)'::regprocedure) INTO definition;
  needle := 'AND m.scheduled_at-interval ''5 minutes''>clock_timestamp(),false)';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect editor timing baseline'; END IF;
  definition := replace(definition,needle,'AND coalesce(m.elapsed,0)=0 AND (NOT m.scheduled_at_confirmed OR m.scheduled_at-interval ''5 minutes''>clock_timestamp()),false)');
  needle := 'WHERE l.polla_id=p.id AND l.voided_at IS NULL;';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect editor closure baseline'; END IF;
  definition := replace(definition,needle,'WHERE l.polla_id=p.id AND l.voided_at IS NULL AND m.scheduled_at_confirmed;');
  needle := 'IF v_close IS NOT NULL AND v_close IS DISTINCT FROM p.closes_at THEN';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect editor publication baseline'; END IF;
  definition := replace(definition,needle,'IF p.publication_mode=''programada'' AND v_close IS NOT NULL AND v_close IS DISTINCT FROM p.closes_at THEN');
  EXECUTE definition;
END $patch$;
