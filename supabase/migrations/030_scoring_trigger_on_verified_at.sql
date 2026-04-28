-- 030_scoring_trigger_on_verified_at.sql — Fix critical: el trigger
-- on_match_finished estaba configurado AFTER UPDATE OF status. Cuando
-- el flow correcto era status='finished' primero (sin scorear porque
-- final_verified_at=NULL) y luego SET final_verified_at=NOW() (segunda
-- UPDATE que NO disparaba el trigger porque solo escuchaba cambios de
-- status). Resultado: scoring nunca corría en matches verificados via
-- cross-check.
--
-- Fix: trigger ahora dispara en UPDATE OF status, final_verified_at.
-- Y refactoreo el body a una función public.score_match(uuid) reusable
-- para poder llamarlo manualmente cuando haga falta recover.
--
-- También incluye un loop de recovery que re-scorea matches finished
-- + verificados que tienen TODAS las predictions con points_earned=0
-- (firma del bug original). Idempotente — score_match() recalcula
-- todo desde cero por match.

-- 1. Función reusable que aplica scoring para un match dado.
CREATE OR REPLACE FUNCTION public.score_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_home_score integer;
  v_away_score integer;
BEGIN
  SELECT home_score, away_score INTO v_home_score, v_away_score
    FROM matches WHERE id = p_match_id;
  IF v_home_score IS NULL OR v_away_score IS NULL THEN
    RAISE NOTICE 'score_match(%): scores NULL, skip', p_match_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = calculate_prediction_points(
    p.predicted_home,
    p.predicted_away,
    v_home_score,
    v_away_score,
    pol.points_exact,
    COALESCE(pol.points_goal_diff, 3),
    COALESCE(pol.points_correct_result, 2),
    pol.points_one_team
  )
  FROM pollas pol
  WHERE p.match_id = p_match_id
    AND p.polla_id = pol.id;

  UPDATE polla_participants pp
  SET total_points = (
    SELECT COALESCE(SUM(pred.points_earned), 0)
    FROM predictions pred
    WHERE pred.polla_id = pp.polla_id
      AND pred.user_id = pp.user_id
  )
  WHERE pp.polla_id IN (
    SELECT DISTINCT polla_id FROM predictions WHERE match_id = p_match_id
  );

  WITH ranked AS (
    SELECT id,
           RANK() OVER (PARTITION BY polla_id ORDER BY total_points DESC) as new_rank
    FROM polla_participants
    WHERE polla_id IN (
      SELECT DISTINCT polla_id FROM predictions WHERE match_id = p_match_id
    )
  )
  UPDATE polla_participants pp
  SET rank = r.new_rank
  FROM ranked r
  WHERE pp.id = r.id;
END;
$function$;

COMMENT ON FUNCTION public.score_match IS
  'Aplica scoring (puntos a predictions + recálculo total + rank) para un match. Llamado desde el trigger on_match_finished y manualmente para recovery.';

-- 2. Reescribir on_match_finished para llamar score_match(). Trigger
--    ahora también escucha cambios de final_verified_at.
CREATE OR REPLACE FUNCTION public.on_match_finished()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'finished'
     AND NEW.final_verified_at IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'finished' OR OLD.final_verified_at IS NULL) THEN
    PERFORM public.score_match(NEW.id);
  END IF;

  IF NEW.status = 'live' AND OLD.status != 'live' THEN
    UPDATE predictions SET visible = true, locked = true WHERE match_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Reemplazar el trigger con uno que dispare en ambas columnas.
DROP TRIGGER IF EXISTS trigger_match_status_change ON matches;
CREATE TRIGGER trigger_match_status_change
  AFTER UPDATE OF status, final_verified_at ON matches
  FOR EACH ROW EXECUTE FUNCTION on_match_finished();

-- 4. Recovery: re-scorear matches que están finished + verified pero
--    que tienen TODAS las predictions con points_earned=0.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT m.id
    FROM matches m
    JOIN predictions pr ON pr.match_id = m.id
    WHERE m.status = 'finished'
      AND m.final_verified_at IS NOT NULL
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND pr.points_earned = 0
    GROUP BY m.id
    HAVING bool_and(pr.points_earned = 0)
  LOOP
    RAISE NOTICE 'Re-scoring match %', rec.id;
    PERFORM public.score_match(rec.id);
  END LOOP;
END $$;
