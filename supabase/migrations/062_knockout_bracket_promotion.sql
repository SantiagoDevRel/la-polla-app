-- Migration 062: promoción in-place de knockouts codificados (Mundial 2026).
--
-- PROBLEMA (auditoría 2026-06-10, P0-1): los 32 knockouts del Mundial viven
-- en DB con equipos codificados ("W93 vs W94", "1A vs 2B") y external_id
-- derivado de sha1(round|team1|team2). Cuando los proveedores publiquen los
-- equipos reales (~27-28 jun para R32), el hash cambia y los 4 lookups de
-- upsert_match_safe fallan → INSERT duplicado por knockout + 496 referencias
-- huérfanas en pollas.match_ids + predicciones que nunca se scorean.
--
-- FIX (3 piezas):
--   1. is_bracket_slot(): detecta team names que son códigos de bracket.
--   2. upsert_match_safe v4: lookup #3.5 "promoción de bracket-slot"
--      (por número FIFA en match_day, o por ventana de kickoff con
--      candidato único) que ACTUALIZA el row existente in-place —
--      preserva UUID, predicciones y pollas.match_ids. Más un guard
--      NO-INSERT: mientras queden slots codificados en (tournament,
--      phase), jamás se inserta un row paralelo — se registra alerta
--      en admin_alerts y se devuelve NULL. Garantiza ≤104 partidos.
--   3. Backfill de match_day = número FIFA (73-104) en los 32 slots,
--      usando el mapping actual de openfootball (los códigos siguen
--      vivos hoy, así que el join por (home,away) es determinístico).
--
-- BONUS del mismo pass:
--   - GREATEST() ahora preserva NULL (antes coercionaba NULL→0 y dejó
--     156 matches scheduled con 0-0 "confirmado" — se limpian acá con
--     backup-first).
--   - trigger_discover_tournaments v2: el gate del cron de 6h también
--     dispara cuando hay bracket-slots sin resolver con kickoff <7 días
--     (antes solo TBD placeholders / pollas dinámicas → el cron skipeaba
--     y NADA resolvía los knockouts automáticamente).

-- ─────────────────────────────────────────────────────────────────────
-- 1. is_bracket_slot
-- ─────────────────────────────────────────────────────────────────────
-- Mismos patrones que lib/matches/is-placeholder.ts (mantener en sync):
--   "1A", "2B", "3C/E/F/H/I"  → posición de grupo (R32)
--   "W93", "L101"             → winner/loser del partido N
CREATE OR REPLACE FUNCTION public.is_bracket_slot(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_name IS NOT NULL AND (
    p_name ~ '^[0-9][A-Z](/[A-Z])*$'
    OR p_name ~ '^[WL][0-9]+$'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_bracket_slot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_bracket_slot(text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 1b. normalize_team_name v2: aliases extra detectados en el review
--     adversarial 2026-06-10 contra los nombres reales de football-data.
--     (Espejo TS: normalizeTeamForCompare en lib/matches/verify-final.ts.)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v := lower(unaccent(p_name));
  v := regexp_replace(v, '\m(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\M', ' ', 'g');
  v := replace(v, 'munchen', 'munich');
  v := replace(v, 'paris saint germain', 'psg');
  v := replace(v, 'paris saintgermain', 'psg');
  v := replace(v, 'paris saint-germain', 'psg');
  v := regexp_replace(v, '\munited states of america\M', 'united states', 'g');
  v := regexp_replace(v, '\musa\M', 'united states', 'g');
  v := regexp_replace(v, '\mczechia\M', 'czech republic', 'g');
  v := regexp_replace(v, '\mbosnia and herzegovina\M', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\mbosnia & herzegovina\M', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\mbosnia-herzegovina\M', 'bosnia herzegovina', 'g');
  v := replace(v, 'bosnia & herzegovina', 'bosnia herzegovina');
  v := replace(v, 'bosnia-herzegovina', 'bosnia herzegovina');
  v := regexp_replace(v, '\mcote d''ivoire\M', 'ivory coast', 'g');
  v := regexp_replace(v, '\mcote divoire\M', 'ivory coast', 'g');
  -- NUEVO 062: football-data usa "Cape Verde Islands"
  v := regexp_replace(v, '\mcape verde islands\M', 'cape verde', 'g');
  v := regexp_replace(v, '\mcabo verde\M', 'cape verde', 'g');
  v := regexp_replace(v, '\msouth korea\M', 'korea republic', 'g');
  v := regexp_replace(v, '\mrepublic of korea\M', 'korea republic', 'g');
  v := regexp_replace(v, '\mnorth korea\M', 'korea dpr', 'g');
  -- NUEVO 062: football-data usa "IR Iran" / "China PR"
  v := regexp_replace(v, '\mir iran\M', 'iran', 'g');
  v := regexp_replace(v, '\mchina pr\M', 'china', 'g');
  v := replace(v, 'curazao', 'curacao');
  v := replace(v, 'turkiye', 'turkey');
  v := regexp_replace(v, '\mcongo dr\M', 'dr congo', 'g');
  v := regexp_replace(v, '\mcongo-kinshasa\M', 'dr congo', 'g');
  v := regexp_replace(v, '\mdemocratic republic of congo\M', 'dr congo', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);
  RETURN v;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. admin_alerts — alertas operativas para el dashboard /admin.
--    Service-role only (la app las lee vía admin client en rutas admin).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

-- Data API: solo service_role. Sin GRANT a authenticated/anon — la única
-- vía de lectura es el admin client server-side detrás de isCurrentUserAdmin().
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_alerts TO service_role;

-- Deny-all explícito para silenciar el Security Advisor (tabla RLS sin policy).
DROP POLICY IF EXISTS admin_alerts_deny_all ON public.admin_alerts;
CREATE POLICY admin_alerts_deny_all ON public.admin_alerts
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_unresolved
  ON public.admin_alerts (created_at DESC)
  WHERE resolved_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. upsert_match_safe v4
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_match_safe(
  p_external_id text,
  p_tournament text,
  p_match_day integer,
  p_phase text,
  p_home_team text,
  p_away_team text,
  p_home_team_flag text,
  p_away_team_flag text,
  p_scheduled_at timestamptz,
  p_venue text,
  p_home_score integer,
  p_away_score integer,
  p_status text,
  p_elapsed integer,
  p_home_team_abbr text DEFAULT NULL,
  p_away_team_abbr text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
  v_live_recent boolean;
  v_is_espn boolean := p_external_id LIKE 'espn:%';
  v_espn_numeric text;
  v_is_promotion boolean := false;
  v_knockout_phases CONSTANT text[] := ARRAY[
    'round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final'
  ];
BEGIN
  -- Lookup #1: por external_id exacto.
  SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_id, v_live_recent
    FROM public.matches
   WHERE external_id = p_external_id;

  -- Lookup #2: por espn_id numérico.
  IF v_id IS NULL AND v_is_espn THEN
    v_espn_numeric := substring(p_external_id from 6);
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE espn_id = v_espn_numeric;
  END IF;

  -- Lookup #3: dedup semántico (tournament + kickoff ±2h + teams normalizados).
  IF v_id IS NULL THEN
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE tournament = p_tournament
       AND scheduled_at BETWEEN p_scheduled_at - INTERVAL '2 hours'
                            AND p_scheduled_at + INTERVAL '2 hours'
       AND public.normalize_team_name(home_team) = public.normalize_team_name(p_home_team)
       AND public.normalize_team_name(away_team) = public.normalize_team_name(p_away_team)
       AND home_team <> 'TBD'
     LIMIT 1;
    IF v_id IS NOT NULL AND v_is_espn THEN
      UPDATE public.matches SET espn_id = v_espn_numeric
       WHERE id = v_id AND espn_id IS DISTINCT FROM v_espn_numeric;
    END IF;
  END IF;

  -- Lookup #3.5 (NUEVO 062): promoción de bracket-slot. Atrapa el momento
  -- en que un knockout codificado ("W93 vs W94", "1A vs 2B") recibe sus
  -- equipos reales — el external_id del proveedor cambia pero el partido
  -- es el MISMO row (mismo UUID en predictions y pollas.match_ids).
  --   (a) por número FIFA: p_match_day = num (sync-worldcup lo manda),
  --       con phase si viene (puede venir NULL si la fuente cambió el
  --       nombre del round — openfootball usa rounds planos).
  --   (b) por ventana de kickoff ±3h con candidato ÚNICO (football-data /
  --       ESPN no conocen el número FIFA). Si hay 2+ candidatos en la
  --       ventana es ambiguo → NO se promueve (cae al guard de abajo).
  --       Los kickoffs de knockout son únicos en el calendario FIFA, así
  --       que el caso normal es exactamente 1 candidato.
  IF v_id IS NULL THEN
    IF p_match_day IS NOT NULL THEN
      SELECT id INTO v_id
        FROM public.matches
       WHERE tournament = p_tournament
         AND (p_phase IS NULL OR phase = p_phase)
         AND match_day = p_match_day
         AND public.is_bracket_slot(home_team)
         AND public.is_bracket_slot(away_team)
       LIMIT 1;
    END IF;
    IF v_id IS NULL
       AND NOT public.is_bracket_slot(p_home_team)
       AND NOT public.is_bracket_slot(p_away_team) THEN
      SELECT id INTO v_id FROM (
        SELECT id, count(*) OVER () AS n_cand
          FROM public.matches
         WHERE tournament = p_tournament
           AND (p_phase IS NULL OR phase = p_phase)
           AND public.is_bracket_slot(home_team)
           AND public.is_bracket_slot(away_team)
           AND scheduled_at BETWEEN p_scheduled_at - INTERVAL '3 hours'
                                AND p_scheduled_at + INTERVAL '3 hours'
         ORDER BY abs(extract(epoch FROM (scheduled_at - p_scheduled_at))) ASC
      ) c
      WHERE c.n_cand = 1
      LIMIT 1;
    END IF;
    IF v_id IS NOT NULL THEN
      v_is_promotion := true;
      v_live_recent := false;
    END IF;
  END IF;

  -- Lookup #4: promoción de placeholder TBD legacy.
  IF v_id IS NULL AND p_phase IS NOT NULL THEN
    SELECT id INTO v_id
      FROM public.matches
     WHERE tournament = p_tournament
       AND phase = p_phase
       AND home_team = 'TBD'
       AND external_id LIKE 'placeholder:%'
     ORDER BY match_day NULLS LAST
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      v_is_promotion := true;
      v_live_recent := false;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    -- Guard anti-regresión de fuente (NUEVO 062): si lo entrante viene
    -- CODIFICADO ("W93 vs W94") pero el slot de ese número FIFA ya fue
    -- promovido a equipos reales, es un re-send stale de la fuente (ej:
    -- openfootball revirtió/cacheó). Skip silencioso — jamás re-insertar
    -- un slot codificado al lado del partido real.
    IF p_match_day IS NOT NULL
       AND public.is_bracket_slot(p_home_team)
       AND public.is_bracket_slot(p_away_team)
       AND EXISTS (
         SELECT 1 FROM public.matches
          WHERE tournament = p_tournament
            AND match_day = p_match_day
            AND NOT (public.is_bracket_slot(home_team) AND public.is_bracket_slot(away_team))
       ) THEN
      RETURN NULL;
    END IF;

    -- Guard NO-INSERT (NUEVO 062): si el (tournament, phase) todavía tiene
    -- slots codificados sin resolver, NO insertamos — sería un duplicado
    -- paralelo del mismo partido real con otro id. Registramos alerta para
    -- el dashboard /admin y devolvemos NULL. Garantiza que un torneo de
    -- bracket nunca exceda su número estructural de partidos (Mundial: 104).
    IF (
         p_phase = ANY(v_knockout_phases)
         AND EXISTS (
           SELECT 1 FROM public.matches
            WHERE tournament = p_tournament
              AND phase = p_phase
              AND public.is_bracket_slot(home_team)
              AND public.is_bracket_slot(away_team)
         )
       ) OR (
         -- Variante phase-NULL: la fuente no trajo fase pero hay un slot
         -- codificado del mismo torneo en la ventana de kickoff — casi
         -- seguro es el mismo partido y el lookup #3.5(b) lo encontró
         -- ambiguo. Alertar en vez de duplicar.
         p_phase IS NULL
         AND EXISTS (
           SELECT 1 FROM public.matches
            WHERE tournament = p_tournament
              AND public.is_bracket_slot(home_team)
              AND public.is_bracket_slot(away_team)
              AND scheduled_at BETWEEN p_scheduled_at - INTERVAL '3 hours'
                                   AND p_scheduled_at + INTERVAL '3 hours'
         )
       ) THEN
      INSERT INTO public.admin_alerts (kind, title, body, dedupe_key)
      VALUES (
        'knockout_unresolved',
        'Knockout sin mapear: ' || p_home_team || ' vs ' || p_away_team,
        'upsert_match_safe no pudo mapear "' || p_home_team || ' vs ' || p_away_team ||
          '" (' || p_tournament || ' / ' || COALESCE(p_phase, 'sin fase') ||
          ', kickoff ' || p_scheduled_at::text ||
          ', external_id ' || p_external_id || ', match_day ' || COALESCE(p_match_day::text, 'NULL') ||
          ') a un slot codificado existente. NO se insertó duplicado. ' ||
          'Revisar slots de esa fase y correr "Sync Mundial" desde /admin/matches ' ||
          'o resolver manual con Claude Code.',
        'knockout_unresolved:' || p_tournament || ':' || COALESCE(p_phase, 'nophase') || ':' || p_external_id
      )
      -- Si la alerta ya existía (incluso resuelta por el admin) y la
      -- condición se re-dispara, RE-ABRIRLA — un "Resolver" sin arreglar
      -- la causa no debe suprimir alertas futuras del mismo partido.
      ON CONFLICT (dedupe_key) DO UPDATE SET resolved_at = NULL;
      RETURN NULL;
    END IF;

    INSERT INTO public.matches (
      external_id, tournament, match_day, phase,
      home_team, away_team, home_team_flag, away_team_flag,
      home_team_abbr, away_team_abbr,
      scheduled_at, venue,
      home_score, away_score, status, elapsed,
      espn_id
    ) VALUES (
      p_external_id, p_tournament, p_match_day, p_phase,
      p_home_team, p_away_team, p_home_team_flag, p_away_team_flag,
      p_home_team_abbr, p_away_team_abbr,
      p_scheduled_at, p_venue,
      p_home_score, p_away_score, p_status, p_elapsed,
      CASE WHEN v_is_espn THEN v_espn_numeric ELSE NULL END
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF v_is_promotion THEN
    UPDATE public.matches SET
      external_id     = p_external_id,
      tournament      = p_tournament,
      -- match_day: el número FIFA EXISTENTE gana siempre — football-data
      -- promueve mandando SU matchday propio (≠ número FIFA) y pisarlo
      -- destruiría el ancla del lookup #3.5(a).
      match_day       = COALESCE(match_day, p_match_day),
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      home_team_flag  = p_home_team_flag,
      away_team_flag  = p_away_team_flag,
      home_team_abbr  = p_home_team_abbr,
      away_team_abbr  = p_away_team_abbr,
      scheduled_at    = p_scheduled_at,
      venue           = p_venue,
      home_score      = p_home_score,
      away_score      = p_away_score,
      status          = p_status,
      elapsed         = p_elapsed,
      espn_id         = CASE WHEN v_is_espn THEN v_espn_numeric ELSE espn_id END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  IF v_live_recent THEN
    UPDATE public.matches SET
      tournament      = p_tournament,
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      home_team_flag  = COALESCE(p_home_team_flag, home_team_flag),
      away_team_flag  = COALESCE(p_away_team_flag, away_team_flag),
      home_team_abbr  = COALESCE(p_home_team_abbr, home_team_abbr),
      away_team_abbr  = COALESCE(p_away_team_abbr, away_team_abbr),
      scheduled_at    = p_scheduled_at,
      venue           = p_venue
    WHERE id = v_id;
  ELSE
    UPDATE public.matches SET
      tournament      = p_tournament,
      -- match_day: una vez que un knockout tiene su número FIFA, ningún
      -- proveedor lo pisa (football-data manda matchday propio ≠ FIFA num).
      match_day       = CASE
                          WHEN match_day IS NOT NULL AND phase = ANY(v_knockout_phases)
                            THEN match_day
                          ELSE COALESCE(p_match_day, match_day)
                        END,
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      home_team_flag  = COALESCE(p_home_team_flag, home_team_flag),
      away_team_flag  = COALESCE(p_away_team_flag, away_team_flag),
      home_team_abbr  = COALESCE(p_home_team_abbr, home_team_abbr),
      away_team_abbr  = COALESCE(p_away_team_abbr, away_team_abbr),
      scheduled_at    = p_scheduled_at,
      venue           = p_venue,
      -- NUEVO 062 (×2): (a) preservar NULL (antes COALESCE(...,0) convertía
      -- "sin datos" en "0-0 confirmado" para partidos futuros); (b) un match
      -- VERIFICADO es inmutable para los syncs — el score canónico de 90'
      -- que fijó finalize_match_result no se re-infla con goles de alargue.
      home_score      = CASE
                          WHEN final_verified_at IS NOT NULL THEN home_score
                          WHEN home_score IS NULL AND p_home_score IS NULL THEN NULL
                          ELSE GREATEST(COALESCE(home_score, 0), COALESCE(p_home_score, 0)) END,
      away_score      = CASE
                          WHEN final_verified_at IS NOT NULL THEN away_score
                          WHEN away_score IS NULL AND p_away_score IS NULL THEN NULL
                          ELSE GREATEST(COALESCE(away_score, 0), COALESCE(p_away_score, 0)) END,
      status          = CASE WHEN final_verified_at IS NOT NULL THEN status ELSE p_status END,
      elapsed         = CASE WHEN final_verified_at IS NOT NULL THEN elapsed ELSE p_elapsed END
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.upsert_match_safe(
  text, text, integer, text, text, text, text, text, timestamptz, text,
  integer, integer, text, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_match_safe(
  text, text, integer, text, text, text, text, text, timestamptz, text,
  integer, integer, text, integer, text, text
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Backfill match_day = número FIFA en los 32 slots de knockout.
--    Mapping verificado contra openfootball/worldcup.json (2026-06-10).
--    Idempotente: solo toca rows que sigan codificados con esos pares.
-- ─────────────────────────────────────────────────────────────────────
WITH fifa(n, h, a) AS (VALUES
  (73,'2A','2B'), (74,'1E','3A/B/C/D/F'), (75,'1F','2C'), (76,'1C','2F'),
  (77,'1I','3C/D/F/G/H'), (78,'2E','2I'), (79,'1A','3C/E/F/H/I'), (80,'1L','3E/H/I/J/K'),
  (81,'1D','3B/E/F/I/J'), (82,'1G','3A/E/H/I/J'), (83,'2K','2L'), (84,'1H','2J'),
  (85,'1B','3E/F/G/I/J'), (86,'1J','2H'), (87,'1K','3D/E/I/J/L'), (88,'2D','2G'),
  (89,'W74','W77'), (90,'W73','W75'), (91,'W76','W78'), (92,'W79','W80'),
  (93,'W83','W84'), (94,'W81','W82'), (95,'W86','W88'), (96,'W85','W87'),
  (97,'W89','W90'), (98,'W93','W94'), (99,'W91','W92'), (100,'W95','W96'),
  (101,'W97','W98'), (102,'W99','W100'), (103,'L101','L102'), (104,'W101','W102')
)
UPDATE public.matches m
   SET match_day = fifa.n
  FROM fifa
 WHERE m.tournament = 'worldcup_2026'
   AND m.home_team = fifa.h
   AND m.away_team = fifa.a
   AND m.match_day IS DISTINCT FROM fifa.n;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Cleanup de scores 0-0 coercionados en partidos futuros (backup-first).
--    Solo rows scheduled SIN live data — un 0-0 ahí es artefacto del
--    COALESCE viejo, no un resultado.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._backup_zero_scores_20260610 AS
SELECT id, external_id, tournament, home_team, away_team, scheduled_at,
       home_score, away_score, status
  FROM public.matches
 WHERE status = 'scheduled'
   AND home_score = 0 AND away_score = 0
   AND live_updated_at IS NULL;

UPDATE public.matches
   SET home_score = NULL, away_score = NULL
 WHERE id IN (SELECT id FROM public._backup_zero_scores_20260610)
   AND status = 'scheduled'
   AND home_score = 0 AND away_score = 0;

ALTER TABLE public._backup_zero_scores_20260610 ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- 6. trigger_discover_tournaments v2: el gate del cron de 6h también
--    dispara cuando hay bracket-slots por resolver con kickoff <7 días.
--    El endpoint /api/matches/discover corre la resolución del Mundial
--    (openfootball + football-data) cuando detecta esa condición.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_discover_tournaments()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_url      text;
  v_secret   text;
  v_request_id bigint;
  v_tournaments_pending int;
  v_brackets_pending int;
BEGIN
  -- Gate 1: TBD placeholders legacy sin promover.
  SELECT COUNT(DISTINCT m.tournament) INTO v_tournaments_pending
    FROM public.matches m
   WHERE m.home_team = 'TBD'
     AND m.external_id LIKE 'placeholder:%';

  -- Gate 2 (NUEVO 062): bracket-slots codificados con kickoff cercano.
  SELECT COUNT(*) INTO v_brackets_pending
    FROM public.matches m
   WHERE m.status = 'scheduled'
     AND m.scheduled_at < now() + interval '7 days'
     AND public.is_bracket_slot(m.home_team)
     AND public.is_bracket_slot(m.away_team);

  IF v_tournaments_pending = 0 AND v_brackets_pending = 0 THEN
    -- Gate 3: pollas dinámicas (scope != custom) activas.
    DECLARE
      v_dynamic int;
    BEGIN
      SELECT COUNT(*) INTO v_dynamic
        FROM public.pollas
       WHERE status = 'active' AND scope != 'custom';
      IF v_dynamic = 0 THEN
        RETURN; -- nada que hacer, cron skipea sin llamar a Vercel
      END IF;
    END;
  END IF;

  SELECT value INTO v_url FROM public.app_config WHERE key = 'app_base_url';
  IF v_url IS NULL THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'app.cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  v_request_id := net.http_post(
    url := v_url || '/api/matches/discover',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  PERFORM v_request_id;
END;
$function$;
