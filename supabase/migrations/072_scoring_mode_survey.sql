-- 072_scoring_mode_survey.sql — Modo de puntaje alterno por polla
-- ("goles_v2") + encuesta in-app para que los participantes de UNA polla
-- decidan si lo adoptan.
--
-- Contexto: la "Polla Mundialista" de Pipe (id 87b118bb-…) quiere votar un
-- sistema de puntos distinto que premia más la diferencia de gol y separa
-- "ganador + un marcador" como tier propio. El sistema clásico (5/3/2/1/0)
-- vive en 4 columnas numéricas de `pollas`; el nuevo tiene 6 niveles que
-- esas 4 columnas no pueden representar, así que se modela como un MODO.
--
-- Escalera goles_v2 (decisión Santiago 2026-06-17):
--   5  marcador exacto
--   4  ganador + diferencia de gol (mismo diff, no exacto)
--   3  ganador + un marcador (acertaste el gol de un equipo, diff distinta)
--   2  ganador solo (ni diff ni marcador)
--   1  un marcador (ganador errado)
--   0  nada
--
-- vs el clásico de esa polla hoy: 5 / 3 (dif) / 2 (ganador, con o sin
-- marcador) / 1 / 0. Cambio neto: dif 3→4 y se premia ganador+marcador con 3.
--
-- Esta migración es ADITIVA y NO cambia ningún puntaje: scoring_mode arranca
-- en 'classic' para todas las pollas. Solo prende la encuesta (UI) para la
-- polla de Pipe. El cambio real de puntaje ocurre cuando el admin llame a
-- public.rescore_polla() tras aplicar el modo (endpoint /api/admin).

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas en pollas.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS scoring_mode text NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS scoring_survey_open boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pollas_scoring_mode_chk'
  ) THEN
    ALTER TABLE public.pollas
      ADD CONSTRAINT pollas_scoring_mode_chk
      CHECK (scoring_mode IN ('classic', 'goles_v2'));
  END IF;
END $$;

-- Prende la encuesta SOLO para la Polla Mundialista de Pipe.
UPDATE public.pollas
SET scoring_survey_open = true
WHERE id = '87b118bb-a19d-4806-b080-735d4a7e6f99';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Tabla de votos de la encuesta. Un voto por (polla, usuario).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scoring_survey_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id uuid NOT NULL REFERENCES public.pollas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN ('si', 'no')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (polla_id, user_id)
);

ALTER TABLE public.scoring_survey_votes ENABLE ROW LEVEL SECURITY;

-- GRANT explícitos para la Data API (deadline Supabase 30-oct-2026).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scoring_survey_votes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scoring_survey_votes TO service_role;

-- Defense-in-depth: cada quien ve/escribe solo su voto. (La app igual va
-- por admin client + filtro user_id explícito porque auth.uid() retorna
-- NULL en el request context de PostgREST — ver CLAUDE.md.)
DROP POLICY IF EXISTS ssv_own_rows ON public.scoring_survey_votes;
CREATE POLICY ssv_own_rows ON public.scoring_survey_votes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS scoring_survey_votes_polla_idx
  ON public.scoring_survey_votes (polla_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Motor de puntaje goles_v2.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calc_points_goles_v2(
  p_predicted_home integer,
  p_predicted_away integer,
  p_actual_home integer,
  p_actual_away integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  pred_outcome int;
  actual_outcome int;
  one_team boolean;
BEGIN
  -- 5: marcador exacto
  IF p_predicted_home = p_actual_home AND p_predicted_away = p_actual_away THEN
    RETURN 5;
  END IF;

  pred_outcome := SIGN(p_predicted_home - p_predicted_away);
  actual_outcome := SIGN(p_actual_home - p_actual_away);
  one_team := (p_predicted_home = p_actual_home OR p_predicted_away = p_actual_away);

  IF pred_outcome = actual_outcome THEN
    -- ganador correcto (incluye empate predicho = empate real)
    -- 4: misma diferencia de gol (no es exacto → ningún marcador coincide)
    IF (p_predicted_home - p_predicted_away) = (p_actual_home - p_actual_away) THEN
      RETURN 4;
    END IF;
    -- 3: ganador + acertaste el marcador de un equipo
    IF one_team THEN
      RETURN 3;
    END IF;
    -- 2: ganador solo
    RETURN 2;
  END IF;

  -- ganador errado
  -- 1: acertaste el marcador de un equipo
  IF one_team THEN
    RETURN 1;
  END IF;

  -- 0: nada
  RETURN 0;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.calc_points_goles_v2(integer, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calc_points_goles_v2(integer, integer, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.calc_points_goles_v2(integer, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calc_points_goles_v2(integer, integer, integer, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. score_match ahora ramifica por pollas.scoring_mode. Reescribe la
--    versión del snapshot 061 (REGLA #5: hot-patch = migración).
-- ─────────────────────────────────────────────────────────────────────
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
  SET points_earned = CASE
    WHEN pol.scoring_mode = 'goles_v2' THEN
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
-- 5. rescore_polla(p_polla_id) — recalcula TODA una polla bajo su
--    scoring_mode actual. Lo llama el endpoint admin tras aplicar el modo.
--    Solo toca esa polla (no roza otras que compartan partidos).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rescore_polla(p_polla_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode text;
BEGIN
  SELECT scoring_mode INTO v_mode FROM pollas WHERE id = p_polla_id;
  IF v_mode IS NULL THEN
    RAISE NOTICE 'rescore_polla(%): polla no existe, skip', p_polla_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = CASE
    WHEN v_mode = 'goles_v2' THEN
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

REVOKE EXECUTE ON FUNCTION public.rescore_polla(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rescore_polla(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rescore_polla(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rescore_polla(uuid) TO service_role;
