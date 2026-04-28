-- 027_espn_live_sync.sql — ESPN como fuente de in-play freshness.
--
-- Contexto: football-data.org tiene lag de 5-15 min para reportar goles
-- y status changes durante un partido en vivo. ESPN public API
-- (site.api.espn.com) reporta sub-minuto, gratis, sin API key. Esta
-- migration prepara la DB para que ambas fuentes convivan sin pisarse:
--
--   * football-data sigue siendo dueño de la creación de fixtures
--     (external_id, tournament, phase, teams, scheduled_at, venue,
--      flags). La sync existente sigue corriendo lazy.
--
--   * ESPN se vuelve dueño de los campos in-play (status, scores,
--     elapsed) DURANTE el live. Marca sus updates con
--     `live_updated_at = NOW()`.
--
--   * Cuando football-data llega luego con datos lagged, una
--     `upsert_match_safe()` chequea `live_updated_at`: si fue
--     actualizado por ESPN hace <10 min, NO sobrescribe los campos
--     in-play. Solo los metadata.
--
--   * `espn_id` se llena la primera vez que se matchea un evento ESPN
--     a un row existente (por team+kickoff fuzzy). Después es lookup
--     directo, instantáneo, sin ambigüedad.
--
-- Idempotente — IF NOT EXISTS / OR REPLACE en todo.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas en `matches`
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS espn_id text,
  ADD COLUMN IF NOT EXISTS live_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_source text;

-- Index para lookup por espn_id en syncs subsiguientes.
CREATE UNIQUE INDEX IF NOT EXISTS matches_espn_id_idx
  ON public.matches (espn_id)
  WHERE espn_id IS NOT NULL;

-- Index parcial para el cron gate "¿hay matches que necesiten ESPN
-- ahora?". Se filtra por status='live' OR scheduled próximo.
CREATE INDEX IF NOT EXISTS matches_live_window_idx
  ON public.matches (scheduled_at)
  WHERE status IN ('scheduled', 'live');

COMMENT ON COLUMN public.matches.espn_id IS
  'ESPN event UID/ID. Llenado al primer match exitoso entre un evento ESPN y este row. Permite lookup directo en syncs posteriores.';
COMMENT ON COLUMN public.matches.live_updated_at IS
  'Timestamp del último write hecho por la fuente in-play (ESPN). Sirve de candado para que football-data no sobrescriba datos frescos. NULL = nunca actualizado por live source.';
COMMENT ON COLUMN public.matches.live_source IS
  'Nombre de la fuente que escribió los campos in-play más recientes. Hoy: ''espn'' o NULL.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Función `upsert_match_safe()` — el candado
-- ─────────────────────────────────────────────────────────────────────
--
-- Llamada por la sync de football-data (en lugar del upsert directo).
-- INSERT si no existe; UPDATE de metadata siempre; UPDATE de campos
-- in-play SOLO si live_updated_at IS NULL OR live_updated_at <
-- NOW() - 10 min (ESPN se quedó silencioso → tomamos lo que diga
-- football-data como mejor que nada).
--
-- Devuelve el id del row resultante para logging.
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
  p_elapsed integer
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
  v_live_recent boolean;
BEGIN
  -- ¿Existe el row? Si sí, ¿tiene live_updated_at fresco?
  SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_id, v_live_recent
    FROM public.matches
   WHERE external_id = p_external_id;

  IF v_id IS NULL THEN
    -- INSERT nuevo: football-data manda metadata + lo que tenga
    -- in-play. live_updated_at queda NULL (nadie del lado live escribió
    -- aún).
    INSERT INTO public.matches (
      external_id, tournament, match_day, phase,
      home_team, away_team, home_team_flag, away_team_flag,
      scheduled_at, venue,
      home_score, away_score, status, elapsed
    ) VALUES (
      p_external_id, p_tournament, p_match_day, p_phase,
      p_home_team, p_away_team, p_home_team_flag, p_away_team_flag,
      p_scheduled_at, p_venue,
      p_home_score, p_away_score, p_status, p_elapsed
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- UPDATE: metadata siempre se refresca. Campos in-play se
  -- preservan cuando ESPN escribió hace poco.
  IF v_live_recent THEN
    UPDATE public.matches SET
      tournament      = p_tournament,
      match_day       = p_match_day,
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      home_team_flag  = p_home_team_flag,
      away_team_flag  = p_away_team_flag,
      scheduled_at    = p_scheduled_at,
      venue           = p_venue
      -- in-play (status, scores, elapsed) NO se tocan
    WHERE id = v_id;
  ELSE
    UPDATE public.matches SET
      tournament      = p_tournament,
      match_day       = p_match_day,
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      home_team_flag  = p_home_team_flag,
      away_team_flag  = p_away_team_flag,
      scheduled_at    = p_scheduled_at,
      venue           = p_venue,
      -- in-play sí se actualizan, pero bloqueamos regresiones de score
      home_score      = GREATEST(COALESCE(home_score, 0), COALESCE(p_home_score, 0)),
      away_score      = GREATEST(COALESCE(away_score, 0), COALESCE(p_away_score, 0)),
      status          = p_status,
      elapsed         = p_elapsed
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.upsert_match_safe IS
  'Upsert que respeta el candado live_updated_at: si ESPN actualizó hace <10 min, los campos status/score/elapsed de la entrada se ignoran y solo se refrescan los metadata. Usado por la sync de football-data.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Función `update_match_live_espn()` — el writer de ESPN
-- ─────────────────────────────────────────────────────────────────────
--
-- Llamada por la sync de ESPN para escribir solo los campos in-play.
-- Match por espn_id (lookup directo) o por external_id (primera vez,
-- después de que la sync mappee). Bloquea regresiones de score.
-- Nunca crea rows — football-data es dueño del INSERT.

CREATE OR REPLACE FUNCTION public.update_match_live_espn(
  p_match_id uuid,
  p_espn_id text,
  p_status text,
  p_home_score integer,
  p_away_score integer,
  p_elapsed integer
) RETURNS boolean AS $$
DECLARE
  v_old_home_score integer;
  v_old_away_score integer;
  v_old_status text;
BEGIN
  SELECT home_score, away_score, status
    INTO v_old_home_score, v_old_away_score, v_old_status
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- No regresiones de score (excepto cuando viene de NULL/0).
  -- Si ESPN dice 0-0 pero ya tenemos 1-0, mantener 1-0. Eso lo
  -- protege de un fixture en transición o un blip del feed.
  IF p_home_score IS NOT NULL AND p_home_score < COALESCE(v_old_home_score, 0) THEN
    p_home_score := v_old_home_score;
  END IF;
  IF p_away_score IS NOT NULL AND p_away_score < COALESCE(v_old_away_score, 0) THEN
    p_away_score := v_old_away_score;
  END IF;

  UPDATE public.matches SET
    espn_id          = COALESCE(public.matches.espn_id, p_espn_id),
    status           = p_status,
    home_score       = COALESCE(p_home_score, home_score),
    away_score       = COALESCE(p_away_score, away_score),
    elapsed          = COALESCE(p_elapsed, elapsed),
    live_updated_at  = NOW(),
    live_source      = 'espn'
  WHERE id = p_match_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.update_match_live_espn IS
  'Update atómico de campos in-play desde ESPN. Bloquea regresiones de score. Nunca inserta. Marca live_updated_at + live_source para el candado.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Permisos
-- ─────────────────────────────────────────────────────────────────────
-- Las funciones corren con SECURITY DEFINER y son llamadas via la
-- service-role key desde la app, así que no necesitan policies RLS
-- adicionales — RLS no aplica al definer.

REVOKE ALL ON FUNCTION public.upsert_match_safe FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_live_espn FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_match_safe TO service_role;
GRANT EXECUTE ON FUNCTION public.update_match_live_espn TO service_role;
