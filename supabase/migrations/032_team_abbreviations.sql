-- 032_team_abbreviations — Guardar la abreviación oficial del proveedor
-- (ESPN/football-data) en cada match.
--
-- Antes derivábamos del nombre y daba mal en español ('Club Atlético
-- de Madrid' → 'CAD' en vez de 'ATM'). ESPN da team.abbreviation
-- correcta (ATM, ARS) y football-data da tla. Las guardamos al sync
-- y la UI las usa con prioridad sobre el deriveTla local.
--
-- También extiende upsert_match_safe para aceptar los nuevos campos.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS home_team_abbr text,
  ADD COLUMN IF NOT EXISTS away_team_abbr text;

COMMENT ON COLUMN public.matches.home_team_abbr IS
  'Abreviatura corta del equipo home (3 letras, ej. ATM). Viene de team.abbreviation de ESPN o team.tla de football-data.';
COMMENT ON COLUMN public.matches.away_team_abbr IS
  'Abreviatura corta del equipo away.';

-- Extender upsert_match_safe para aceptar abbreviation. Mantiene la
-- lógica del candado live_updated_at intacta — solo agrega 2 columnas
-- a metadata (que se actualiza siempre, fresh o no).
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
BEGIN
  SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_id, v_live_recent
    FROM public.matches
   WHERE external_id = p_external_id;

  IF v_id IS NULL THEN
    INSERT INTO public.matches (
      external_id, tournament, match_day, phase,
      home_team, away_team, home_team_flag, away_team_flag,
      home_team_abbr, away_team_abbr,
      scheduled_at, venue,
      home_score, away_score, status, elapsed
    ) VALUES (
      p_external_id, p_tournament, p_match_day, p_phase,
      p_home_team, p_away_team, p_home_team_flag, p_away_team_flag,
      p_home_team_abbr, p_away_team_abbr,
      p_scheduled_at, p_venue,
      p_home_score, p_away_score, p_status, p_elapsed
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF v_live_recent THEN
    UPDATE public.matches SET
      tournament      = p_tournament,
      match_day       = p_match_day,
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
      match_day       = p_match_day,
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      home_team_flag  = COALESCE(p_home_team_flag, home_team_flag),
      away_team_flag  = COALESCE(p_away_team_flag, away_team_flag),
      home_team_abbr  = COALESCE(p_home_team_abbr, home_team_abbr),
      away_team_abbr  = COALESCE(p_away_team_abbr, away_team_abbr),
      scheduled_at    = p_scheduled_at,
      venue           = p_venue,
      home_score      = GREATEST(COALESCE(home_score, 0), COALESCE(p_home_score, 0)),
      away_score      = GREATEST(COALESCE(away_score, 0), COALESCE(p_away_score, 0)),
      status          = p_status,
      elapsed         = p_elapsed
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
