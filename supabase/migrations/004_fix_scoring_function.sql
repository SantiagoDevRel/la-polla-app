-- ============================================================
-- 004_fix_scoring_function.sql
-- Fixes scoring divergence: adds goal_diff and correct_result
-- columns to pollas, rewrites calculate_prediction_points to
-- use exclusive tiers (highest match wins, no stacking), and
-- updates the on_match_finished trigger to pass new params.
-- ============================================================

-- 1. Add missing scoring columns to pollas
ALTER TABLE pollas
  ADD COLUMN IF NOT EXISTS points_goal_diff int DEFAULT 3,
  ADD COLUMN IF NOT EXISTS points_correct_result int DEFAULT 2;

COMMENT ON COLUMN pollas.points_goal_diff IS
  'Points for correct winner + same goal difference (default 3)';
COMMENT ON COLUMN pollas.points_correct_result IS
  'Points for correct winner only (default 2)';

-- 2. Replace calculate_prediction_points with exclusive-tier logic
CREATE OR REPLACE FUNCTION calculate_prediction_points(
  p_predicted_home int,
  p_predicted_away int,
  p_actual_home int,
  p_actual_away int,
  p_points_exact int,
  p_points_goal_diff int,
  p_points_correct_result int,
  p_points_one_team int
) RETURNS int AS $$
DECLARE
  pred_diff int;
  actual_diff int;
  pred_outcome int;
  actual_outcome int;
BEGIN
  -- Tier 1: Exact score match
  IF p_predicted_home = p_actual_home AND p_predicted_away = p_actual_away THEN
    RETURN p_points_exact;
  END IF;

  -- Calculate winner outcome: 1=home, -1=away, 0=draw
  pred_outcome := SIGN(p_predicted_home - p_predicted_away);
  actual_outcome := SIGN(p_actual_home - p_actual_away);

  -- Check if winner is correct
  IF pred_outcome = actual_outcome THEN
    -- Tier 2: Correct winner + same goal difference
    pred_diff := p_predicted_home - p_predicted_away;
    actual_diff := p_actual_home - p_actual_away;
    IF pred_diff = actual_diff THEN
      RETURN p_points_goal_diff;
    END IF;

    -- Tier 3: Correct winner only
    RETURN p_points_correct_result;
  END IF;

  -- Tier 4: One team score exact (wrong winner)
  IF p_predicted_home = p_actual_home OR p_predicted_away = p_actual_away THEN
    RETURN p_points_one_team;
  END IF;

  -- Tier 5: Nothing
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 3. Update on_match_finished trigger to pass new parameters
CREATE OR REPLACE FUNCTION on_match_finished() RETURNS trigger AS $$
BEGIN
  -- Only act when status changes to 'finished'
  IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
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

  -- When match goes live, make all predictions visible and locked
  IF NEW.status = 'live' AND OLD.status != 'live' THEN
    UPDATE predictions
    SET visible = true, locked = true
    WHERE match_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: The trigger trigger_match_status_change already exists and
-- references on_match_finished(), so it picks up the new function
-- body automatically. No need to recreate it.
