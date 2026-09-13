-- Casa only. No historical predictions are changed and no scoring runs here.
-- Closing inscriptions must not close a later match's prediction window.
ALTER TABLE public.casa_polla_matches ADD COLUMN IF NOT EXISTS voided_at timestamptz;
COMMENT ON COLUMN public.casa_polla_matches.voided_at IS 'Permanent zero-point result for this Casa pool after a suspension observed once the match started. Resuming the global fixture never reactivates this pool match.';

CREATE FUNCTION public.casa_preserve_voided_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Un partido anulado conserva sus cero puntos en esta polla.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_preserve_voided_match() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_preserve_voided_match() TO service_role;
CREATE TRIGGER casa_preserve_voided_match BEFORE UPDATE OF voided_at ON public.casa_polla_matches
  FOR EACH ROW EXECUTE FUNCTION public.casa_preserve_voided_match();

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
    IF m.status<>'scheduled' OR m.final_verified_at IS NOT NULL OR m.scheduled_at-interval '5 minutes'<=clock_timestamp()
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

-- A live source observation only changes the Casa relation. It never changes
-- the fixture, historical predictions, settled pools or a pending prize draw.
CREATE FUNCTION public.casa_void_suspended_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p_id uuid; previous_contract text; started boolean;
BEGIN
  IF NEW.final_verified_at IS NOT NULL OR
    upper(coalesce(NEW.live_status_detail,'')) NOT IN ('STATUS_SUSPENDED','SUSPENDED','SUSP') THEN RETURN NEW; END IF;
  started := NEW.scheduled_at<=clock_timestamp() AND (
    coalesce(NEW.elapsed,0)>0 OR coalesce(OLD.elapsed,0)>0 OR
    (OLD.status='live' AND upper(coalesce(OLD.live_status_detail,'')) NOT IN
      ('STATUS_SUSPENDED','SUSPENDED','SUSP','STATUS_INTERRUPTED','STATUS_DELAYED','STATUS_SCHEDULED','')));
  IF NOT started THEN RETURN NEW; END IF;
  previous_contract:=current_setting('app.casa_contract',true);
  PERFORM set_config('app.casa_contract','2',true);
  FOR p_id IN
    SELECT pm.polla_id FROM public.casa_polla_matches pm JOIN public.casa_pollas p ON p.id=pm.polla_id
      WHERE pm.match_id=NEW.id AND pm.voided_at IS NULL AND p.archived_at IS NULL
        AND p.status IN ('abierta','cerrada')
        AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id)
      ORDER BY pm.polla_id
  LOOP
    -- Parent before child, matching settlement and the v2 relation guard.
    PERFORM 1 FROM public.casa_pollas WHERE id=p_id AND status IN ('abierta','cerrada')
      AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p_id) THEN CONTINUE; END IF;
    UPDATE public.casa_polla_matches SET voided_at=clock_timestamp()
      WHERE polla_id=p_id AND match_id=NEW.id AND voided_at IS NULL;
    PERFORM public.casa_score_polla(p_id);
  END LOOP;
  PERFORM set_config('app.casa_contract',coalesce(previous_contract,''),true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_void_suspended_match() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_void_suspended_match() TO service_role;
CREATE TRIGGER casa_void_on_suspension AFTER UPDATE OF status,live_status_detail,elapsed ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.casa_void_suspended_match();

-- Preserve the installed scoring and settlement contracts verbatim, adding
-- only the pool-specific void guard. Nothing is recalculated on installation.
DO $$ DECLARE definition text; needle text; target regprocedure;
BEGIN
  SELECT pg_get_functiondef('public.casa_score_polla(uuid)'::regprocedure) INTO definition;
  needle:='WHEN m.final_verified_at IS NULL';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Casa scoring differs from expected baseline'; END IF;
  EXECUTE replace(definition,needle,'WHEN EXISTS(SELECT 1 FROM public.casa_polla_matches voided
    WHERE voided.polla_id=p_polla_id AND voided.match_id=m.id AND voided.voided_at IS NOT NULL)
    OR m.final_verified_at IS NULL');

  SELECT pg_get_functiondef('public.casa_leaderboard(uuid)'::regprocedure) INTO definition;
  needle:='LEFT JOIN public.casa_picks pk ON pk.entry_id = e.id';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Casa leaderboard differs from expected baseline'; END IF;
  EXECUTE replace(definition,needle,needle||' AND NOT EXISTS(SELECT 1 FROM public.casa_polla_matches voided
    WHERE voided.polla_id=e.polla_id AND voided.match_id=pk.match_id AND voided.voided_at IS NOT NULL)');

  FOREACH target IN ARRAY ARRAY['public.casa_settle_polla(uuid)'::regprocedure,
    'public.casa_settle_polla_v2(uuid,integer,uuid,bigint)'::regprocedure] LOOP
    SELECT pg_get_functiondef(target) INTO definition;
    needle:='AND m.final_verified_at IS NULL';
    IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Casa settlement differs from expected baseline: %',target; END IF;
    EXECUTE replace(definition,needle,'AND m.final_verified_at IS NULL AND pm.voided_at IS NULL');
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.casa_guard_pick_lifecycle() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_guard_pick_lifecycle() TO service_role;

-- The SQL aggregate itself also protects upcoming matches, including delayed
-- kickoffs. Reading the same function through another endpoint stays private.
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.casa_pick_distribution(uuid)'::regprocedure) INTO definition;
  needle:='WHERE pk.polla_id = p_polla_id';
  replacement:='WHERE pk.polla_id = p_polla_id
      AND (pk.match_id IS NULL OR EXISTS(SELECT 1 FROM public.matches visible
        LEFT JOIN public.casa_polla_matches scope ON scope.match_id=visible.id AND scope.polla_id=p_polla_id
        WHERE visible.id=pk.match_id AND (scope.voided_at IS NOT NULL OR
          (visible.scheduled_at<=clock_timestamp()
            AND (visible.status IN (''live'',''finished'') OR (visible.status=''cancelled'' AND visible.elapsed>0))
            AND (visible.elapsed>0 OR upper(coalesce(visible.live_status_detail,'''')) NOT IN
              (''STATUS_SUSPENDED'',''SUSPENDED'',''SUSP'',''STATUS_INTERRUPTED'',''INTERRUPTED'',''INT''))))))';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Casa distribution differs from expected baseline'; END IF;
  EXECUTE replace(definition,needle,replacement);
END $$;
