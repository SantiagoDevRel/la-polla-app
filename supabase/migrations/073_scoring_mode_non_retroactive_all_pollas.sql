-- 073_scoring_mode_non_retroactive_all_pollas.sql
--
-- Dos cambios sobre la encuesta de puntaje (migración 072):
--
-- 1) NO RETROACTIVO. Antes, aplicar goles_v2 re-scoreaba TODOS los partidos
--    ya jugados de la polla. Decisión Santiago 2026-06-17: el cambio NO toca
--    los puntos ya ganados — cuenta SOLO de ahí en adelante. Se ancla por
--    `pollas.scoring_mode_changed_at` (el momento en que el admin implementa)
--    comparado contra `matches.scheduled_at` (kickoff): un partido cuenta con
--    goles_v2 únicamente si su kickoff es >= changed_at. Los partidos previos
--    conservan su puntaje classic congelado.
--
-- 2) La encuesta se abre para TODAS las pollas activas con >=2 participantes
--    pagados (las pollas reales con grupo; las de 1 sola persona no tienen
--    "votación" que valga).
--
-- Aditiva y segura: scoring_mode sigue default 'classic'. Ningún punto se
-- recalcula por esta migración — solo prende encuestas y reescribe las
-- funciones de scoring para que respeten el cutoff.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Ancla temporal del cambio de modo.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS scoring_mode_changed_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────
-- 2. score_match — non-retroactive. Para cada predicción del match:
--    goles_v2 SOLO si la polla está en goles_v2 Y el kickoff del match es
--    >= scoring_mode_changed_at. Si no, classic (incluye todo el pasado).
--    Nota: score_match solo reescribe las predicciones del match actual, así
--    que el pasado ya verificado nunca se toca de todas formas; el cutoff es
--    defensa extra ante re-scores / correcciones.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.score_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_home_score integer;
  v_away_score integer;
  v_scheduled_at timestamptz;
BEGIN
  SELECT home_score, away_score, scheduled_at
    INTO v_home_score, v_away_score, v_scheduled_at
    FROM matches WHERE id = p_match_id;
  IF v_home_score IS NULL OR v_away_score IS NULL THEN
    RAISE NOTICE 'score_match(%): scores NULL, skip', p_match_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = CASE
    WHEN pol.scoring_mode = 'goles_v2'
         AND pol.scoring_mode_changed_at IS NOT NULL
         AND v_scheduled_at IS NOT NULL
         AND v_scheduled_at >= pol.scoring_mode_changed_at THEN
      calc_points_goles_v2(p.predicted_home, p.predicted_away, v_home_score, v_away_score)
    ELSE
      calculate_prediction_points(
        p.predicted_home,
        p.predicted_away,
        v_home_score,
        v_away_score,
        pol.points_exact,
        COALESCE(pol.points_goal_diff, 3),
        COALESCE(pol.points_correct_result, 2),
        pol.points_one_team
      )
  END
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

-- ─────────────────────────────────────────────────────────────────────
-- 3. rescore_polla — recalcula UNA polla respetando el cutoff no-retroactivo.
--    Pasado (kickoff < changed_at) => classic; futuro => goles_v2.
--    Idempotente y seguro de llamar en cualquier momento.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rescore_polla(p_polla_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode text;
  v_changed_at timestamptz;
BEGIN
  SELECT scoring_mode, scoring_mode_changed_at
    INTO v_mode, v_changed_at
    FROM pollas WHERE id = p_polla_id;
  IF v_mode IS NULL THEN
    RAISE NOTICE 'rescore_polla(%): polla no existe, skip', p_polla_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = CASE
    WHEN v_mode = 'goles_v2'
         AND v_changed_at IS NOT NULL
         AND m.scheduled_at IS NOT NULL
         AND m.scheduled_at >= v_changed_at THEN
      calc_points_goles_v2(p.predicted_home, p.predicted_away, m.home_score, m.away_score)
    ELSE
      calculate_prediction_points(
        p.predicted_home, p.predicted_away, m.home_score, m.away_score,
        pol.points_exact,
        COALESCE(pol.points_goal_diff, 3),
        COALESCE(pol.points_correct_result, 2),
        pol.points_one_team
      )
  END
  FROM matches m, pollas pol
  WHERE p.polla_id = p_polla_id
    AND pol.id = p_polla_id
    AND m.id = p.match_id
    AND m.status = 'finished'
    AND m.final_verified_at IS NOT NULL
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL;

  UPDATE polla_participants pp
  SET total_points = (
    SELECT COALESCE(SUM(pred.points_earned), 0)
    FROM predictions pred
    WHERE pred.polla_id = pp.polla_id
      AND pred.user_id = pp.user_id
  )
  WHERE pp.polla_id = p_polla_id;

  WITH ranked AS (
    SELECT id,
           RANK() OVER (ORDER BY total_points DESC) as new_rank
    FROM polla_participants
    WHERE polla_id = p_polla_id
      AND paid = true
  )
  UPDATE polla_participants pp
  SET rank = r.new_rank
  FROM ranked r
  WHERE pp.id = r.id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Abrir la encuesta para todas las pollas ACTIVAS con >=2 pagados.
--    (Las de 1 sola persona no tienen votación que valga.)
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.pollas p
SET scoring_survey_open = true
WHERE p.status = 'active'
  AND p.scoring_mode = 'classic'
  AND (
    SELECT count(*) FROM polla_participants pp
    WHERE pp.polla_id = p.id AND pp.paid = true
  ) >= 2;
