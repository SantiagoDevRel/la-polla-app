-- Identidad de partidos: crosswalk de equipos, vínculos por proveedor y
-- detector de duplicados (2026-09-13, Paso 2 del plan API-Football calendario).
--
-- ADITIVA. upsert_match_safe NO cambia y ningún escritor llama todavía estas
-- funciones: solo se agregan tablas, columnas nuevas en matches y funciones de
-- lectura/vínculo. El backfill escribe únicamente columnas y tablas nuevas.
-- Cero cambios a nombres, horarios, estados, resultados, pollas o pronósticos.
--
-- Reglas que salen de las críticas adversariales del plan:
--  1. El id de equipo se toma de la bandera SOLO si el host coincide con el
--     proveedor que escribió la fila (escudo FD en fila numérica, logo ESPN en
--     fila espn:, logo AF en fila apifootball:). 46 filas FD "FC Barcelona"
--     traen el logo ESPN 2686 (Barcelona SC): otro host = desconocido.
--  2. No hay "claves que solo suben": refresh_match_team_keys() recalcula y
--     REPORTA; un re-key af:→af: o una bajada exige p_allow_rekey explícito.
--  3. La ventana ancha de fase de liga exige fase de liga en ambos lados y
--     match_day presente e IGUAL en ambos. NULL nunca coincide.
--  4. Final/tercer puesto: claves af: iguales en cualquier orden a ±7 d
--     (la final PSG–Arsenal quedó duplicada con 3 h de diferencia).
--  5. Dos claves af: distintas nunca caen a comparar nombres.
--  6. Un vínculo de proveedor solo se registra con link_match_provider_id(),
--     y solo cuando hay candidato único con claves af: iguales y vigentes
--     (una clave guardada distinta de la recalculada se rechaza).
--  7. El backfill salta las filas TBD fusionadas (espn_id ≠ id de external_id)
--     y las filas con equipos placeholder (/^TB[DAC]\y/).

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tablas nuevas (service_role only: RLS + deny-all + GRANT explícitos)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.team_provider_ids (
  provider text NOT NULL CHECK (provider IN ('football-data','espn')),
  provider_team_id text NOT NULL CHECK (provider_team_id ~ '^[0-9]{1,12}$'),
  af_team_id bigint NOT NULL CHECK (af_team_id > 0),
  source text NOT NULL,
  anchors integer NOT NULL DEFAULT 0 CHECK (anchors >= 0),
  reviewed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_team_id),
  -- Un id por proveedor por club AF: un segundo id al mismo club es sospechoso.
  UNIQUE (provider, af_team_id)
);
COMMENT ON TABLE public.team_provider_ids IS 'Crosswalk de ids de equipo football-data/ESPN → API-Football. Semilla con anclaje estricto (migración 111); API-Football se identifica por su propio id.';

-- Alias solo para equipos sin id (Le Mans, Bournemouth, openfootball).
-- canonical_team_key() ignora los alias sin revisar: nunca se aprenden solos.
CREATE TABLE public.team_name_aliases (
  scope text NOT NULL DEFAULT '' CHECK (scope = '' OR scope ~ '^[a-z0-9_]{1,60}$'),
  name_key text NOT NULL CHECK (name_key <> ''),
  af_team_id bigint NOT NULL CHECK (af_team_id > 0),
  reviewed boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, name_key)
);
COMMENT ON COLUMN public.team_name_aliases.name_key IS 'normalize_team_name(nombre). scope vacío = global; si no, slug del torneo.';

CREATE TABLE public.match_provider_ids (
  provider text NOT NULL CHECK (provider IN ('football-data','espn','api-football','openfootball')),
  provider_match_id text NOT NULL CHECK (provider_match_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  observed_kickoff timestamptz,
  observed_confirmed boolean,
  observed_status text,
  observed_at timestamptz,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_match_id),
  UNIQUE (match_id, provider)
);
COMMENT ON TABLE public.match_provider_ids IS 'Vínculo id de partido del proveedor → matches.id. Solo backfill (110) o link_match_provider_id(). Un merge debe re-apuntar estas filas. ON DELETE RESTRICT: la purga admin de partidos viejos debe resolver primero los vínculos de esas filas (seguimiento pendiente).';

-- Bitácora del modo shadow: lo que el calendario AF HARÍA, sin escribir matches.
CREATE TABLE public.match_schedule_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('football-data','espn','api-football','openfootball')),
  provider_match_id text NOT NULL,
  tournament text NOT NULL,
  match_id uuid REFERENCES public.matches(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN (
    'would_link','would_insert','would_block','ambiguous','would_move',
    'schedule_conflict','past_correction_needs_owner','no_change')),
  reason text,
  observed_kickoff timestamptz,
  observed_confirmed boolean,
  observed_status text,
  home_key text,
  away_key text,
  payload_hash text,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_schedule_observations_tournament_idx
  ON public.match_schedule_observations (tournament, observed_at DESC);
CREATE INDEX match_schedule_observations_provider_idx
  ON public.match_schedule_observations (provider, provider_match_id, observed_at DESC);
CREATE INDEX match_schedule_observations_match_idx
  ON public.match_schedule_observations (match_id) WHERE match_id IS NOT NULL;
CREATE INDEX match_provider_ids_match_idx ON public.match_provider_ids (match_id);

ALTER TABLE public.team_provider_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_provider_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_schedule_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_only ON public.team_provider_ids FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY service_only ON public.team_name_aliases FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY service_only ON public.match_provider_ids FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY service_only ON public.match_schedule_observations FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.team_provider_ids, public.team_name_aliases,
  public.match_provider_ids, public.match_schedule_observations FROM PUBLIC, anon, authenticated;
-- La secuencia de la identity column hereda los grants por defecto de Supabase.
-- El INSERT de service_role no la necesita (la identity la usa implícitamente).
REVOKE ALL ON SEQUENCE public.match_schedule_observations_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_provider_ids, public.team_name_aliases TO service_role;
-- Sin DELETE: un vínculo solo se re-apunta dentro de un merge aprobado.
GRANT SELECT, INSERT, UPDATE ON public.match_provider_ids, public.match_schedule_observations TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Columnas de identidad en matches (nullable, sin default: no reescribe la tabla)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN home_team_key text,
  ADD COLUMN away_team_key text,
  ADD COLUMN schedule_source text
    CHECK (schedule_source IS NULL OR schedule_source IN ('football-data','espn','api-football','openfootball','manual')),
  ADD COLUMN schedule_observed_at timestamptz;
COMMENT ON COLUMN public.matches.home_team_key IS 'af:<id API-Football> o n:<normalize_team_name>. NULL = placeholder. Se recalcula solo con refresh_match_team_keys(); los escritores todavía no la mantienen (Paso 6 debe hacerlo), así que link_match_provider_id rechaza una clave guardada distinta de la recalculada.';
COMMENT ON COLUMN public.matches.away_team_key IS 'Igual que home_team_key, para el visitante.';
CREATE INDEX matches_team_keys_idx
  ON public.matches (tournament, home_team_key, away_team_key, scheduled_at);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Helpers de identidad
-- ─────────────────────────────────────────────────────────────────────
-- Mismos patrones de identidad que lib/matches/is-placeholder.ts.
CREATE FUNCTION public.is_placeholder_team_name(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_name IS NULL OR btrim(p_name) = ''
      OR p_name ~* '^TB[DAC]\y'
      OR public.is_bracket_slot(p_name)
      OR p_name ~* '(winner|loser)$'
      OR p_name ~* '\yplace\y';
$$;

-- (proveedor, id) desde el HOST y la ruta exacta de la URL. Nunca por texto suelto.
CREATE FUNCTION public.provider_team_id_from_flag(p_url text)
RETURNS TABLE(provider text, provider_team_id text)
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.provider, v.id FROM (
    SELECT CASE
             WHEN p_url ~ '^https://crests\.football-data\.org/[0-9]{1,9}\.(png|svg)$' THEN 'football-data'
             WHEN p_url ~ '^https://a\.espncdn\.com/i/teamlogos/soccer/[0-9]+/[0-9]{1,9}\.png$' THEN 'espn'
             WHEN p_url ~ '^https://media\.api-sports\.io/football/teams/[0-9]{1,9}\.png$' THEN 'api-football'
           END AS provider,
           substring(p_url from '/([0-9]{1,9})\.(?:png|svg)$') AS id
  ) v
  WHERE v.provider IS NOT NULL AND v.id IS NOT NULL;
$$;

-- Proveedor que escribió la fila, por el formato de external_id.
CREATE FUNCTION public.match_provider_from_external_id(p_external_id text)
RETURNS TABLE(provider text, provider_match_id text)
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.provider, v.id FROM (
    SELECT CASE
             WHEN p_external_id ~ '^[0-9]{1,12}$' THEN 'football-data'
             WHEN p_external_id ~ '^espn:[0-9]{1,12}$' THEN 'espn'
             WHEN p_external_id ~ '^apifootball:[0-9]{1,12}$' THEN 'api-football'
             WHEN p_external_id ~ '^wc2026_[A-Za-z0-9_]{1,60}$' THEN 'openfootball'
           END AS provider,
           CASE
             WHEN p_external_id ~ '^(espn|apifootball):[0-9]{1,12}$' THEN substring(p_external_id from ':([0-9]+)$')
             ELSE p_external_id
           END AS id
  ) v
  WHERE v.provider IS NOT NULL;
$$;

CREATE FUNCTION public.provider_external_id(p_provider text, p_provider_match_id text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_provider
           WHEN 'football-data' THEN p_provider_match_id
           WHEN 'espn' THEN 'espn:' || p_provider_match_id
           WHEN 'api-football' THEN 'apifootball:' || p_provider_match_id
           WHEN 'openfootball' THEN p_provider_match_id
         END;
$$;

-- Orden: id explícito, id de bandera del MISMO proveedor, alias revisado del
-- torneo, alias revisado global, n:<nombre normalizado>. NULL = placeholder.
CREATE FUNCTION public.canonical_team_key(
  p_tournament text, p_name text, p_provider text, p_provider_team_id text, p_flag text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_af bigint;
  v_flag_provider text;
  v_flag_id text;
  v_name text;
BEGIN
  IF public.is_placeholder_team_name(p_name) THEN RETURN NULL; END IF;

  IF p_provider_team_id ~ '^[0-9]{1,12}$' THEN
    IF p_provider = 'api-football' THEN RETURN 'af:' || p_provider_team_id::bigint; END IF;
    SELECT t.af_team_id INTO v_af FROM public.team_provider_ids t
     WHERE t.provider = p_provider AND t.provider_team_id = p_provider_team_id::bigint::text;
    IF FOUND THEN RETURN 'af:' || v_af; END IF;
  END IF;

  SELECT f.provider, f.provider_team_id INTO v_flag_provider, v_flag_id
    FROM public.provider_team_id_from_flag(p_flag) f;
  -- Bandera de otro host = desconocida (caso Barcelona / Barcelona SC).
  IF v_flag_provider IS NOT NULL AND v_flag_provider = p_provider THEN
    IF v_flag_provider = 'api-football' THEN RETURN 'af:' || v_flag_id::bigint; END IF;
    SELECT t.af_team_id INTO v_af FROM public.team_provider_ids t
     WHERE t.provider = v_flag_provider AND t.provider_team_id = v_flag_id::bigint::text;
    IF FOUND THEN RETURN 'af:' || v_af; END IF;
  END IF;

  v_name := public.normalize_team_name(p_name);
  IF v_name IS NULL OR v_name = '' THEN RETURN NULL; END IF;
  SELECT a.af_team_id INTO v_af FROM public.team_name_aliases a
   WHERE a.reviewed AND a.name_key = v_name AND a.scope IN (COALESCE(p_tournament, ''), '')
   ORDER BY (a.scope = '') ASC
   LIMIT 1;
  IF FOUND THEN RETURN 'af:' || v_af; END IF;
  RETURN 'n:' || v_name;
END;
$$;

-- Clave de un lado de una fila existente: el proveedor sale de su external_id.
CREATE FUNCTION public.match_team_key(p_tournament text, p_external_id text, p_name text, p_flag text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.canonical_team_key(p_tournament, p_name,
    (SELECT e.provider FROM public.match_provider_from_external_id(p_external_id) e), NULL, p_flag);
$$;

-- Un lado coincide si ambas claves son af: e iguales, o si alguna no es af:
-- y los nombres normalizados son iguales. af: distintas NUNCA caen a nombres.
CREATE FUNCTION public.team_side_match(p_key_a text, p_name_a text, p_key_b text, p_name_b text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN p_key_a IS NULL OR p_key_b IS NULL THEN false
           WHEN p_key_a LIKE 'af:%' AND p_key_b LIKE 'af:%' THEN p_key_a = p_key_b
           ELSE COALESCE(p_name_a <> '' AND p_name_a = p_name_b, false)
         END;
$$;

-- Regla compartida por el resolvedor y el detector. Devuelve el nombre de la
-- regla que identifica A y B como el mismo partido, o NULL. p_base: ±2 h en el
-- resolvedor, ±6 h en el detector. p_detector agrega dos reglas que solo
-- ALERTAN (nunca vinculan): orden invertido en la ventana (0 pares en prod) y
-- un mismo equipo en dos filas confirmadas a menos de 6 h, que no puede ser
-- legítimo aunque el rival no tenga id (FD 498 Sporting, FD 674 PSV).
CREATE FUNCTION public.fixture_identity_rule(
  a_home_key text, a_away_key text, a_home_name text, a_away_name text,
  a_kickoff timestamptz, a_confirmed boolean, a_phase text, a_match_day integer,
  b_home_key text, b_away_key text, b_home_name text, b_away_name text,
  b_kickoff timestamptz, b_confirmed boolean, b_phase text, b_match_day integer,
  p_base interval, p_detector boolean DEFAULT false)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH x AS (
    SELECT abs(extract(epoch FROM (a_kickoff - b_kickoff))) AS gap,
           public.team_side_match(a_home_key, a_home_name, b_home_key, b_home_name)
             AND public.team_side_match(a_away_key, a_away_name, b_away_key, b_away_name) AS same_order,
           public.team_side_match(a_home_key, a_home_name, b_away_key, b_away_name)
             AND public.team_side_match(a_away_key, a_away_name, b_home_key, b_home_name) AS reversed,
           a_home_key LIKE 'af:%' AND a_away_key LIKE 'af:%'
             AND b_home_key LIKE 'af:%' AND b_away_key LIKE 'af:%' AS all_af,
           public.team_side_match(a_home_key, a_home_name, b_home_key, b_home_name)
             OR public.team_side_match(a_away_key, a_away_name, b_away_key, b_away_name)
             OR public.team_side_match(a_home_key, a_home_name, b_away_key, b_away_name)
             OR public.team_side_match(a_away_key, a_away_name, b_home_key, b_home_name) AS shared_team
  )
  SELECT CASE
    WHEN x.same_order AND x.gap <= extract(epoch FROM p_base) THEN 'same_pair_window'
    WHEN p_detector AND x.reversed AND x.gap <= extract(epoch FROM p_base) THEN 'reversed_pair_window'
    -- Fecha provisional: se mueve cuando asignan la jornada. match_day distinto veta.
    WHEN x.same_order AND (NOT a_confirmed OR NOT b_confirmed)
         AND NOT (a_match_day IS NOT NULL AND b_match_day IS NOT NULL AND a_match_day <> b_match_day)
         AND x.gap <= 3 * 86400 THEN 'provisional_3d'
    -- Final/tercer puesto: partido único; los proveedores pueden invertir local.
    WHEN x.all_af AND a_phase IN ('final','third_place') AND b_phase = a_phase
         AND (x.same_order OR x.reversed) AND x.gap <= 7 * 86400 THEN 'final_any_order_7d'
    -- Fase de liga estructurada con la MISMA jornada presente en ambos lados.
    WHEN x.all_af AND x.same_order
         AND a_phase IN ('league_stage','regular_season') AND b_phase IN ('league_stage','regular_season')
         AND a_match_day IS NOT NULL AND b_match_day IS NOT NULL AND a_match_day = b_match_day
         AND x.gap <= 8 * 86400 THEN 'league_matchday_8d'
    WHEN p_detector AND x.shared_team AND a_confirmed AND b_confirmed
         AND x.gap <= extract(epoch FROM p_base) THEN 'shared_team_window'
  END
  FROM x;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Resolución de identidad (solo lectura, compartida por plan y escritor)
-- ─────────────────────────────────────────────────────────────────────
-- outcome: linked (id de proveedor ya conocido en el torneo) | matched
-- (candidato único por claves) | none | ambiguous | conflict (id conocido en
-- OTRO torneo). teams_agree solo aplica a linked.
CREATE FUNCTION public.resolve_match_identity(
  p_tournament text, p_provider text, p_provider_match_id text,
  p_home_key text, p_away_key text, p_home_team text, p_away_team text,
  p_scheduled_at timestamptz, p_scheduled_at_confirmed boolean,
  p_phase text, p_match_day integer)
RETURNS TABLE(outcome text, match_id uuid, candidate_count integer, rule text, teams_agree boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_home_name text := public.normalize_team_name(p_home_team);
  v_away_name text := public.normalize_team_name(p_away_team);
  v_ext text := public.provider_external_id(p_provider, p_provider_match_id);
  v_id uuid;
  v_tournament text;
  v_count integer;
  v_rule text;
  v_agree boolean;
BEGIN
  -- a) Id de proveedor ya vinculado. Fuera del torneo es conflicto, no vínculo.
  IF p_provider IS NOT NULL AND p_provider_match_id IS NOT NULL THEN
    SELECT m.id, m.tournament,
           public.fixture_identity_rule(
             COALESCE(m.home_team_key, public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag)),
             COALESCE(m.away_team_key, public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag)),
             public.normalize_team_name(m.home_team), public.normalize_team_name(m.away_team),
             p_scheduled_at, true, m.phase, NULL,
             p_home_key, p_away_key, v_home_name, v_away_name,
             p_scheduled_at, true, p_phase, NULL, interval '0', false) IS NOT NULL
      INTO v_id, v_tournament, v_agree
      FROM public.match_provider_ids l JOIN public.matches m ON m.id = l.match_id
     WHERE l.provider = p_provider AND l.provider_match_id = p_provider_match_id;
    IF v_id IS NOT NULL THEN
      IF v_tournament IS DISTINCT FROM p_tournament THEN
        RETURN QUERY SELECT 'conflict'::text, v_id, 1, 'provider_id_other_tournament'::text, false;
      ELSE
        RETURN QUERY SELECT 'linked'::text, v_id, 1, 'provider_id'::text, v_agree;
      END IF;
      RETURN;
    END IF;

    -- b) Ids legacy (external_id, source_external_ids, espn_id) limitados al
    --    torneo. Una fila placeholder no absorbe un partido con equipos reales
    --    y las filas TBD fusionadas (espn_id ≠ external_id) no cuentan.
    SELECT count(*), (array_agg(m.id))[1],
           bool_and(public.fixture_identity_rule(
             COALESCE(m.home_team_key, public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag)),
             COALESCE(m.away_team_key, public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag)),
             public.normalize_team_name(m.home_team), public.normalize_team_name(m.away_team),
             p_scheduled_at, true, m.phase, NULL,
             p_home_key, p_away_key, v_home_name, v_away_name,
             p_scheduled_at, true, p_phase, NULL, interval '0', false) IS NOT NULL)
      INTO v_count, v_id, v_agree
      FROM public.matches m
     WHERE m.tournament = p_tournament
       AND (m.external_id = v_ext OR v_ext = ANY(m.source_external_ids)
            OR (p_provider = 'espn' AND m.espn_id = p_provider_match_id))
       AND NOT (m.external_id LIKE 'espn:%' AND m.espn_id IS NOT NULL AND m.external_id <> 'espn:' || m.espn_id)
       AND NOT ((public.is_placeholder_team_name(m.home_team) OR public.is_placeholder_team_name(m.away_team))
                AND NOT public.is_placeholder_team_name(p_home_team)
                AND NOT public.is_placeholder_team_name(p_away_team));
    IF v_count > 1 THEN
      RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, v_count, 'legacy_external_id'::text, NULL::boolean;
      RETURN;
    ELSIF v_count = 1 THEN
      RETURN QUERY SELECT 'linked'::text, v_id, 1, 'legacy_external_id'::text, v_agree;
      RETURN;
    END IF;
  END IF;

  IF p_home_key IS NULL OR p_away_key IS NULL THEN
    RETURN QUERY SELECT 'none'::text, NULL::uuid, 0, 'placeholder_or_unknown_team'::text, NULL::boolean;
    RETURN;
  END IF;

  -- c) Igualdad de pares de claves dentro de las ventanas de fixture_identity_rule.
  SELECT count(*), (array_agg(c.id))[1], (array_agg(c.rule))[1]
    INTO v_count, v_id, v_rule
    FROM (
      SELECT m.id, public.fixture_identity_rule(
               COALESCE(m.home_team_key, public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag)),
               COALESCE(m.away_team_key, public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag)),
               public.normalize_team_name(m.home_team), public.normalize_team_name(m.away_team),
               m.scheduled_at, m.scheduled_at_confirmed, m.phase, m.match_day,
               p_home_key, p_away_key, v_home_name, v_away_name,
               p_scheduled_at, COALESCE(p_scheduled_at_confirmed, true), p_phase, p_match_day,
               interval '2 hours', false) AS rule
        FROM public.matches m
       WHERE m.tournament = p_tournament
         AND m.scheduled_at BETWEEN p_scheduled_at - interval '8 days' AND p_scheduled_at + interval '8 days'
         AND NOT public.is_placeholder_team_name(m.home_team)
         AND NOT public.is_placeholder_team_name(m.away_team)
    ) c
   WHERE c.rule IS NOT NULL;

  IF v_count > 1 THEN
    RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, v_count, v_rule, NULL::boolean;
  ELSIF v_count = 1 THEN
    RETURN QUERY SELECT 'matched'::text, v_id, 1, v_rule, NULL::boolean;
  ELSE
    RETURN QUERY SELECT 'none'::text, NULL::uuid, 0, NULL::text, NULL::boolean;
  END IF;
END;
$$;

-- Decisión que tomaría un escritor, SIN escribir: link | insert | block | ambiguous.
CREATE FUNCTION public.plan_match_upsert(
  p_provider text, p_provider_match_id text, p_tournament text, p_phase text, p_match_day integer,
  p_home_team text, p_away_team text,
  p_home_provider_team_id text, p_away_provider_team_id text,
  p_home_team_flag text, p_away_team_flag text,
  p_scheduled_at timestamptz, p_scheduled_at_confirmed boolean, p_status text DEFAULT NULL)
RETURNS TABLE(decision text, match_id uuid, reason text, home_key text, away_key text, candidate_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_home text;
  v_away text;
  r record;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('football-data','espn','api-football','openfootball')
     OR p_tournament IS NULL OR p_scheduled_at IS NULL THEN
    RETURN QUERY SELECT 'block'::text, NULL::uuid, 'invalid_input'::text, NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  v_home := public.canonical_team_key(p_tournament, p_home_team, p_provider, p_home_provider_team_id, p_home_team_flag);
  v_away := public.canonical_team_key(p_tournament, p_away_team, p_provider, p_away_provider_team_id, p_away_team_flag);
  IF v_home IS NULL OR v_away IS NULL THEN
    RETURN QUERY SELECT 'block'::text, NULL::uuid, 'placeholder_team'::text, v_home, v_away, 0;
    RETURN;
  END IF;

  SELECT * INTO r FROM public.resolve_match_identity(p_tournament, p_provider, p_provider_match_id,
    v_home, v_away, p_home_team, p_away_team, p_scheduled_at, p_scheduled_at_confirmed, p_phase, p_match_day);

  IF r.outcome = 'conflict' THEN
    RETURN QUERY SELECT 'block'::text, r.match_id, r.rule, v_home, v_away, r.candidate_count;
  ELSIF r.outcome = 'linked' THEN
    IF r.teams_agree THEN
      RETURN QUERY SELECT 'link'::text, r.match_id, r.rule, v_home, v_away, 1;
    ELSE
      RETURN QUERY SELECT 'block'::text, r.match_id, 'linked_teams_disagree'::text, v_home, v_away, 1;
    END IF;
  ELSIF r.outcome = 'ambiguous' THEN
    RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, r.rule, v_home, v_away, r.candidate_count;
  ELSIF r.outcome = 'matched' THEN
    IF EXISTS (SELECT 1 FROM public.match_provider_ids l
                WHERE l.match_id = r.match_id AND l.provider = p_provider
                  AND l.provider_match_id IS DISTINCT FROM p_provider_match_id) THEN
      RETURN QUERY SELECT 'block'::text, r.match_id, 'target_linked_to_other_provider_id'::text, v_home, v_away, 1;
    ELSE
      RETURN QUERY SELECT 'link'::text, r.match_id, r.rule, v_home, v_away, 1;
    END IF;
  ELSE
    -- Sin candidato. API-Football no inserta rondas desconocidas, horas no
    -- confirmadas ni partidos TBD/aplazados/cancelados (crítica #5).
    IF p_provider = 'api-football' AND p_phase IS NULL THEN
      RETURN QUERY SELECT 'block'::text, NULL::uuid, 'unknown_phase'::text, v_home, v_away, 0;
    ELSIF p_provider = 'api-football'
          AND (NOT COALESCE(p_scheduled_at_confirmed, false)
               OR upper(COALESCE(p_status, '')) IN ('TBD','PST','CANC','ABD','AWD','WO','SUSP','INT','POSTPONED','CANCELLED')) THEN
      RETURN QUERY SELECT 'block'::text, NULL::uuid, 'unconfirmed_or_postponed'::text, v_home, v_away, 0;
    ELSIF p_phase IN ('league_stage','regular_season') AND p_match_day IS NOT NULL
          AND v_home LIKE 'af:%' AND v_away LIKE 'af:%'
          AND EXISTS (
            SELECT 1 FROM public.matches m
             WHERE m.tournament = p_tournament
               AND m.phase IN ('league_stage','regular_season')
               AND m.match_day = p_match_day
               AND COALESCE(m.home_team_key, public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag)) = v_home
               AND COALESCE(m.away_team_key, public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag)) = v_away) THEN
      -- Mismo par, misma jornada estructurada, fuera de ventana: alerta, no fila nueva.
      RETURN QUERY SELECT 'block'::text, NULL::uuid, 'same_pair_same_matchday'::text, v_home, v_away, 0;
    ELSE
      RETURN QUERY SELECT 'insert'::text, NULL::uuid, 'no_candidate'::text, v_home, v_away, 0;
    END IF;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Único camino para registrar un vínculo de proveedor (crítica #6)
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.link_match_provider_id(
  p_provider text, p_provider_match_id text, p_tournament text, p_phase text, p_match_day integer,
  p_home_team text, p_away_team text,
  p_home_provider_team_id text, p_away_provider_team_id text,
  p_home_team_flag text, p_away_team_flag text,
  p_scheduled_at timestamptz, p_scheduled_at_confirmed boolean, p_status text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_home text;
  v_away text;
  r record;
  v_row_home text;
  v_row_away text;
  v_stored_home text;
  v_stored_away text;
  v_calc_home text;
  v_calc_away text;
  v_row_phase text;
  v_linked uuid;
  v_refusal text;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('football-data','espn','api-football','openfootball')
     OR p_provider_match_id IS NULL OR p_provider_match_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_tournament IS NULL OR p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Invalid provider link input';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('match_link:' || p_provider || ':' || p_provider_match_id, 0));

  v_home := public.canonical_team_key(p_tournament, p_home_team, p_provider, p_home_provider_team_id, p_home_team_flag);
  v_away := public.canonical_team_key(p_tournament, p_away_team, p_provider, p_away_provider_team_id, p_away_team_flag);
  -- Sin claves af: no hay identidad fuerte: no se vincula (ni se alerta: es lo normal sin crosswalk).
  IF v_home IS NULL OR v_away IS NULL OR v_home NOT LIKE 'af:%' OR v_away NOT LIKE 'af:%' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM public.resolve_match_identity(p_tournament, p_provider, p_provider_match_id,
    v_home, v_away, p_home_team, p_away_team, p_scheduled_at, p_scheduled_at_confirmed, p_phase, p_match_day);

  -- Ya vinculado en este torneo y con los mismos equipos: solo refresca la observación.
  IF r.outcome = 'linked' AND r.rule = 'provider_id' AND r.teams_agree THEN
    UPDATE public.match_provider_ids l SET
      observed_kickoff = p_scheduled_at, observed_confirmed = p_scheduled_at_confirmed,
      observed_status = p_status, observed_at = now()
     WHERE l.provider = p_provider AND l.provider_match_id = p_provider_match_id;
    RETURN r.match_id;
  END IF;

  IF r.outcome IN ('linked','matched') AND r.candidate_count = 1 THEN
    SELECT m.home_team_key, m.away_team_key,
           public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag),
           public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag),
           m.phase
      INTO v_stored_home, v_stored_away, v_calc_home, v_calc_away, v_row_phase
      FROM public.matches m WHERE m.id = r.match_id FOR SHARE;
    v_row_home := COALESCE(v_stored_home, v_calc_home);
    v_row_away := COALESCE(v_stored_away, v_calc_away);
    -- Hasta que el escritor central mantenga las claves (Paso 6), un escritor
    -- puede cambiar nombre o bandera sin tocarlas. Una clave guardada que ya no
    -- coincide con la recalculada no sirve para vincular: se rechaza y se revisa
    -- con refresh_match_team_keys().
    IF (v_stored_home IS NOT NULL AND v_stored_home IS DISTINCT FROM v_calc_home)
       OR (v_stored_away IS NOT NULL AND v_stored_away IS DISTINCT FROM v_calc_away) THEN
      v_refusal := 'stale_team_key';
    ELSIF NOT (v_row_home = v_home AND v_row_away = v_away
            OR (p_phase IN ('final','third_place') AND v_row_phase = p_phase
                AND v_row_home = v_away AND v_row_away = v_home)) THEN
      v_refusal := 'keys_not_equal_af';
    ELSIF EXISTS (SELECT 1 FROM public.match_provider_ids l
                   WHERE l.match_id = r.match_id AND l.provider = p_provider
                     AND l.provider_match_id <> p_provider_match_id) THEN
      v_refusal := 'target_linked_to_other_provider_id';
    ELSE
      INSERT INTO public.match_provider_ids AS l (
        provider, provider_match_id, match_id, observed_kickoff, observed_confirmed,
        observed_status, observed_at, source)
      VALUES (p_provider, p_provider_match_id, r.match_id, p_scheduled_at, p_scheduled_at_confirmed,
        p_status, now(), 'link:' || r.rule)
      ON CONFLICT (provider, provider_match_id) DO UPDATE SET
        observed_kickoff = EXCLUDED.observed_kickoff,
        observed_confirmed = EXCLUDED.observed_confirmed,
        observed_status = EXCLUDED.observed_status,
        observed_at = EXCLUDED.observed_at
       WHERE l.match_id = EXCLUDED.match_id
      RETURNING l.match_id INTO v_linked;
      IF v_linked IS NOT NULL THEN RETURN v_linked; END IF;
      v_refusal := 'provider_id_linked_elsewhere';
    END IF;
  ELSIF r.outcome IN ('ambiguous','conflict') OR (r.outcome = 'linked' AND NOT COALESCE(r.teams_agree, false)) THEN
    v_refusal := r.outcome || ':' || COALESCE(r.rule, '');
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.admin_alerts (kind, title, body, dedupe_key)
  VALUES ('fixture_link_refused',
    'Vínculo de partido rechazado: ' || p_home_team || ' vs ' || p_away_team,
    'link_match_provider_id no vinculó ' || p_provider || ' ' || p_provider_match_id ||
      ' (' || p_tournament || ', saque ' || p_scheduled_at::text || '): ' || v_refusal ||
      '. No se escribió nada en matches. Revisar identidad antes de vincular.',
    'fixture_link_refused:' || p_provider || ':' || p_provider_match_id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Re-key revisado (reemplaza "las claves solo suben", crítica #2)
-- ─────────────────────────────────────────────────────────────────────
-- Siempre reporta. Con p_apply aplica 'initial' (NULL→clave), 'upgrade'
-- (n:→af:) y 'rename' (n:→n:). 'rekey' (af:→otra af:) y 'downgrade'
-- (af:→n:/NULL) solo con p_allow_rekey, después de revisar el reporte.
CREATE FUNCTION public.refresh_match_team_keys(
  p_tournament text DEFAULT NULL, p_apply boolean DEFAULT false, p_allow_rekey boolean DEFAULT false)
RETURNS TABLE(match_id uuid, side text, old_key text, new_key text, change text, applied boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH calc AS (
    SELECT m.id, m.home_team_key AS old_home, m.away_team_key AS old_away,
           public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag) AS new_home,
           public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag) AS new_away
      FROM public.matches m
     WHERE p_tournament IS NULL OR m.tournament = p_tournament
  ), sides AS (
    SELECT c.id, 'home'::text AS side, c.old_home AS old_key, c.new_home AS new_key FROM calc c
    UNION ALL
    SELECT c.id, 'away'::text, c.old_away, c.new_away FROM calc c
  ), classified AS (
    SELECT s.id, s.side, s.old_key, s.new_key,
           CASE
             WHEN s.old_key IS NULL THEN 'initial'
             WHEN s.old_key LIKE 'n:%' AND s.new_key LIKE 'af:%' THEN 'upgrade'
             WHEN s.old_key LIKE 'n:%' AND s.new_key LIKE 'n:%' THEN 'rename'
             WHEN s.old_key LIKE 'af:%' AND s.new_key LIKE 'af:%' THEN 'rekey'
             ELSE 'downgrade'
           END AS change
      FROM sides s
     WHERE s.old_key IS DISTINCT FROM s.new_key
  ), decided AS (
    SELECT k.*, (p_apply AND (k.change IN ('initial','upgrade','rename') OR p_allow_rekey)) AS do_apply
      FROM classified k
  ), upd AS (
    UPDATE public.matches m SET
      home_team_key = CASE WHEN h.id IS NOT NULL THEN h.new_key ELSE m.home_team_key END,
      away_team_key = CASE WHEN a.id IS NOT NULL THEN a.new_key ELSE m.away_team_key END
      FROM (SELECT DISTINCT d.id FROM decided d WHERE d.do_apply) t
      LEFT JOIN decided h ON h.id = t.id AND h.side = 'home' AND h.do_apply
      LEFT JOIN decided a ON a.id = t.id AND a.side = 'away' AND a.do_apply
     WHERE m.id = t.id
    RETURNING m.id
  )
  SELECT d.id, d.side, d.old_key, d.new_key, d.change, d.do_apply FROM decided d;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Detector de duplicados
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fixture_duplicate_pairs()
RETURNS TABLE(tournament text, match_a uuid, match_b uuid, external_a text, external_b text,
              home_team text, away_team text, kickoff_a timestamptz, kickoff_b timestamptz, rule text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH r AS (
    SELECT m.id, m.tournament::text AS tournament, m.external_id::text AS external_id,
           m.home_team::text AS home_team, m.away_team::text AS away_team,
           m.scheduled_at, m.scheduled_at_confirmed, m.phase::text AS phase, m.match_day,
           COALESCE(m.home_team_key, public.match_team_key(m.tournament, m.external_id, m.home_team, m.home_team_flag)) AS hk,
           COALESCE(m.away_team_key, public.match_team_key(m.tournament, m.external_id, m.away_team, m.away_team_flag)) AS ak,
           public.normalize_team_name(m.home_team) AS hn,
           public.normalize_team_name(m.away_team) AS an
      FROM public.matches m
     WHERE NOT public.is_placeholder_team_name(m.home_team)
       AND NOT public.is_placeholder_team_name(m.away_team)
  )
  SELECT a.tournament, a.id, b.id, a.external_id, b.external_id, a.home_team, a.away_team,
         a.scheduled_at, b.scheduled_at, x.rule
    FROM r a
    JOIN r b ON b.tournament = a.tournament AND a.id < b.id
            AND b.scheduled_at BETWEEN a.scheduled_at - interval '8 days' AND a.scheduled_at + interval '8 days'
            -- Prefiltro barato: algún equipo en común por nombre o clave.
            AND (a.hn IN (b.hn, b.an) OR a.an IN (b.hn, b.an) OR a.hk IN (b.hk, b.ak) OR a.ak IN (b.hk, b.ak))
    CROSS JOIN LATERAL (
      SELECT public.fixture_identity_rule(
        a.hk, a.ak, a.hn, a.an, a.scheduled_at, a.scheduled_at_confirmed, a.phase, a.match_day,
        b.hk, b.ak, b.hn, b.an, b.scheduled_at, b.scheduled_at_confirmed, b.phase, b.match_day,
        interval '6 hours', true) AS rule
    ) x
   WHERE x.rule IS NOT NULL;
$$;

CREATE FUNCTION public.detect_duplicate_fixtures()
RETURNS TABLE(pairs_found integer, alerts_created integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH p AS (SELECT * FROM public.fixture_duplicate_pairs()),
  ins AS (
    INSERT INTO public.admin_alerts (kind, title, body, dedupe_key)
    SELECT 'fixture_duplicate',
           'Partido duplicado: ' || p.home_team || ' vs ' || p.away_team,
           'Dos filas de ' || p.tournament || ' parecen el mismo partido (' || p.rule || '): ' ||
             COALESCE(p.external_a, 'sin external_id') || ' ' || p.match_a || ' a las ' || p.kickoff_a::text ||
             ' y ' || COALESCE(p.external_b, 'sin external_id') || ' ' || p.match_b || ' a las ' || p.kickoff_b::text ||
             '. No se fusionó nada: revisar referencias (pronósticos, pollas, Casa) y decidir con el dueño.',
           'fixture_duplicate:' || p.match_a || ':' || p.match_b
      FROM p
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM p)::integer, (SELECT count(*) FROM ins)::integer;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Permisos de funciones (Supabase auto-otorga a anon/authenticated)
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.is_placeholder_team_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_team_id_from_flag(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_provider_from_external_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_external_id(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_team_key(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_team_key(text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_side_match(text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fixture_identity_rule(text,text,text,text,timestamptz,boolean,text,integer,text,text,text,text,timestamptz,boolean,text,integer,interval,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_match_identity(text,text,text,text,text,text,text,timestamptz,boolean,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_match_upsert(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_match_provider_id(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_match_team_keys(text,boolean,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fixture_duplicate_pairs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_duplicate_fixtures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_placeholder_team_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_team_id_from_flag(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_provider_from_external_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_external_id(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.canonical_team_key(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_team_key(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_side_match(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fixture_identity_rule(text,text,text,text,timestamptz,boolean,text,integer,text,text,text,text,timestamptz,boolean,text,integer,interval,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_match_identity(text,text,text,text,text,text,text,timestamptz,boolean,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_match_upsert(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_match_provider_id(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_match_team_keys(text,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fixture_duplicate_pairs() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_duplicate_fixtures() TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Backfill (solo columnas/tablas nuevas)
-- ─────────────────────────────────────────────────────────────────────
-- Claves iniciales. Sin crosswalk todavía salen n:, salvo banderas AF en filas
-- apifootball:. La migración 111 sube a af: con refresh_match_team_keys().
DO $$
DECLARE v_changes integer;
BEGIN
  SELECT count(*) INTO v_changes FROM public.refresh_match_team_keys(NULL, true, false) WHERE applied;
  RAISE NOTICE '110: claves de equipo iniciales: %', v_changes;
END $$;

-- Vínculos desde external_id, source_external_ids y espn_id. La marca afseen=
-- de las notas no se usa: 0 filas la conservan (la finalización la sobrescribe).
-- Función idempotente (ON CONFLICT DO NOTHING) para poder probarla y re-correrla.
CREATE FUNCTION public.match_provider_id_candidates()
RETURNS TABLE(match_id uuid, provider text, provider_match_id text, origin text,
              scheduled_at timestamptz, scheduled_at_confirmed boolean, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (x.match_id, x.provider, x.provider_match_id)
         x.match_id, x.provider, x.provider_match_id, x.origin,
         x.scheduled_at, x.scheduled_at_confirmed, x.status
    FROM (
      SELECT m.id AS match_id, e.provider, e.provider_match_id, 1 AS priority, 'backfill:external_id' AS origin,
             m.scheduled_at, m.scheduled_at_confirmed, m.status::text AS status
        FROM public.matches m
        CROSS JOIN LATERAL public.match_provider_from_external_id(m.external_id) e
       WHERE m.home_team !~* '^TB[DAC]\y' AND m.away_team !~* '^TB[DAC]\y'
         -- Filas TBD fusionadas: espn_id distinto del id de external_id (crítica #1).
         AND NOT (m.external_id LIKE 'espn:%' AND m.espn_id IS NOT NULL AND m.external_id <> 'espn:' || m.espn_id)
      UNION ALL
      SELECT m.id, e.provider, e.provider_match_id, 2, 'backfill:source_external_ids',
             m.scheduled_at, m.scheduled_at_confirmed, m.status::text
        FROM public.matches m
        CROSS JOIN LATERAL unnest(m.source_external_ids) s(ext)
        CROSS JOIN LATERAL public.match_provider_from_external_id(s.ext) e
       WHERE m.home_team !~* '^TB[DAC]\y' AND m.away_team !~* '^TB[DAC]\y'
         AND NOT (m.external_id LIKE 'espn:%' AND m.espn_id IS NOT NULL AND m.external_id <> 'espn:' || m.espn_id)
      UNION ALL
      SELECT m.id, 'espn', m.espn_id, 3, 'backfill:espn_id',
             m.scheduled_at, m.scheduled_at_confirmed, m.status::text
        FROM public.matches m
       WHERE m.espn_id ~ '^[0-9]{1,12}$'
         AND m.home_team !~* '^TB[DAC]\y' AND m.away_team !~* '^TB[DAC]\y'
         AND NOT (m.external_id LIKE 'espn:%' AND m.external_id <> 'espn:' || m.espn_id)
    ) x
   ORDER BY x.match_id, x.provider, x.provider_match_id, x.priority;
$$;

CREATE FUNCTION public.backfill_match_provider_ids()
RETURNS TABLE(inserted integer, conflicting_rows integer, shared_ids integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inserted integer;
  v_multi integer;
  v_shared integer;
BEGIN
  -- Una fila con dos ids del mismo proveedor, o un id en dos filas, es sospecha:
  -- no se vincula ninguno (queda para revisión; el detector lo verá).
  SELECT count(*) INTO v_multi FROM (
    SELECT s.match_id, s.provider FROM public.match_provider_id_candidates() s
     GROUP BY 1, 2 HAVING count(*) > 1) q;
  SELECT count(*) INTO v_shared FROM (
    SELECT s.provider, s.provider_match_id FROM public.match_provider_id_candidates() s
     GROUP BY 1, 2 HAVING count(DISTINCT s.match_id) > 1) q;

  WITH src AS (SELECT * FROM public.match_provider_id_candidates())
  INSERT INTO public.match_provider_ids (
    provider, provider_match_id, match_id, observed_kickoff, observed_confirmed, observed_status, observed_at, source)
  SELECT s.provider, s.provider_match_id, s.match_id, s.scheduled_at, s.scheduled_at_confirmed, s.status, NULL, s.origin
    FROM src s
   WHERE NOT EXISTS (SELECT 1 FROM src o WHERE o.match_id = s.match_id AND o.provider = s.provider
                        AND o.provider_match_id <> s.provider_match_id)
     AND NOT EXISTS (SELECT 1 FROM src o WHERE o.provider = s.provider AND o.provider_match_id = s.provider_match_id
                        AND o.match_id <> s.match_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN QUERY SELECT v_inserted, v_multi, v_shared;
END;
$$;
REVOKE ALL ON FUNCTION public.match_provider_id_candidates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_match_provider_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_provider_id_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_match_provider_ids() TO service_role;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.backfill_match_provider_ids();
  RAISE NOTICE '110: vínculos backfill %, filas con ids en conflicto %, ids compartidos %',
    r.inserted, r.conflicting_rows, r.shared_ids;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 10. Detector diario (solo si pg_cron existe; local no lo tiene)
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 06:30 UTC, después del discover de las 06:00. cron.schedule con nombre es idempotente.
    EXECUTE $cron$SELECT cron.schedule('detect-duplicate-fixtures', '30 6 * * *',
      'SELECT * FROM public.detect_duplicate_fixtures()')$cron$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
