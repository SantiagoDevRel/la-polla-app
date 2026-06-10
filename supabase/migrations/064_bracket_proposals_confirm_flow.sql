-- Migration 064: confirm-before-publish para cruces de bracket.
--
-- PEDIDO DE SANTIAGO (2026-06-10): "después de fase de grupos quiero ver
-- los R32 y yo mismo confirmarlos antes de ponerlos públicos. fetch
-- providers → confirm Santiago → publish to prod."
--
-- MECÁNICA:
--   1. `app_config.bracket_promotion_mode` = 'confirm' (default) | 'auto'.
--   2. Con mode='confirm', cuando upsert_match_safe v5 detecta una
--      promoción de bracket-slot (lookup #3.5), NO aplica el rename:
--      escribe/refresca una fila en `bracket_proposals` (los datos
--      propuestos por el proveedor) y devuelve el id del slot SIN tocarlo.
--      El slot sigue codificado ("W93 vs W94") y pronosticable a ciegas.
--   3. El admin ve las propuestas en /admin (card de knockouts) y las
--      Confirma → `apply_bracket_proposal()` ejecuta la promoción (mismo
--      UPDATE que la rama de promoción del RPC — UUID/predicciones
--      intactos). Rechazar deja el slot codificado; la propuesta solo
--      vuelve a 'pending' si el proveedor manda DATOS DISTINTOS.
--   4. Red de seguridad: `auto_apply_due_bracket_proposals()` (pg_cron
--      cada hora) aplica las propuestas pendientes cuyo kickoff está a
--      <12h, marca status='auto' y deja alerta en admin_alerts — así un
--      partido jamás arranca con nombres codificados porque Santiago
--      estaba ocupado. (Para desactivar el flujo: UPDATE app_config SET
--      value='auto' WHERE key='bracket_promotion_mode'.)
--
-- Las promociones de TBD-placeholder legacy (lookup #4, blind-final)
-- siguen siendo automáticas — no pasan por proposals.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Config del modo.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value)
VALUES ('bracket_promotion_mode', 'confirm')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Tabla de propuestas. Service-role only (igual que admin_alerts).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bracket_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE CASCADE,
  -- Snapshot del slot al momento de proponer (para mostrar "W93 vs W94 → X vs Y").
  slot_home text NOT NULL,
  slot_away text NOT NULL,
  -- Datos propuestos por el proveedor (lo que aplicaría la promoción).
  p_external_id text NOT NULL,
  p_phase text,
  p_home_team text NOT NULL,
  p_away_team text NOT NULL,
  p_home_team_flag text,
  p_away_team_flag text,
  p_home_team_abbr text,
  p_away_team_abbr text,
  p_scheduled_at timestamptz NOT NULL,
  p_venue text,
  p_match_day integer,
  source text NOT NULL DEFAULT 'sync',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','auto')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bracket_proposals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bracket_proposals TO service_role;

DROP POLICY IF EXISTS bracket_proposals_deny_all ON public.bracket_proposals;
CREATE POLICY bracket_proposals_deny_all ON public.bracket_proposals
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_bracket_proposals_pending
  ON public.bracket_proposals (p_scheduled_at)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────
-- 3. upsert_match_safe v5: gating de la promoción por mode.
--    Idéntico a v4 (migración 062) salvo el bloque marcado NUEVO 064.
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
  v_is_bracket_promotion boolean := false;
  v_mode text;
  v_slot_home text;
  v_slot_away text;
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

  -- Lookup #3: dedup semántico.
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

  -- Lookup #3.5: promoción de bracket-slot (migración 062).
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

  -- NUEVO 064: gating confirm-before-publish. Si la promoción es de un
  -- bracket-slot, los equipos entrantes son REALES y el modo es 'confirm',
  -- NO publicamos: staging en bracket_proposals y el slot queda intacto.
  -- (Si lo entrante sigue codificado — re-key del mismo slot — se aplica
  -- directo: no hay nada que "confirmar".)
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
        -- Un 'rejected' solo se re-abre si los EQUIPOS propuestos cambiaron
        -- (el proveedor corrigió). 'approved'/'auto' nunca deberían llegar
        -- acá (el slot ya tendría nombres reales y matchearía el lookup #3),
        -- pero por las dudas no se tocan.
        status = CASE
          WHEN bracket_proposals.status = 'pending' THEN 'pending'
          WHEN bracket_proposals.status = 'rejected'
               AND (bracket_proposals.p_home_team IS DISTINCT FROM EXCLUDED.p_home_team
                    OR bracket_proposals.p_away_team IS DISTINCT FROM EXCLUDED.p_away_team)
            THEN 'pending'
          ELSE bracket_proposals.status
        END;
      RETURN v_id; -- slot intacto: sigue codificado hasta que Santiago confirme
    END IF;
  END IF;

  -- Lookup #4: promoción de placeholder TBD legacy (siempre automática).
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
    -- Guard anti-regresión de fuente (062).
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

    -- Guard NO-INSERT (062).
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

-- ─────────────────────────────────────────────────────────────────────
-- 4. apply_bracket_proposal: publica la promoción confirmada.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_bracket_proposal(
  p_proposal_id uuid,
  p_decided_status text DEFAULT 'approved'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  prop record;
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

  -- Misma forma que la rama de promoción del RPC: UUID intacto,
  -- match_day FIFA preservado.
  UPDATE public.matches SET
    external_id     = prop.p_external_id,
    phase           = COALESCE(prop.p_phase, phase),
    match_day       = COALESCE(match_day, prop.p_match_day),
    home_team       = prop.p_home_team,
    away_team       = prop.p_away_team,
    home_team_flag  = prop.p_home_team_flag,
    away_team_flag  = prop.p_away_team_flag,
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
$$;

REVOKE EXECUTE ON FUNCTION public.apply_bracket_proposal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_bracket_proposal(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Auto-apply de seguridad: propuestas pendientes con kickoff <12h se
--    publican solas (status='auto') + alerta informativa. Evita que un
--    partido arranque con nombres codificados si Santiago no confirmó.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_apply_due_bracket_proposals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  prop record;
  v_count int := 0;
BEGIN
  FOR prop IN
    SELECT id, slot_home, slot_away, p_home_team, p_away_team, p_scheduled_at
      FROM public.bracket_proposals
     WHERE status = 'pending'
       AND p_scheduled_at < now() + interval '12 hours'
  LOOP
    PERFORM public.apply_bracket_proposal(prop.id, 'auto');
    INSERT INTO public.admin_alerts (kind, title, body, dedupe_key)
    VALUES (
      'bracket_auto_applied',
      'Cruce auto-publicado: ' || prop.p_home_team || ' vs ' || prop.p_away_team,
      'La propuesta ' || prop.slot_home || ' vs ' || prop.slot_away || ' → ' ||
        prop.p_home_team || ' vs ' || prop.p_away_team ||
        ' (kickoff ' || prop.p_scheduled_at::text || ') estaba pendiente a <12h del ' ||
        'partido y se publicó automáticamente para no romper el live sync.',
      'bracket_auto:' || prop.id::text
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_apply_due_bracket_proposals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_apply_due_bracket_proposals() TO service_role;

-- Cron horario (idempotente — unschedule si ya existe).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-apply-brackets') THEN
    PERFORM cron.unschedule('auto-apply-brackets');
  END IF;
  PERFORM cron.schedule(
    'auto-apply-brackets',
    '20 * * * *',
    $cron$ SELECT public.auto_apply_due_bracket_proposals() $cron$
  );
END $$;
