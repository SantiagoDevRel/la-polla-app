-- Install in legacy mode. The row lock is a deployment barrier, not auth.
CREATE OR REPLACE FUNCTION public.casa_v2_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m text; p_id uuid; p public.casa_pollas;
BEGIN
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton FOR SHARE;
  IF m='legacy' THEN RETURN NEW; END IF;
  IF m='paused' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPERATIONS_PAUSED'; END IF;
  IF current_setting('app.casa_contract',true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPDATE_REQUIRED';
  END IF;
  IF TG_TABLE_NAME='casa_pollas' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.status IN ('resuelta','anulada') AND (
        (to_jsonb(NEW)-ARRAY['archived_at','archived_by','updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['archived_at','archived_by','updated_at'])
      ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_FINAL'; END IF;
      IF EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=OLD.id AND state='pending') THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PENDING';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='casa_entries' THEN p_id:=NEW.polla_id;
  ELSIF TG_TABLE_NAME='casa_questions' THEN p_id:=NEW.polla_id;
  ELSIF TG_TABLE_NAME='casa_polla_matches' THEN p_id:=NEW.polla_id;
  ELSIF TG_TABLE_NAME='casa_options' THEN
    SELECT polla_id INTO p_id FROM public.casa_questions WHERE id=NEW.question_id;
  ELSIF TG_TABLE_NAME='casa_payouts' THEN
    IF TG_OP='UPDATE' THEN
      IF (to_jsonb(NEW)-ARRAY['paid_at','delivered_at','delivered_by','delivery_reference']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['paid_at','delivered_at','delivered_by','delivery_reference']) THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='AWARD_IMMUTABLE';
      END IF;
      IF OLD.delivered_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DELIVERY_RECORDED';
      END IF;
    END IF;
    RETURN NEW;
  ELSE RETURN NEW;
  END IF;
  -- New RPCs hold parent before child. A legacy/direct child writer must fail
  -- rather than deadlock against the parent->child order used by settlement.
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p.archived_at IS NOT NULL OR p.status IN ('resuelta','anulada') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_FINAL';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PENDING';
  END IF;
  IF TG_TABLE_NAME='casa_entries' THEN
    IF NEW.current_proof_attempt_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.casa_entry_proof_attempts a
      WHERE a.id=NEW.current_proof_attempt_id AND a.entry_id=NEW.id AND a.user_id=NEW.user_id
        AND (NEW.proof_path IS NULL OR (a.state='confirmed' AND a.proof_path=NEW.proof_path))
    ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PROOF_ATTEMPT_MISMATCH'; END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status='pagada' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_PAID';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER casa_00_contract BEFORE UPDATE ON public.casa_pollas
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_entries
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_questions
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_payouts
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_entry_proof_attempts
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_object_draws
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_object_draw_candidates
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();
CREATE TRIGGER casa_00_contract BEFORE INSERT OR UPDATE ON public.casa_draw_confirmation_attempts
  FOR EACH ROW EXECUTE FUNCTION public.casa_v2_write_guard();

REVOKE ALL ON FUNCTION public.casa_v2_write_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_v2_write_guard() TO service_role;

-- Replace the existing entry guard to use NOWAIT for direct/legacy writers.
-- casa_00_contract executes first, checking v2 and pending-draw invariants.
CREATE OR REPLACE FUNCTION public.casa_guard_entry_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status public.casa_polla_status; v_archived_at timestamptz;
BEGIN
  IF TG_OP='UPDATE' AND NEW.polla_id IS DISTINCT FROM OLD.polla_id THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='No se puede mover una inscripción a otra polla.';
  END IF;
  SELECT status,archived_at INTO v_status,v_archived_at FROM public.casa_pollas WHERE id=NEW.polla_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_archived_at IS NOT NULL OR v_status IN ('resuelta','anulada') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esta polla ya finalizó o se archivó. Sus pagos no pueden cambiar.';
  END IF;
  IF NEW.status='pagada' AND v_status NOT IN ('abierta','cerrada') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Publica la polla antes de aprobar pagos.';
  END IF;
  RETURN NEW;
END $$;

-- Guard scoring-only writes too: finalized scores/candidates cannot change.
-- Keep 091's original authoring guard on picks. This one only handles scoring.
CREATE FUNCTION public.casa_frozen_score_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  IF NEW.points_earned IS NOT DISTINCT FROM OLD.points_earned THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=NEW.polla_id FOR UPDATE NOWAIT;
  IF p.status IN ('resuelta','anulada') OR p.archived_at IS NOT NULL OR
    EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RESULT_FROZEN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER casa_frozen_score BEFORE UPDATE OF points_earned ON public.casa_picks
  FOR EACH ROW EXECUTE FUNCTION public.casa_frozen_score_guard();
REVOKE ALL ON FUNCTION public.casa_frozen_score_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_frozen_score_guard() TO service_role;

-- Patch only the function's preflight, retaining the authoritative scoring
-- expressions from the installed version verbatim. No scoring is run here.
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.casa_score_polla(uuid)'::regprocedure) INTO definition;
  needle := 'SELECT * INTO v_polla FROM public.casa_pollas WHERE id = p_polla_id;';
  replacement := 'SELECT * INTO v_polla FROM public.casa_pollas WHERE id = p_polla_id FOR UPDATE;
  IF FOUND AND (v_polla.status IN (''resuelta'',''anulada'') OR v_polla.archived_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p_polla_id)) THEN RETURN 0; END IF;';
  IF position(needle IN definition)=0 THEN
    RAISE EXCEPTION 'Scoring preflight differs from expected baseline; inspect before applying';
  END IF;
  EXECUTE replace(definition,needle,replacement);
END $$;
