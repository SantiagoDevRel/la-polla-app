-- 074_double_points_octavos_survey.sql
--
-- Encuesta por polla: "¿Los puntos valen el DOBLE desde OCTAVOS DE FINAL?"
-- Pedido del owner 2026-06-27. Mayoría decide; el admin confirma en /admin
-- (mismo patrón que la encuesta goles_v2 — migraciones 072/073).
--
-- Reglas de producto (decisión Santiago 2026-06-27):
--   - El doble cuenta DESDE OCTAVOS (round_of_16) en adelante:
--       round_of_16 · quarter_finals · semi_finals · third_place · final  → x2
--   - Los DIECISEISAVOS (round_of_32 / "16vos") NO se doblan. La fase de
--     grupos tampoco. (El Mundial 48 es el único torneo con round_of_32
--     antes de octavos — por eso hay que distinguir explícitamente.)
--   - Por-polla, no global. Solo afecta a la polla que lo aprueba.
--   - Alcance: pollas activas del Mundial con >=2 pagados. La votación se
--     ofrece via popup; el admin la implementa.
--
-- Esta migración es ADITIVA. `double_from_octavos` arranca en false para
-- TODAS las pollas, así que NO cambia ningún puntaje hasta que el admin
-- implemente el cambio en una polla concreta. El multiplicador envuelve el
-- scorer existente (classic O goles_v2): octavos+ = base x2.
--
-- NO retroactivo en la práctica: octavos aún no se juegan cuando se vota
-- (primer octavos = 2026-07-04). El doble es por FASE, así que grupos y
-- 16vos ya jugados nunca se tocan. `double_decided_at` queda como sello de
-- auditoría (cuándo lo implementó el admin).

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas en pollas.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS double_from_octavos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS double_survey_open  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS double_decided_at   timestamptz;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Tabla de votos de la encuesta. Un voto por (polla, usuario).
--    Espejo de scoring_survey_votes (072).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.double_survey_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id uuid NOT NULL REFERENCES public.pollas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN ('si', 'no')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (polla_id, user_id)
);

ALTER TABLE public.double_survey_votes ENABLE ROW LEVEL SECURITY;

-- GRANT explícitos para la Data API (deadline Supabase 30-oct-2026).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.double_survey_votes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.double_survey_votes TO service_role;

-- Defense-in-depth: cada quien ve/escribe solo su voto. (La app igual va
-- por admin client + filtro user_id explícito porque auth.uid() retorna
-- NULL en el request context de PostgREST — ver CLAUDE.md.)
DROP POLICY IF EXISTS dsv_own_rows ON public.double_survey_votes;
CREATE POLICY dsv_own_rows ON public.double_survey_votes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS double_survey_votes_polla_idx
  ON public.double_survey_votes (polla_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. score_match — ahora aplica el multiplicador x2 a octavos+ cuando la
--    polla tiene double_from_octavos=true. Reescribe la versión 073
--    (REGLA #5: hot-patch = migración). El multiplicador ENVUELVE el
--    scorer base (classic o goles_v2): octavos+ = base * 2.
--
--    Octavos+ = round_of_16, quarter_finals, semi_finals, third_place,
--    final. round_of_32 (16vos) y group_stage NO se doblan.
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
  v_phase text;
BEGIN
  SELECT home_score, away_score, scheduled_at, phase
    INTO v_home_score, v_away_score, v_scheduled_at, v_phase
    FROM matches WHERE id = p_match_id;
  IF v_home_score IS NULL OR v_away_score IS NULL THEN
    RAISE NOTICE 'score_match(%): scores NULL, skip', p_match_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = (
    CASE
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
  ) * (
    -- Multiplicador por fase: octavos+ valen doble si la polla lo aprobó.
    CASE
      WHEN pol.double_from_octavos = true
           AND v_phase IN ('round_of_16','quarter_finals','semi_finals','third_place','final')
      THEN 2 ELSE 1
    END
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

-- ─────────────────────────────────────────────────────────────────────
-- 4. rescore_polla — recalcula UNA polla respetando cutoff goles_v2 +
--    multiplicador del doble. Idempotente. Lo llama el endpoint admin tras
--    implementar el doble (re-dobla octavos+ ya jugados, si los hubiera).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rescore_polla(p_polla_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode text;
  v_changed_at timestamptz;
  v_double boolean;
BEGIN
  SELECT scoring_mode, scoring_mode_changed_at, double_from_octavos
    INTO v_mode, v_changed_at, v_double
    FROM pollas WHERE id = p_polla_id;
  IF v_mode IS NULL THEN
    RAISE NOTICE 'rescore_polla(%): polla no existe, skip', p_polla_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = (
    CASE
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
  ) * (
    CASE
      WHEN v_double = true
           AND m.phase IN ('round_of_16','quarter_finals','semi_finals','third_place','final')
      THEN 2 ELSE 1
    END
  )
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
-- 5. Abrir la encuesta del doble para pollas ACTIVAS del Mundial con
--    >=2 pagados. (Las de 1 sola persona no tienen votación que valga.)
--    Idempotente: solo prende donde double_from_octavos sigue false.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.pollas p
SET double_survey_open = true
WHERE p.status = 'active'
  AND p.double_from_octavos = false
  AND (
    p.tournament = 'worldcup_2026'
    OR p.tournaments @> ARRAY['worldcup_2026']::text[]
  )
  AND (
    SELECT count(*) FROM polla_participants pp
    WHERE pp.polla_id = p.id AND pp.paid = true
  ) >= 2;

-- Para revertir una polla (volver a contar octavos normal):
--   UPDATE pollas SET double_from_octavos=false, double_decided_at=NULL
--     WHERE id='...';  -- luego SELECT rescore_polla('...') para recalcular.
