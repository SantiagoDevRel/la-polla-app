-- Follow-ups to 104 and 106. Casa only: no historical predictions, no fixture
-- rows, no money or settlement rows are changed by installing this migration.
-- Each function keeps its signature, SECURITY DEFINER and search_path; the ACL
-- is restated (service_role only) so a fresh environment matches production.

-- 1) A match abandoned after it started is voided inside Casa, like a suspension.
--    API-Football ABD and ESPN STATUS_ABANDONED arrive as status='cancelled' with
--    that detail; football-data SUSPENDED arrives as 'cancelled' with no detail.
--    A postponement, cancellation or abandonment with no start evidence never voids.
-- 2) The global matches UPDATE never depends on the Casa operation mode. While
--    Casa is paused (or a Casa write fails), the observation is kept and an
--    admin alert is opened instead of aborting live data for every product.
CREATE OR REPLACE FUNCTION public.casa_void_suspended_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p_id uuid; previous_contract text; started boolean; v_mode text; v_pollas uuid[];
  v_failed text[]:='{}'; v_error text; v_detail text:=upper(coalesce(NEW.live_status_detail,''));
  v_alert_key text:='casa_match_void_pending:'||NEW.id::text;
BEGIN
  IF NEW.final_verified_at IS NOT NULL OR NOT (
    v_detail IN ('STATUS_SUSPENDED','SUSPENDED','SUSP','STATUS_ABANDONED','ABANDONED','ABD')
    OR (NEW.status='cancelled' AND v_detail NOT IN ('STATUS_POSTPONED','POSTPONED','PST'))
  ) THEN RETURN NEW; END IF;
  -- Start evidence is unchanged from 106.
  started := NEW.scheduled_at<=clock_timestamp() AND (
    coalesce(NEW.elapsed,0)>0 OR coalesce(OLD.elapsed,0)>0 OR
    (OLD.status='live' AND upper(coalesce(OLD.live_status_detail,'')) NOT IN
      ('STATUS_SUSPENDED','SUSPENDED','SUSP','STATUS_INTERRUPTED','STATUS_DELAYED','STATUS_SCHEDULED','')));
  IF NOT started THEN RETURN NEW; END IF;
  SELECT array_agg(pm.polla_id ORDER BY pm.polla_id) INTO v_pollas
    FROM public.casa_polla_matches pm JOIN public.casa_pollas p ON p.id=pm.polla_id
    WHERE pm.match_id=NEW.id AND pm.voided_at IS NULL AND p.archived_at IS NULL
      AND p.status IN ('abierta','cerrada')
      AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id);
  IF v_pollas IS NULL THEN RETURN NEW; END IF;

  -- No FOR SHARE: a live provider must not queue behind a mode transition.
  SELECT mode INTO v_mode FROM public.casa_operation_control WHERE singleton;
  IF v_mode='paused' THEN
    SELECT array_agg(p.slug ORDER BY p.slug) INTO v_failed FROM public.casa_pollas p WHERE p.id=ANY(v_pollas);
  ELSE
    previous_contract:=current_setting('app.casa_contract',true);
    PERFORM set_config('app.casa_contract','2',true);
    FOREACH p_id IN ARRAY v_pollas LOOP
      BEGIN
        -- Parent before child, matching settlement and the v2 relation guard.
        PERFORM 1 FROM public.casa_pollas WHERE id=p_id AND status IN ('abierta','cerrada')
          AND archived_at IS NULL FOR UPDATE;
        IF NOT FOUND OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p_id) THEN CONTINUE; END IF;
        UPDATE public.casa_polla_matches SET voided_at=clock_timestamp()
          WHERE polla_id=p_id AND match_id=NEW.id AND voided_at IS NULL;
        PERFORM public.casa_score_polla(p_id);
      EXCEPTION WHEN OTHERS THEN
        -- Subtransaction rollback: this pool stays exactly as it was.
        GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
        v_failed:=v_failed||((SELECT slug FROM public.casa_pollas WHERE id=p_id)||' ('||v_error||')');
      END;
    END LOOP;
    PERFORM set_config('app.casa_contract',coalesce(previous_contract,''),true);
  END IF;

  IF cardinality(v_failed)>0 THEN
    INSERT INTO public.admin_alerts(kind,title,body,dedupe_key)
    VALUES('casa_match_void_pending',
      'Casa: partido interrumpido sin anular: '||NEW.home_team||' vs '||NEW.away_team,
      'El partido '||NEW.home_team||' vs '||NEW.away_team||' (match_id '||NEW.id::text||', estado '||
        coalesce(NEW.status,'')||' / '||coalesce(nullif(v_detail,''),'sin detalle')||') se interrumpió después de iniciar, pero no se anuló en '||
        CASE WHEN v_mode='paused' THEN 'estas pollas porque Casa está en pausa: ' ELSE 'estas pollas: ' END||
        array_to_string(v_failed,', ')||'. Los datos globales del partido sí se guardaron. '||
        'Con Casa en v2, la siguiente lectura del proveedor lo anula; si ya no llegan lecturas, revísalo antes de liquidar.',
      v_alert_key)
    ON CONFLICT (dedupe_key) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,resolved_at=NULL;
  ELSE
    UPDATE public.admin_alerts SET resolved_at=clock_timestamp() WHERE dedupe_key=v_alert_key AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_void_suspended_match() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_void_suspended_match() TO service_role;

-- 3) House balance for fixed prizes: the guaranteed prize is only a commitment
--    of a published pool that can still award it. prize_cop is unchanged
--    (settlement and preview read it); only house_cop is corrected.
CREATE OR REPLACE FUNCTION public.casa_pot_summaries_v2(p_ids uuid[],p_projection_entry uuid DEFAULT NULL)
RETURNS TABLE(polla_id uuid,paid_entries integer,gross_cop bigint,prize_cop bigint,house_cop bigint,
  entry_prize_cop bigint,projected_prize_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH totals AS (
    SELECT p.id,p.prize_kind,p.pot_mode,p.fixed_prize_cop,p.house_cut_pct,p.entry_price_cop,
      p.status,p.publication_mode,p.settlement_outcome,count(e.id)::integer AS paid,
      coalesce(sum(e.amount_cop),0)::bigint AS gross,
      CASE WHEN p_projection_entry IS NULL THEN p.entry_price_cop
        ELSE coalesce((SELECT CASE WHEN x.status='pagada' THEN 0 ELSE x.amount_cop END
          FROM public.casa_entries x WHERE x.id=p_projection_entry AND x.polla_id=p.id),0) END AS extra,
      (SELECT sum(o.amount_cop)::bigint FROM public.casa_payouts o WHERE o.polla_id=p.id AND o.prize_kind='pozo') AS paid_out
    FROM public.casa_pollas p LEFT JOIN public.casa_entries e ON e.polla_id=p.id AND e.status='pagada'
    WHERE p.id=ANY(p_ids) GROUP BY p.id
  ), prizes AS (
    SELECT *, CASE WHEN prize_kind='objeto' THEN 0 WHEN pot_mode='fijo' THEN fixed_prize_cop ELSE floor(gross::numeric*(100-house_cut_pct)/100)::bigint END AS prize
    FROM totals
  )
  SELECT id,paid,gross,prize,
    CASE
      WHEN pot_mode<>'fijo' THEN gross-prize
      -- Hidden/draft, voided, or settled with nobody above zero: nothing was awarded.
      WHEN status IN ('borrador','anulada') OR publication_mode='oculta'
        OR settlement_outcome='house_retained_zero_points' THEN gross
      -- Settled: what was actually paid, never the nominal commitment.
      WHEN status='resuelta' AND paid_out IS NOT NULL THEN gross-paid_out
      ELSE gross-prize
    END,
    CASE WHEN prize_kind='objeto' OR pot_mode='fijo' THEN 0 ELSE floor(entry_price_cop::numeric*(100-house_cut_pct)/100)::bigint END,
    CASE WHEN prize_kind='objeto' THEN 0 WHEN pot_mode='fijo' THEN fixed_prize_cop ELSE floor((gross::numeric+extra)*(100-house_cut_pct)/100)::bigint END
  FROM prizes;
$$;
REVOKE ALL ON FUNCTION public.casa_pot_summaries_v2(uuid[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_pot_summaries_v2(uuid[],uuid) TO service_role;

-- 4) A postponed match stays status='cancelled' after being rescheduled
--    (matches_prevent_status_regress blocks cancelled -> scheduled). It accepts
--    picks while it never started; the 5-minute lock, verification and void stay.
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
      OR m.final_verified_at IS NOT NULL OR m.scheduled_at-interval '5 minutes'<=clock_timestamp()
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
REVOKE ALL ON FUNCTION public.casa_guard_pick_lifecycle() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_guard_pick_lifecycle() TO service_role;

-- 5) A scheduled pool that is not visible yet cannot be closed (web or /cerrar):
--    closing it would leave a pool that can be neither published nor reopened.
--    Reuses the existing POLLA_NOT_PUBLISHED code already mapped in lib/casa.
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
  ELSIF p_action='cerrar' AND p.status='abierta' AND p.opens_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_PUBLISHED',
      DETAIL='Esta polla todavía no se publica. Publícala, cambia la fecha u ocúltala antes de cerrarla.';
  ELSIF p_action='cerrar' AND p.status='abierta' THEN s:='cerrada';
  ELSIF p_action='anular' AND p.status IN ('borrador','abierta') THEN s:='anulada';
  ELSE RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_TRANSITION'; END IF;
  UPDATE public.casa_pollas SET status=s,
    publication_mode=CASE WHEN p_action='publicar' THEN 'ahora' ELSE publication_mode END,
    opens_at=CASE WHEN p_action='publicar' THEN clock_timestamp() ELSE opens_at END WHERE id=p.id;
  RETURN jsonb_build_object('slug',p.slug,'status',s);
END $$;
REVOKE ALL ON FUNCTION public.casa_change_status_v2(uuid,text,integer,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_change_status_v2(uuid,text,integer,uuid,bigint) TO service_role;
