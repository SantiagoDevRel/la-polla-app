-- 077_carvalho_120min_advance_bonus.sql
--
-- Modo de puntaje POR POLLA para "La Polla de Carvalho"
-- (id 56ca95a7-cded-482b-ab31-8f8d7089618f). Pedido del owner via la
-- organizadora de Carvalho (2026-06-30). Dos flags componibles, con CUTOFFS
-- SEPARADOS (decisión Santiago 2026-06-30):
--
--   (1) score_120     → los KNOCKOUTS puntúan con el MARCADOR DE 120'
--                       (90' + alargue), no con los 90'. Un empate a 120'
--                       es válido (el partido se fue a penales); los penales
--                       solo definen quién avanza, NO suman al marcador.
--                       Cutoff = kc_mode_changed_at (arranca HOY).
--
--   (2) advance_bonus → +1 PLANO por acertar quién avanza a la siguiente
--                       ronda (el ganador del cruce, incluidos penales).
--                       El +1 va POR FUERA del x2 de octavos (NO se dobla).
--                       Cutoff = advance_bonus_from (arranca MAÑANA — la gente
--                       que ya pronosticó hoy no tuvo chance de elegir ganador,
--                       así que el bonus no aplica al partido de hoy).
--
-- Ambos SOLO en fases de knockout (16vos / round_of_32 en adelante) y SOLO a
-- partidos con kickoff >= su respectivo cutoff (NO retroactivo). Top-down (sin
-- encuesta).
--
-- ADITIVA y NEUTRA: score_120 y advance_bonus arrancan en false para TODAS
-- las pollas → con los flags en false el scorer da EXACTAMENTE el mismo
-- resultado que la versión 074. No cambia ningún puntaje hasta que el admin
-- lo prenda en Carvalho.
--
-- Composición con lo que esa polla ya tiene (goles_v2 + double_from_octavos):
--   eff_score = score_120 activo (knockout + cutoff) ? COALESCE(120', 90') : 90'
--   base      = goles_v2(pred, eff_score)            -- score_120 cambia la fuente
--   doblado   = base * (2 si octavos+, 1 si 16vos)   -- double_from_octavos, intacto
--   total     = doblado + (1 si acertó quién avanza) -- +1 plano, por fuera del x2
--
-- Fuente de 120'/penales/avance: ESPN (competitor.score = marcador 120',
-- shootoutScore = penales, winner = quién avanzó). Ver lib/espn/* y
-- lib/matches/verify-final.ts. Si la captura falla, el scorer DEGRADA SEGURO:
-- cae al 90' (COALESCE) y deriva el avance del marcador decisivo cuando lo es.
--
-- REGLA #5: este es el snapshot autoritativo de score_match/rescore_polla
-- desde acá; basate en 077, no en 074.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Flags nuevos en pollas + dos sellos de activación (cutoffs no-retro).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS score_120          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS advance_bonus      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kc_mode_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS advance_bonus_from timestamptz;

COMMENT ON COLUMN public.pollas.score_120 IS
  'Si true, los knockouts de esta polla puntuan con el marcador de 120 (alargue), no los 90. Gated por kc_mode_changed_at + fase knockout (no retroactivo).';
COMMENT ON COLUMN public.pollas.advance_bonus IS
  'Si true, +1 PLANO por acertar quien avanza (predictions.advance_pick == matches.advancer). Por fuera del x2 de octavos. Gated por advance_bonus_from.';
COMMENT ON COLUMN public.pollas.kc_mode_changed_at IS
  'Cutoff de score_120. Solo afecta knockouts con scheduled_at >= este valor (no retroactivo).';
COMMENT ON COLUMN public.pollas.advance_bonus_from IS
  'Cutoff del +1 de avance. Solo cuenta para knockouts con scheduled_at >= este valor. Puede ser distinto (posterior) a kc_mode_changed_at.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Datos de cierre extendidos en matches: 120', penales, quien avanzo.
--    Poblados al finalizar un knockout desde ESPN (verify-final.ts). NULL
--    para partidos sin captura → el scorer cae al 90' (COALESCE) y deriva
--    el avance del marcador decisivo.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS fulltime_home_score integer,
  ADD COLUMN IF NOT EXISTS fulltime_away_score integer,
  ADD COLUMN IF NOT EXISTS penalty_home        integer,
  ADD COLUMN IF NOT EXISTS penalty_away        integer,
  ADD COLUMN IF NOT EXISTS advancer            text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matches_advancer_chk'
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_advancer_chk
      CHECK (advancer IS NULL OR advancer IN ('home', 'away'));
  END IF;
END $$;

COMMENT ON COLUMN public.matches.fulltime_home_score IS
  'Marcador local a los 120 (incluye alargue). = score de 90 si no hubo ET. NULL si no se capturo. Se escribe junto a fulltime_away (par atomico).';
COMMENT ON COLUMN public.matches.fulltime_away_score IS
  'Marcador visitante a los 120 (incluye alargue). NULL si no se capturo.';
COMMENT ON COLUMN public.matches.penalty_home IS
  'Penales convertidos por el local (tanda). NULL si no hubo penales.';
COMMENT ON COLUMN public.matches.penalty_away IS
  'Penales convertidos por el visitante (tanda). NULL si no hubo penales.';
COMMENT ON COLUMN public.matches.advancer IS
  'home | away — quien avanzo/gano el cruce (incluidos penales). NULL si no aplica o no se capturo.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Pick de "quien avanza" en predictions (+1 si acierta). Nullable —
--    solo se setea en knockouts. ADD COLUMN nullable NO toca filas
--    existentes (regla HARD: predictions son sagrados; esto es metadata-only).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS advance_pick text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'predictions_advance_pick_chk'
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_advance_pick_chk
      CHECK (advance_pick IS NULL OR advance_pick IN ('home', 'away'));
  END IF;
END $$;

COMMENT ON COLUMN public.predictions.advance_pick IS
  'home | away — pronostico de quien avanza (bonus +1 si la polla tiene advance_bonus). NULL si el user no eligio / no es knockout.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. score_match v5 — agrega: (a) fuente de marcador 120' cuando score_120
--    (gated por knockout + kc_mode_changed_at), (b) +1 plano de avance por
--    fuera del x2 (gated por knockout + advance_bonus_from). Reescribe 074
--    (REGLA #5). Con score_120=false y advance_bonus=false → IDENTICO a 074.
--
--    v_is_knockout = fase 16vos+. El subselect LATERAL `src` calcula por
--    (prediccion, polla): eff_home/eff_away (120' si corresponde, si no 90')
--    y eff_advancer (captura matches.advancer, o derivado del decisivo).
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
  v_fulltime_home integer;
  v_fulltime_away integer;
  v_advancer text;
  v_is_knockout boolean;
BEGIN
  SELECT home_score, away_score, scheduled_at, phase,
         fulltime_home_score, fulltime_away_score, advancer
    INTO v_home_score, v_away_score, v_scheduled_at, v_phase,
         v_fulltime_home, v_fulltime_away, v_advancer
    FROM matches WHERE id = p_match_id;
  IF v_home_score IS NULL OR v_away_score IS NULL THEN
    RAISE NOTICE 'score_match(%): scores NULL, skip', p_match_id;
    RETURN;
  END IF;

  v_is_knockout := v_phase IN
    ('round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final');

  UPDATE predictions p
  SET points_earned = (
    CASE
      WHEN pol.scoring_mode = 'goles_v2'
           AND pol.scoring_mode_changed_at IS NOT NULL
           AND v_scheduled_at IS NOT NULL
           AND v_scheduled_at >= pol.scoring_mode_changed_at THEN
        calc_points_goles_v2(p.predicted_home, p.predicted_away, src.eff_home, src.eff_away)
      ELSE
        calculate_prediction_points(
          p.predicted_home,
          p.predicted_away,
          src.eff_home,
          src.eff_away,
          pol.points_exact,
          COALESCE(pol.points_goal_diff, 3),
          COALESCE(pol.points_correct_result, 2),
          pol.points_one_team
        )
    END
  ) * (
    -- Multiplicador por fase: octavos+ valen doble si la polla lo aprobo.
    CASE
      WHEN pol.double_from_octavos = true
           AND v_phase IN ('round_of_16','quarter_finals','semi_finals','third_place','final')
      THEN 2 ELSE 1
    END
  ) + (
    -- +1 PLANO por acertar quien avanza (por fuera del x2). Solo knockouts,
    -- solo despues de advance_bonus_from, solo si hay pick y avance conocido.
    CASE
      WHEN pol.advance_bonus = true
           AND v_is_knockout
           AND pol.advance_bonus_from IS NOT NULL
           AND v_scheduled_at IS NOT NULL
           AND v_scheduled_at >= pol.advance_bonus_from
           AND p.advance_pick IS NOT NULL
           AND src.eff_advancer IS NOT NULL
           AND p.advance_pick = src.eff_advancer
      THEN 1 ELSE 0
    END
  )
  FROM pollas pol,
    LATERAL (
      SELECT
        CASE
          WHEN pol.score_120 = true
               AND v_is_knockout
               AND pol.kc_mode_changed_at IS NOT NULL
               AND v_scheduled_at IS NOT NULL
               AND v_scheduled_at >= pol.kc_mode_changed_at
          THEN COALESCE(v_fulltime_home, v_home_score) ELSE v_home_score
        END AS eff_home,
        CASE
          WHEN pol.score_120 = true
               AND v_is_knockout
               AND pol.kc_mode_changed_at IS NOT NULL
               AND v_scheduled_at IS NOT NULL
               AND v_scheduled_at >= pol.kc_mode_changed_at
          THEN COALESCE(v_fulltime_away, v_away_score) ELSE v_away_score
        END AS eff_away,
        COALESCE(
          v_advancer,
          CASE
            WHEN COALESCE(v_fulltime_home, v_home_score) <> COALESCE(v_fulltime_away, v_away_score)
            THEN CASE
                   WHEN COALESCE(v_fulltime_home, v_home_score) > COALESCE(v_fulltime_away, v_away_score)
                   THEN 'home' ELSE 'away'
                 END
            ELSE NULL
          END
        ) AS eff_advancer
    ) src
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
-- 5. rescore_polla v3 — misma logica (120' + bonus de avance) leyendo de
--    matches m. Idempotente. Lo llama el endpoint admin al activar/desactivar.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rescore_polla(p_polla_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exists boolean;
BEGIN
  SELECT true INTO v_exists FROM pollas WHERE id = p_polla_id;
  IF v_exists IS NULL THEN
    RAISE NOTICE 'rescore_polla(%): polla no existe, skip', p_polla_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = (
    CASE
      WHEN pol.scoring_mode = 'goles_v2'
           AND pol.scoring_mode_changed_at IS NOT NULL
           AND m.scheduled_at IS NOT NULL
           AND m.scheduled_at >= pol.scoring_mode_changed_at THEN
        calc_points_goles_v2(p.predicted_home, p.predicted_away, src.eff_home, src.eff_away)
      ELSE
        calculate_prediction_points(
          p.predicted_home, p.predicted_away, src.eff_home, src.eff_away,
          pol.points_exact,
          COALESCE(pol.points_goal_diff, 3),
          COALESCE(pol.points_correct_result, 2),
          pol.points_one_team
        )
    END
  ) * (
    CASE
      WHEN pol.double_from_octavos = true
           AND m.phase IN ('round_of_16','quarter_finals','semi_finals','third_place','final')
      THEN 2 ELSE 1
    END
  ) + (
    CASE
      WHEN pol.advance_bonus = true
           AND m.phase IN ('round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final')
           AND pol.advance_bonus_from IS NOT NULL
           AND m.scheduled_at IS NOT NULL
           AND m.scheduled_at >= pol.advance_bonus_from
           AND p.advance_pick IS NOT NULL
           AND src.eff_advancer IS NOT NULL
           AND p.advance_pick = src.eff_advancer
      THEN 1 ELSE 0
    END
  )
  FROM matches m, pollas pol,
    LATERAL (
      SELECT
        CASE
          WHEN pol.score_120 = true
               AND m.phase IN ('round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final')
               AND pol.kc_mode_changed_at IS NOT NULL
               AND m.scheduled_at IS NOT NULL
               AND m.scheduled_at >= pol.kc_mode_changed_at
          THEN COALESCE(m.fulltime_home_score, m.home_score) ELSE m.home_score
        END AS eff_home,
        CASE
          WHEN pol.score_120 = true
               AND m.phase IN ('round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final')
               AND pol.kc_mode_changed_at IS NOT NULL
               AND m.scheduled_at IS NOT NULL
               AND m.scheduled_at >= pol.kc_mode_changed_at
          THEN COALESCE(m.fulltime_away_score, m.away_score) ELSE m.away_score
        END AS eff_away,
        COALESCE(
          m.advancer,
          CASE
            WHEN COALESCE(m.fulltime_home_score, m.home_score) <> COALESCE(m.fulltime_away_score, m.away_score)
            THEN CASE
                   WHEN COALESCE(m.fulltime_home_score, m.home_score) > COALESCE(m.fulltime_away_score, m.away_score)
                   THEN 'home' ELSE 'away'
                 END
            ELSE NULL
          END
        ) AS eff_advancer
    ) src
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

-- score_match / rescore_polla mantienen los GRANT de 072/074 (CREATE OR
-- REPLACE preserva privilegios). rescore_polla re-aseguramos por las dudas.
REVOKE EXECUTE ON FUNCTION public.rescore_polla(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rescore_polla(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rescore_polla(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rescore_polla(uuid) TO service_role;

-- Para PRENDER el modo en La Polla de Carvalho (lo hace el admin via /admin):
--   UPDATE pollas SET score_120 = true, advance_bonus = true,
--          kc_mode_changed_at = now(),                    -- 120' desde HOY
--          advance_bonus_from = '<manana 00:00 -05>'      -- avance desde MANANA
--    WHERE id = '56ca95a7-cded-482b-ab31-8f8d7089618f';
--   SELECT rescore_polla('56ca95a7-cded-482b-ab31-8f8d7089618f');
-- Para revertir:
--   UPDATE pollas SET score_120=false, advance_bonus=false,
--          kc_mode_changed_at=NULL, advance_bonus_from=NULL
--    WHERE id='56ca95a7-cded-482b-ab31-8f8d7089618f';
--   SELECT rescore_polla('56ca95a7-cded-482b-ab31-8f8d7089618f');
