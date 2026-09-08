-- Soft deletion preserves every inscription, pick, payment and payout.
-- Apply before deploying the archive filters and controls. No data cleanup.
ALTER TABLE public.casa_pollas
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS casa_pollas_unarchived_idx
  ON public.casa_pollas (created_at DESC) WHERE archived_at IS NULL;

ALTER POLICY casa_pollas_read ON public.casa_pollas
  USING (status <> 'borrador' AND archived_at IS NULL);

-- All entry writers (web, Telegram, uploads) serialize against settlement and
-- archive by locking the parent row. A UI/API preflight alone has a race.
CREATE OR REPLACE FUNCTION public.casa_guard_entry_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_status public.casa_polla_status;
  v_archived_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.polla_id IS DISTINCT FROM OLD.polla_id THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'No se puede mover una inscripción a otra polla.';
  END IF;
  SELECT status, archived_at INTO v_status, v_archived_at
    FROM public.casa_pollas WHERE id = NEW.polla_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'No existe esa polla.';
  END IF;
  IF v_archived_at IS NOT NULL OR v_status IN ('resuelta', 'anulada') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Esta polla ya se repartió, se anuló o se eliminó. Sus pagos no pueden cambiar.';
  END IF;
  IF NEW.status = 'pagada' AND v_status NOT IN ('abierta', 'cerrada') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Publica la polla antes de aprobar pagos.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER casa_entries_lifecycle_guard
  BEFORE INSERT OR UPDATE ON public.casa_entries
  FOR EACH ROW EXECUTE FUNCTION public.casa_guard_entry_lifecycle();

REVOKE EXECUTE ON FUNCTION public.casa_guard_entry_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_guard_entry_lifecycle() TO service_role;

-- A request may have passed the public-page preflight before archival. Only
-- user-authored pick changes take the parent lock; scoring-only updates stay
-- allowed. NOWAIT prevents a pick-row -> parent-row lock inversion against
-- settlement, which locks the parent before scoring those same pick rows.
CREATE OR REPLACE FUNCTION public.casa_guard_pick_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_status public.casa_polla_status;
  v_archived_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - 'points_earned' - 'updated_at') IS NOT DISTINCT FROM
    (to_jsonb(OLD) - 'points_earned' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT status, archived_at INTO v_status, v_archived_at
      FROM public.casa_pollas WHERE id = NEW.polla_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'La polla se está actualizando. Intenta guardar de nuevo.';
  END;
  IF NOT FOUND OR v_archived_at IS NOT NULL OR v_status <> 'abierta' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Esta polla ya no recibe pronósticos. Los anteriores se conservaron.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER casa_picks_lifecycle_guard
  BEFORE INSERT OR UPDATE ON public.casa_picks
  FOR EACH ROW EXECUTE FUNCTION public.casa_guard_pick_lifecycle();

REVOKE EXECUTE ON FUNCTION public.casa_guard_pick_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_guard_pick_lifecycle() TO service_role;

-- Retains the SQL money/scoring formula from 082. Lifecycle checks and the
-- parent lock now happen BEFORE reading the pot, scoring or writing payouts.
-- Repeated settlement is rejected; historical payouts are never deleted.
CREATE OR REPLACE FUNCTION public.casa_settle_polla(p_polla_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_polla record;
  v_prize bigint;
  v_winners integer := 0;
  v_each bigint := 0;
  v_top integer;
  v_remainder bigint := 0;
BEGIN
  SELECT id, kind, status, archived_at, drawn_number, draw_method
    INTO v_polla FROM public.casa_pollas
    WHERE id = p_polla_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'No existe esa polla.';
  END IF;
  IF v_polla.archived_at IS NOT NULL OR v_polla.status <> 'cerrada' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Solo se puede repartir una polla cerrada que no se haya eliminado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.casa_entries
             WHERE polla_id = p_polla_id AND status = 'pendiente' AND proof_path IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Revisa todos los comprobantes pendientes antes de repartir el pozo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.casa_payouts WHERE polla_id = p_polla_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Esta polla ya tiene un reparto registrado.';
  END IF;
  IF v_polla.kind = 'partidos' AND EXISTS (
    SELECT 1 FROM public.casa_polla_matches pm
    JOIN public.matches m ON m.id = pm.match_id
    WHERE pm.polla_id = p_polla_id AND m.final_verified_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Faltan partidos por verificar antes de repartir.';
  END IF;
  IF v_polla.kind = 'manual' AND EXISTS (
    SELECT 1 FROM public.casa_questions WHERE polla_id = p_polla_id AND resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Faltan preguntas por resolver antes de repartir.';
  END IF;
  IF v_polla.kind = 'rifa' AND v_polla.drawn_number IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Falta el número ganador de la rifa.';
  END IF;

  SELECT prize_cop INTO v_prize FROM public.casa_polla_pot(p_polla_id);
  v_prize := COALESCE(v_prize, 0);

  IF v_polla.kind = 'rifa' THEN
    INSERT INTO public.casa_payouts (polla_id, user_id, place, points, amount_cop, note)
    SELECT p_polla_id, e.user_id, 1, NULL, v_prize,
           'Boleta ' || e.ticket_number || ' — ' || v_polla.draw_method
    FROM public.casa_entries e
    WHERE e.polla_id = p_polla_id AND e.status = 'pagada'
      AND e.ticket_number = v_polla.drawn_number;
    GET DIAGNOSTICS v_winners = ROW_COUNT;
    v_each := CASE WHEN v_winners > 0 THEN v_prize ELSE 0 END;
  ELSE
    PERFORM public.casa_score_polla(p_polla_id);
    SELECT MAX(points) INTO v_top FROM public.casa_leaderboard(p_polla_id);
    v_top := COALESCE(v_top, 0);
    SELECT COUNT(*) INTO v_winners
      FROM public.casa_leaderboard(p_polla_id) WHERE points = v_top;
    IF v_winners > 0 THEN
      v_each := FLOOR(v_prize / v_winners);
      v_remainder := v_prize - (v_each * v_winners);
      INSERT INTO public.casa_payouts (polla_id, user_id, place, points, amount_cop, note)
      SELECT p_polla_id, lb.user_id, 1, lb.points, v_each,
        CASE WHEN v_winners > 1
          THEN 'Empate en ' || v_top || ' pts — pozo dividido entre ' || v_winners
          ELSE NULL END
      FROM public.casa_leaderboard(p_polla_id) lb WHERE lb.points = v_top;
    END IF;
  END IF;

  UPDATE public.casa_pollas SET status = 'resuelta', settled_at = now(),
    settle_notes = COALESCE(settle_notes, '') || CASE WHEN v_remainder > 0
      THEN ' [sobrante por redondeo: $' || v_remainder || ' queda en la casa]'
      ELSE '' END
    WHERE id = p_polla_id;

  RETURN jsonb_build_object('polla_id', p_polla_id, 'kind', v_polla.kind,
    'prize_cop', v_prize, 'winners', v_winners, 'each_cop', v_each,
    'remainder', v_remainder, 'top_points', v_top);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.casa_settle_polla(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_settle_polla(uuid) TO service_role;
