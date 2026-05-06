-- 045_dedup_match_by_teams — Evita que ESPN y football-data inserten
-- 2 rows distintos para el MISMO partido real (ej: Bayern vs PSG con
-- external_id='espn:401862895' y '552094').
--
-- Causa raíz: upsert_match_safe deduplica solo por external_id exacto.
-- Como cada proveedor usa su propio id, el mismo partido entra como 2.
--
-- Fix: cuando NO se encuentra por external_id, intentamos un segundo
-- lookup por (tournament + scheduled_at en ±2h + teams normalizados).
-- Si encontramos match → UPDATE ese row preservando su external_id
-- original (no se cambia, así el otro proveedor sigue encontrándolo
-- por su lookup). Para ESPN además seteamos espn_id para acelerar
-- futuros syncs.
--
-- Si no encontramos por team-match → INSERT normal (comportamiento
-- previo).

-- 1. Extensión para strip de acentos. Permite que "FC Bayern München"
--    matchee "Bayern Munich" después de normalizar.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Helper inmutable: normaliza nombre de equipo.
--    - lower
--    - unaccent
--    - quita prefijos/sufijos comunes (FC, AC, CF, AFC, RCD, Club, SC)
--    - colapsa espacios
--    Retorna texto comparable entre proveedores.
CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
RETURNS text AS $$
DECLARE
  v text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v := lower(unaccent(p_name));
  -- Quitar tokens-ruido como palabra completa al principio o al final
  v := regexp_replace(v, '\m(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\M', ' ', 'g');
  -- Mappings manuales para casos donde los proveedores difieren
  -- demasiado del sustantivo principal.
  v := replace(v, 'munchen', 'munich');
  v := replace(v, 'paris saint germain', 'psg');
  v := replace(v, 'paris saintgermain', 'psg');
  v := replace(v, 'paris saint-germain', 'psg');
  -- Colapsar espacios y trim
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);
  RETURN v;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. upsert_match_safe con dedup secundario por team-match.
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
BEGIN
  -- Lookup #1: por external_id exacto (path actual, fast).
  SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_id, v_live_recent
    FROM public.matches
   WHERE external_id = p_external_id;

  -- Lookup #2: si la llamada es de ESPN, también buscar por espn_id —
  -- eso atrapa el caso donde antes entró como FD y un sync ESPN previo
  -- ya seteó espn_id en ese row.
  IF v_id IS NULL AND v_is_espn THEN
    v_espn_numeric := substring(p_external_id from 6); -- after "espn:"
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE espn_id = v_espn_numeric;
  END IF;

  -- Lookup #3: dedup por (tournament + scheduled_at ±2h + teams
  -- normalizados). Solo se ejecuta si los dos lookups previos fallaron.
  -- Esto evita que ESPN cree un row paralelo cuando football-data ya
  -- escribió uno (y viceversa).
  IF v_id IS NULL THEN
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE tournament = p_tournament
       AND scheduled_at BETWEEN p_scheduled_at - INTERVAL '2 hours'
                            AND p_scheduled_at + INTERVAL '2 hours'
       AND public.normalize_team_name(home_team) = public.normalize_team_name(p_home_team)
       AND public.normalize_team_name(away_team) = public.normalize_team_name(p_away_team)
     LIMIT 1;
    -- Si encontramos por team-match desde ESPN, anota el espn_id
    -- para que próximos syncs ESPN encuentren por lookup #2 (más rápido).
    IF v_id IS NOT NULL AND v_is_espn THEN
      UPDATE public.matches SET espn_id = v_espn_numeric
       WHERE id = v_id AND espn_id IS DISTINCT FROM v_espn_numeric;
    END IF;
  END IF;

  -- Path INSERT: ningún lookup encontró match → row genuinamente nuevo.
  IF v_id IS NULL THEN
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

  -- Path UPDATE: el row ya existe (por cualquiera de los 3 lookups).
  -- Misma lógica del candado live_updated_at: si hace <10 min un live
  -- source escribió score/status, no los pisamos con datos del otro
  -- proveedor. Solo refrescamos metadata.
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

COMMENT ON FUNCTION public.upsert_match_safe IS
  'Upsert con triple lookup: external_id → espn_id → (tournament+scheduled_at±2h+teams normalizados). Evita duplicados entre proveedores ESPN/football-data. v2 desde migration 045.';
