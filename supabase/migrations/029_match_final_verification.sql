-- 029_match_final_verification.sql — Double-check antes de scorear.
--
-- Hasta ahora, en cuanto cualquier fuente (ESPN o football-data)
-- marcaba un match como `finished`, el trigger `on_match_finished`
-- disparaba el scoring (asignaba puntos a las predictions). Si la
-- fuente reportaba el score equivocado, los puntos quedaban mal y
-- corregir después era engorroso.
--
-- Ahora un match `finished` solo se scoreaba cuando AMBAS fuentes
-- coinciden en status=finished y mismo score. Eso lo controla la
-- columna nueva `final_verified_at`. Si las fuentes difieren, alertamos
-- al admin (vía notifyAdmin del lado app) y dejamos pending hasta que
-- coincidan.
--
-- Idempotente. Backwards-compatible: matches ya finalizados antes de
-- esta migration NO necesitan re-verification (los marcamos como
-- verified al aplicar la migration).

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS final_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_verification_notes text;

COMMENT ON COLUMN public.matches.final_verified_at IS
  'Timestamp del cross-check exitoso entre ESPN y football-data. NULL = match aún no terminado, o terminado sin verificación cruzada. NON-NULL = scoring está autorizado a correr.';
COMMENT ON COLUMN public.matches.final_verification_notes IS
  'Última nota de verificación (motivo del verdadero o de la discrepancia). Útil para debugging.';

-- Backfill: matches que ya están finished antes de esta migration ya
-- fueron scoreados, no tiene sentido bloquearlos. Los marcamos como
-- verified retroactivamente (con nota explícita).
UPDATE public.matches
   SET final_verified_at = COALESCE(final_verified_at, NOW()),
       final_verification_notes = COALESCE(final_verification_notes, 'auto-verified by migration 029 (legacy match)')
 WHERE status = 'finished'
   AND final_verified_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Reescribir on_match_finished
-- ─────────────────────────────────────────────────────────────────────
--
-- Cambia respecto al original: el bloque de scoring ahora exige
-- ADEMÁS que `final_verified_at IS NOT NULL`. El bloque de
-- predictions visible/locked al pasar a live NO cambia.
--
-- Caso A: match transiciona a finished con final_verified_at NULL
--         → no scoreamos. App va a llamar al verify cuando ESPN y
--         football-data coincidan, y ese UPDATE entra al trigger con
--         final_verified_at != NULL → recién ahí scoreamos.
-- Caso B: status ya era finished y este UPDATE solo setea
--         final_verified_at → el trigger detecta el flip de NULL→NOW
--         y dispara scoring igual.

CREATE OR REPLACE FUNCTION public.on_match_finished()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Scoring se dispara cuando:
  --   * el match acaba de ser declarado finished (status flip a finished), Y final_verified_at ya está seteado en este UPDATE
  --   * el match ya era finished pero acabamos de setear final_verified_at (NULL → NOW)
  IF NEW.status = 'finished'
     AND NEW.final_verified_at IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'finished' OR OLD.final_verified_at IS NULL) THEN

    -- Calculate points for each prediction of this match
    UPDATE predictions p
    SET points_earned = calculate_prediction_points(
      p.predicted_home,
      p.predicted_away,
      NEW.home_score,
      NEW.away_score,
      pol.points_exact,
      COALESCE(pol.points_goal_diff, 3),
      COALESCE(pol.points_correct_result, 2),
      pol.points_one_team
    )
    FROM pollas pol
    WHERE p.match_id = NEW.id
      AND p.polla_id = pol.id;

    -- Recalculate total points per participant in each affected polla
    UPDATE polla_participants pp
    SET total_points = (
      SELECT COALESCE(SUM(pred.points_earned), 0)
      FROM predictions pred
      WHERE pred.polla_id = pp.polla_id
        AND pred.user_id = pp.user_id
    )
    WHERE pp.polla_id IN (
      SELECT DISTINCT polla_id FROM predictions WHERE match_id = NEW.id
    );

    -- Update ranks within each affected polla
    WITH ranked AS (
      SELECT id,
             RANK() OVER (PARTITION BY polla_id ORDER BY total_points DESC) as new_rank
      FROM polla_participants
      WHERE polla_id IN (
        SELECT DISTINCT polla_id FROM predictions WHERE match_id = NEW.id
      )
    )
    UPDATE polla_participants pp
    SET rank = r.new_rank
    FROM ranked r
    WHERE pp.id = r.id;
  END IF;

  -- When match goes live, make all predictions visible and locked.
  -- Esto NO cambia respecto al original.
  IF NEW.status = 'live' AND OLD.status != 'live' THEN
    UPDATE predictions
    SET visible = true, locked = true
    WHERE match_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.on_match_finished IS
  'Trigger de scoring al pasar a finished. v2: exige final_verified_at != NULL para scorear (cross-check entre ESPN y football-data). Sin verificación, el scoring queda en pause hasta que la app la marque verified.';
