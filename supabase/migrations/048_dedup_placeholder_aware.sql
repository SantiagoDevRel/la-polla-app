-- 048_dedup_placeholder_aware — Placeholder promotion centralizado en
-- upsert_match_safe + cleanup de duplicados acumulados.
--
-- Bug: cuando ensurePlaceholders pre-creaba 72 TBD slots para group_stage
-- y después llegaba un 2do proveedor (ESPN tras football-data), el path
-- promoteOrInsert en discover.ts agarraba un placeholder libre por
-- evento — saltándose el semantic dedup de upsert_match_safe — y
-- generaba un row duplicado por partido.
--
-- Fix arquitectural: en vez de tener placeholder-promotion en app code
-- + dedup en RPC (dos paths), ponemos TODO en el RPC. Lookup #4 es la
-- promoción: si los 3 lookups previos fallan Y la phase tiene slots
-- TBD libres, UPDATE un placeholder en lugar de INSERT.
--
-- Adicional: country-name aliases en normalize_team_name para casos
-- futuros (Czechia/Czech Republic, USA/United States, etc.) que aún
-- no aparecieron en duplicados pero podrían en knockouts.

-- 1. normalize_team_name: agregar aliases de país.
CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
RETURNS text AS $$
DECLARE
  v text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v := lower(unaccent(p_name));
  -- Quitar tokens-ruido
  v := regexp_replace(v, '\m(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\M', ' ', 'g');
  -- Mappings clubes
  v := replace(v, 'munchen', 'munich');
  v := replace(v, 'paris saint germain', 'psg');
  v := replace(v, 'paris saintgermain', 'psg');
  v := replace(v, 'paris saint-germain', 'psg');
  -- Mappings países (proveedores varían: ESPN usa "USA", football-data
  -- usa "United States"; ESPN "Czech Republic" vs football-data "Czechia").
  -- Colapsamos a forma canónica.
  v := regexp_replace(v, '\busa\b', 'united states', 'g');
  v := regexp_replace(v, '\bunited states of america\b', 'united states', 'g');
  v := regexp_replace(v, '\bczechia\b', 'czech republic', 'g');
  v := regexp_replace(v, '\bbosnia and herzegovina\b', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\bbosnia & herzegovina\b', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\bbosnia-herzegovina\b', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\bcote d''ivoire\b', 'ivory coast', 'g');
  v := regexp_replace(v, '\bcote divoire\b', 'ivory coast', 'g');
  v := regexp_replace(v, '\bcabo verde\b', 'cape verde', 'g');
  v := regexp_replace(v, '\bsouth korea\b', 'korea republic', 'g');
  v := regexp_replace(v, '\brepublic of korea\b', 'korea republic', 'g');
  v := regexp_replace(v, '\bnorth korea\b', 'korea dpr', 'g');
  v := regexp_replace(v, '\bcurazao\b', 'curacao', 'g');
  v := regexp_replace(v, '\bturkiye\b', 'turkey', 'g');
  -- Colapsar espacios y trim
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);
  RETURN v;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. upsert_match_safe v3: agregar lookup #4 (promoción de placeholder).
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
BEGIN
  -- Lookup #1: por external_id exacto.
  SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_id, v_live_recent
    FROM public.matches
   WHERE external_id = p_external_id;

  -- Lookup #2: si la llamada es de ESPN, también buscar por espn_id.
  IF v_id IS NULL AND v_is_espn THEN
    v_espn_numeric := substring(p_external_id from 6);
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE espn_id = v_espn_numeric;
  END IF;

  -- Lookup #3: dedup semántico (tournament + ±2h + teams normalizados).
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

  -- Lookup #4 (NUEVO): si los lookups previos fallaron Y la phase está
  -- definida, intentar promover un placeholder TBD libre del mismo
  -- (tournament, phase). Esto reemplaza la lógica que vivía en
  -- discover.ts:promoteOrInsert — ahora todos los syncs (ESPN +
  -- football-data + api-football) comparten el mismo path y nunca
  -- crean rows paralelos a placeholders.
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
      v_live_recent := false; -- placeholder por definición no tuvo live update
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

  -- Path PROMOTION: estamos pisando un placeholder. UPDATE total
  -- (no preservamos nada del placeholder excepto su UUID y match_day,
  -- que sirve como hint de orden en el bracket).
  IF v_is_promotion THEN
    UPDATE public.matches SET
      external_id     = p_external_id,
      tournament      = p_tournament,
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

  -- Path UPDATE: el row ya existe (lookups 1/2/3). Misma lógica del
  -- candado live_updated_at: no pisar score/status si live source
  -- escribió hace <10 min.
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
  'Upsert con quad lookup: external_id → espn_id → semantic (tournament+±2h+teams normalizados) → promote-placeholder. Lookup #4 (promote) reemplaza la lógica que vivía en discover.ts:promoteOrInsert. v3 desde migration 048.';

-- 3. CLEANUP: merge duplicados acumulados antes de migration 048.
-- Estrategia:
--   - Para cada grupo de duplicados (mismo tournament + scheduled_at::date
--     + teams normalizados), keep el row MÁS VIEJO (preserva UUID ligado
--     a predictions existentes).
--   - Migrate predictions de los rows-loser al keeper.
--   - Delete los losers.
--   - Si había un loser de ESPN (espn:XXX), copiar espn_id al keeper
--     antes de delete para que futuros syncs lo encuentren via lookup #2.
DO $$
DECLARE
  rec RECORD;
  keeper_id uuid;
  keeper_external_id text;
  loser_espn_id text;
BEGIN
  FOR rec IN
    WITH groups AS (
      SELECT
        tournament,
        scheduled_at::date AS dia,
        public.normalize_team_name(home_team) AS norm_home,
        public.normalize_team_name(away_team) AS norm_away,
        array_agg(id ORDER BY created_at ASC) AS ids,
        array_agg(external_id ORDER BY created_at ASC) AS external_ids
      FROM public.matches
      WHERE home_team <> 'TBD'
      GROUP BY tournament, scheduled_at::date,
               public.normalize_team_name(home_team),
               public.normalize_team_name(away_team)
      HAVING COUNT(*) > 1
    )
    SELECT * FROM groups
  LOOP
    keeper_id := rec.ids[1];
    keeper_external_id := rec.external_ids[1];

    -- Si algún loser tiene espn_id seteado (o external_id 'espn:...'),
    -- copiarlo al keeper antes del delete.
    SELECT
      COALESCE(
        (SELECT espn_id FROM public.matches WHERE id = ANY(rec.ids[2:]) AND espn_id IS NOT NULL LIMIT 1),
        (SELECT substring(external_id from 6) FROM public.matches WHERE id = ANY(rec.ids[2:]) AND external_id LIKE 'espn:%' LIMIT 1)
      )
    INTO loser_espn_id;

    IF loser_espn_id IS NOT NULL THEN
      UPDATE public.matches
         SET espn_id = loser_espn_id
       WHERE id = keeper_id
         AND (espn_id IS NULL OR espn_id IS DISTINCT FROM loser_espn_id);
    END IF;

    -- Migrate predictions de los losers al keeper.
    UPDATE public.predictions
       SET match_id = keeper_id
     WHERE match_id = ANY(rec.ids[2:]);

    -- Delete los losers.
    DELETE FROM public.matches WHERE id = ANY(rec.ids[2:]);

    RAISE NOTICE 'Dedup [%]: kept % (external_id=%), removed % rows',
      rec.norm_home || ' vs ' || rec.norm_away,
      keeper_id,
      keeper_external_id,
      array_length(rec.ids, 1) - 1;
  END LOOP;
END $$;
