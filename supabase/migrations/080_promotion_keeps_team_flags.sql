-- 080_promotion_keeps_team_flags.sql
-- Bug real (2026-07-18): la FINAL del Mundial (Spain vs Argentina) quedó SIN
-- banderas en /inicio y /pollas/[slug]. Causa raíz en cadena:
--   1. ESPN promovió el slot codificado (W101 vs W102 → equipos reales) pero
--      nuestro resolver (lib/espn/resolve-brackets.ts) no pasa los logos que
--      ESPN sí expone → p_home_team_flag/p_away_team_flag = NULL. (Se deja
--      así a propósito: el lookup de abajo hereda crests de football-data,
--      consistentes con el resto de la app, en vez de mezclar fuentes.)
--   2. El path de promoción de upsert_match_safe (y apply_bracket_proposal en
--      confirm-mode, que fue el que publicó la final) escriben los flags SIN
--      COALESCE → pisaron con NULL.
--   3. El sync full de football-data (que sí trae crests y las habría
--      rellenado por el lookup semántico) ya NO se dispara: solo corre
--      mientras queden slots codificados con kickoff <7 días, y la final era
--      el último slot. Nadie más rellena → NULL para siempre.
-- Las semis y el 3er puesto sí tenían flags porque football-data alcanzó a
-- pasar por ellas antes de que se agotaran los slots.
--
-- Fix:
--   a. Helper lookup_team_flag(tournament, team): busca la bandera más
--      reciente conocida para ese equipo en OTRAS filas de matches del mismo
--      torneo (insensible a acentos/caja vía normalize_team_name — ver drift
--      Curaçao, migración 069).
--   b. upsert_match_safe: el path de promoción y el INSERT usan
--      COALESCE(p_flag, lookup); los dos paths de UPDATE ganan el lookup como
--      tercer fallback (self-healing en cada tick de sync).
--   c. apply_bracket_proposal: mismo COALESCE+lookup al publicar.
--   d. Backfill idempotente de las filas ya afectadas (la final se corrigió
--      a mano el 2026-07-18; esto cubre cualquier otra y es no-op si no hay).
--
-- La fila de la final NO se recrea ni se toca su identidad: solo columnas de
-- display (flags). Cero impacto en predictions/scoring.

-- ────────────────────────────────────────────────────────────────────
-- a) Helper: última bandera conocida del equipo en el torneo.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_team_flag(p_tournament text, p_team text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT flag FROM (
    SELECT home_team_flag AS flag, scheduled_at
      FROM public.matches
     WHERE tournament = p_tournament
       AND home_team_flag IS NOT NULL
       AND public.normalize_team_name(home_team) = public.normalize_team_name(p_team)
    UNION ALL
    SELECT away_team_flag AS flag, scheduled_at
      FROM public.matches
     WHERE tournament = p_tournament
       AND away_team_flag IS NOT NULL
       AND public.normalize_team_name(away_team) = public.normalize_team_name(p_team)
  ) candidates
  ORDER BY scheduled_at DESC
  LIMIT 1
$$;

-- Supabase auto-otorga EXECUTE a anon/authenticated en funciones nuevas
-- (gotcha conocido) — revocar explícito; solo service_role la necesita
-- (siempre se invoca desde los RPCs SECURITY DEFINER o desde syncs admin).
REVOKE EXECUTE ON FUNCTION public.lookup_team_flag(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lookup_team_flag(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lookup_team_flag(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_team_flag(text, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- b) upsert_match_safe v5: flags nunca se pierden por un provider que no
--    los manda. Cuerpo = verbatim de prod (snapshot 2026-07-18) + los
--    COALESCE/lookup marcados con "-- 080".
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_match_safe(p_external_id text, p_tournament text, p_match_day integer, p_phase text, p_home_team text, p_away_team text, p_home_team_flag text, p_away_team_flag text, p_scheduled_at timestamp with time zone, p_venue text, p_home_score integer, p_away_score integer, p_status text, p_elapsed integer, p_home_team_abbr text DEFAULT NULL::text, p_away_team_abbr text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_live_recent boolean;
  v_is_espn boolean := p_external_id LIKE 'espn:%';
  v_espn_numeric text;
  v_is_promotion boolean := false;
  v_is_bracket_promotion boolean := false;
  v_mode text;
  v_slot_home text;
  v_slot_away text;
  v_knockout_phases CONSTANT text[] := ARRAY[
    'round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final'
  ];
BEGIN
  SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_id, v_live_recent
    FROM public.matches
   WHERE external_id = p_external_id;

  IF v_id IS NULL AND v_is_espn THEN
    v_espn_numeric := substring(p_external_id from 6);
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE espn_id = v_espn_numeric;
  END IF;

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

  IF v_id IS NULL THEN
    IF p_match_day IS NOT NULL THEN
      SELECT id, home_team, away_team INTO v_id, v_slot_home, v_slot_away
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
      SELECT id, home_team, away_team INTO v_id, v_slot_home, v_slot_away FROM (
        SELECT id, home_team, away_team, count(*) OVER () AS n_cand
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
      v_is_bracket_promotion := true;
      v_live_recent := false;
    END IF;
  END IF;

  -- NUEVO 064: gating confirm-before-publish.
  IF v_is_bracket_promotion
     AND NOT public.is_bracket_slot(p_home_team)
     AND NOT public.is_bracket_slot(p_away_team) THEN
    SELECT value INTO v_mode FROM public.app_config WHERE key = 'bracket_promotion_mode';
    IF COALESCE(v_mode, 'confirm') = 'confirm' THEN
      INSERT INTO public.bracket_proposals (
        match_id, slot_home, slot_away,
        p_external_id, p_phase, p_home_team, p_away_team,
        p_home_team_flag, p_away_team_flag, p_home_team_abbr, p_away_team_abbr,
        p_scheduled_at, p_venue, p_match_day, source, status, fetched_at
      ) VALUES (
        v_id, v_slot_home, v_slot_away,
        p_external_id, p_phase, p_home_team, p_away_team,
        p_home_team_flag, p_away_team_flag, p_home_team_abbr, p_away_team_abbr,
        p_scheduled_at, p_venue, p_match_day,
        CASE WHEN v_is_espn THEN 'espn'
             WHEN p_external_id LIKE 'wc2026_%' THEN 'openfootball'
             ELSE 'football-data' END,
        'pending', now()
      )
      ON CONFLICT (match_id) DO UPDATE SET
        p_external_id    = EXCLUDED.p_external_id,
        p_phase          = EXCLUDED.p_phase,
        p_home_team      = EXCLUDED.p_home_team,
        p_away_team      = EXCLUDED.p_away_team,
        p_home_team_flag = EXCLUDED.p_home_team_flag,
        p_away_team_flag = EXCLUDED.p_away_team_flag,
        p_home_team_abbr = EXCLUDED.p_home_team_abbr,
        p_away_team_abbr = EXCLUDED.p_away_team_abbr,
        p_scheduled_at   = EXCLUDED.p_scheduled_at,
        p_venue          = EXCLUDED.p_venue,
        p_match_day      = EXCLUDED.p_match_day,
        source           = EXCLUDED.source,
        fetched_at       = now(),
        status = CASE
          WHEN bracket_proposals.status = 'pending' THEN 'pending'
          WHEN bracket_proposals.status = 'rejected'
               AND (bracket_proposals.p_home_team IS DISTINCT FROM EXCLUDED.p_home_team
                    OR bracket_proposals.p_away_team IS DISTINCT FROM EXCLUDED.p_away_team)
            THEN 'pending'
          ELSE bracket_proposals.status
        END;
      RETURN v_id;
    END IF;
  END IF;

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
      p_home_team, p_away_team,
      -- 080: si el provider no manda flag, heredar la última conocida del equipo.
      COALESCE(p_home_team_flag, public.lookup_team_flag(p_tournament, p_home_team)),
      COALESCE(p_away_team_flag, public.lookup_team_flag(p_tournament, p_away_team)),
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
      match_day       = COALESCE(match_day, p_match_day),
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      -- 080: la promoción NUNCA pisa con NULL — el slot codificado no tiene
      -- flag propio y providers como ESPN no mandan (bug final Mundial).
      home_team_flag  = COALESCE(p_home_team_flag, public.lookup_team_flag(p_tournament, p_home_team)),
      away_team_flag  = COALESCE(p_away_team_flag, public.lookup_team_flag(p_tournament, p_away_team)),
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
      -- 080: tercer fallback lookup (self-healing; solo corre si ambos NULL).
      home_team_flag  = COALESCE(p_home_team_flag, home_team_flag, public.lookup_team_flag(p_tournament, p_home_team)),
      away_team_flag  = COALESCE(p_away_team_flag, away_team_flag, public.lookup_team_flag(p_tournament, p_away_team)),
      home_team_abbr  = COALESCE(p_home_team_abbr, home_team_abbr),
      away_team_abbr  = COALESCE(p_away_team_abbr, away_team_abbr),
      scheduled_at    = p_scheduled_at,
      venue           = p_venue
    WHERE id = v_id;
  ELSE
    UPDATE public.matches SET
      tournament      = p_tournament,
      match_day       = CASE
                          WHEN match_day IS NOT NULL AND phase = ANY(v_knockout_phases)
                            THEN match_day
                          ELSE COALESCE(p_match_day, match_day)
                        END,
      phase           = p_phase,
      home_team       = p_home_team,
      away_team       = p_away_team,
      -- 080: tercer fallback lookup (self-healing; solo corre si ambos NULL).
      home_team_flag  = COALESCE(p_home_team_flag, home_team_flag, public.lookup_team_flag(p_tournament, p_home_team)),
      away_team_flag  = COALESCE(p_away_team_flag, away_team_flag, public.lookup_team_flag(p_tournament, p_away_team)),
      home_team_abbr  = COALESCE(p_home_team_abbr, home_team_abbr),
      away_team_abbr  = COALESCE(p_away_team_abbr, away_team_abbr),
      scheduled_at    = p_scheduled_at,
      venue           = p_venue,
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
$function$;

-- ────────────────────────────────────────────────────────────────────
-- c) apply_bracket_proposal: mismo fix al publicar una propuesta
--    (este fue el path exacto que dejó la final sin banderas).
--    Cuerpo verbatim de prod + COALESCE/lookup.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_bracket_proposal(p_proposal_id uuid, p_decided_status text DEFAULT 'approved'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  prop record;
  v_tournament text;
BEGIN
  IF p_decided_status NOT IN ('approved','auto') THEN
    RAISE EXCEPTION 'apply_bracket_proposal: status inválido %', p_decided_status;
  END IF;

  SELECT * INTO prop FROM public.bracket_proposals
   WHERE id = p_proposal_id AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT tournament INTO v_tournament FROM public.matches WHERE id = prop.match_id;

  UPDATE public.matches SET
    external_id     = prop.p_external_id,
    phase           = COALESCE(prop.p_phase, phase),
    match_day       = COALESCE(match_day, prop.p_match_day),
    home_team       = prop.p_home_team,
    away_team       = prop.p_away_team,
    -- 080: publicar una propuesta sin flags (ESPN/openfootball no mandan)
    -- hereda la última bandera conocida del equipo en el torneo.
    home_team_flag  = COALESCE(prop.p_home_team_flag, public.lookup_team_flag(v_tournament, prop.p_home_team)),
    away_team_flag  = COALESCE(prop.p_away_team_flag, public.lookup_team_flag(v_tournament, prop.p_away_team)),
    home_team_abbr  = prop.p_home_team_abbr,
    away_team_abbr  = prop.p_away_team_abbr,
    scheduled_at    = prop.p_scheduled_at,
    venue           = prop.p_venue
  WHERE id = prop.match_id;

  UPDATE public.bracket_proposals
     SET status = p_decided_status, decided_at = now()
   WHERE id = p_proposal_id;

  RETURN prop.match_id;
END;
$function$;

-- Hallazgo colateral (misma clase que migración 079): apply_bracket_proposal
-- tenía EXECUTE para anon/authenticated — cualquier cliente autenticado podía
-- publicar propuestas de bracket vía PostgREST /rpc/. Solo la llaman server
-- actions de admin y pg_cron (service_role). Revocar.
REVOKE EXECUTE ON FUNCTION public.apply_bracket_proposal(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_bracket_proposal(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_bracket_proposal(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bracket_proposal(uuid, text) TO service_role;

-- Cazado por la auditoría codex: el wrapper auto_apply_due_bracket_proposals()
-- (064, SECURITY DEFINER, lo llama el pg_cron auto-apply-brackets como
-- postgres) también era ejecutable por anon/authenticated y llama a
-- apply_bracket_proposal por dentro — evadía el revoke de arriba. Cerrar.
REVOKE EXECUTE ON FUNCTION public.auto_apply_due_bracket_proposals() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_apply_due_bracket_proposals() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_apply_due_bracket_proposals() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_apply_due_bracket_proposals() TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- d) Backfill idempotente: rellenar flags NULL de partidos con equipos
--    reales desde filas hermanas. (La final Spain vs Argentina ya se
--    corrigió a mano el 2026-07-18 — esto es defense-in-depth y no-op
--    si no queda ninguna.)
-- ────────────────────────────────────────────────────────────────────
UPDATE public.matches m SET
  home_team_flag = COALESCE(m.home_team_flag, public.lookup_team_flag(m.tournament, m.home_team)),
  away_team_flag = COALESCE(m.away_team_flag, public.lookup_team_flag(m.tournament, m.away_team))
WHERE (m.home_team_flag IS NULL OR m.away_team_flag IS NULL)
  AND m.home_team <> 'TBD' AND m.away_team <> 'TBD'
  AND NOT public.is_bracket_slot(m.home_team)
  AND NOT public.is_bracket_slot(m.away_team);
