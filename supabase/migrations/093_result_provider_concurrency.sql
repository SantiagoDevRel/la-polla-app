-- Verified production function snapshot from 2026-09-09 with bounded changes:
-- live/final row locks, immutable verified results, semantic discovery lock,
-- and ONE atomic extras+finalization entry point for every provider/admin.
-- No existing match or prediction rows are changed by this migration.

CREATE OR REPLACE FUNCTION public.finalize_match_result(
 p_match_id uuid,p_home_score integer,p_away_score integer,p_notes text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE verified timestamptz;
BEGIN
 SELECT final_verified_at INTO verified FROM public.matches WHERE id=p_match_id FOR UPDATE;
 IF NOT FOUND OR verified IS NOT NULL THEN RETURN false; END IF;
 IF p_home_score IS NULL OR p_away_score IS NULL OR p_home_score<0 OR p_away_score<0 THEN
  RAISE EXCEPTION 'Invalid regulation score';
 END IF;
 UPDATE public.matches SET home_score=p_home_score,away_score=p_away_score,status='finished' WHERE id=p_match_id;
 UPDATE public.matches SET final_verified_at=now(),final_verification_notes=COALESCE(p_notes,final_verification_notes) WHERE id=p_match_id;
 RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_match_live_espn(p_match_id uuid, p_espn_id text, p_status text, p_home_score integer, p_away_score integer, p_elapsed integer, p_status_detail text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_verified timestamptz;
BEGIN
  SELECT final_verified_at
    INTO v_verified
    FROM public.matches
   WHERE id = p_match_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Un match VERIFICADO es inmutable para el live sync (063):
  -- finalize_match_result ya fijó el score canónico de 90'. Sin este
  -- guard, el tick siguiente del cron re-escribía el score con goles de
  -- alargue (ESPN sigue listando el evento en el scoreboard) y la UI
  -- mostraba un marcador distinto al que pagó puntos.
  IF v_verified IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Only an explicit end-of-regulation payload proves the 90-minute score.
  -- A stored score at first AET/PEN sighting may already include extra time
  -- or be stale. Never promote that mixed-provider value into a snapshot.
  IF p_status_detail = 'STATUS_END_OF_REGULATION' THEN
    UPDATE public.matches
       SET regulation_home_score = COALESCE(regulation_home_score, p_home_score),
           regulation_away_score = COALESCE(regulation_away_score, p_away_score)
     WHERE id = p_match_id
       AND regulation_home_score IS NULL
       AND p_home_score IS NOT NULL
       AND p_away_score IS NOT NULL;
  END IF;

  -- (071) SIN guard monotónico: el score en vivo sigue a ESPN tal cual,
  -- incluidas bajadas por goles anulados (VAR). COALESCE solo protege el
  -- caso NULL (ESPN sin dato → conservar el valor previo).
  UPDATE public.matches SET
    espn_id            = COALESCE(public.matches.espn_id, p_espn_id),
    status             = p_status,
    home_score         = COALESCE(p_home_score, home_score),
    away_score         = COALESCE(p_away_score, away_score),
    elapsed            = COALESCE(p_elapsed, elapsed),
    live_status_detail = p_status_detail,
    live_updated_at    = NOW(),
    live_source        = 'espn'
  WHERE id = p_match_id;

  RETURN true;
END;
$function$;

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
  -- Providers may discover the same fixture concurrently with different IDs.
  -- Serialize the semantic lookup AND insert; no date boundary can split this lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_tournament || ':' || public.normalize_team_name(p_home_team) || ':' || public.normalize_team_name(p_away_team), 0));
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

  -- Re-read freshness after acquiring the row lock. A live writer may have
  -- committed since the initial semantic lookup.
  SELECT (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
    INTO v_live_recent FROM public.matches WHERE id=v_id FOR UPDATE;

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

CREATE OR REPLACE FUNCTION public.finalize_verified_match_result(
 p_match_id uuid,p_home_score integer,p_away_score integer,p_notes text,
 p_fulltime_home integer DEFAULT NULL,p_fulltime_away integer DEFAULT NULL,
 p_penalty_home integer DEFAULT NULL,p_penalty_away integer DEFAULT NULL,p_advancer text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE verified timestamptz; match_phase text;
BEGIN
 SELECT final_verified_at,phase INTO verified,match_phase FROM public.matches WHERE id=p_match_id FOR UPDATE;
 IF NOT FOUND OR verified IS NOT NULL THEN RETURN false; END IF;
 IF (p_fulltime_home IS NULL) <> (p_fulltime_away IS NULL)
 OR (p_penalty_home IS NULL) <> (p_penalty_away IS NULL)
 OR p_fulltime_home<0 OR p_fulltime_away<0 OR p_penalty_home<0 OR p_penalty_away<0
 OR (p_advancer IS NOT NULL AND p_advancer NOT IN ('home','away')) THEN RAISE EXCEPTION 'Invalid knockout extras'; END IF;
 IF match_phase IN ('round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final') THEN
  UPDATE public.matches SET fulltime_home_score=p_fulltime_home,fulltime_away_score=p_fulltime_away,
   penalty_home=p_penalty_home,penalty_away=p_penalty_away,advancer=p_advancer WHERE id=p_match_id;
 END IF;
 RETURN public.finalize_match_result(p_match_id,p_home_score,p_away_score,p_notes);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_match_result(uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_match_result(uuid,integer,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.update_match_live_espn(uuid,text,text,integer,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_live_espn(uuid,text,text,integer,integer,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_match_safe(text,text,integer,text,text,text,text,text,timestamptz,text,integer,integer,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_match_safe(text,text,integer,text,text,text,text,text,timestamptz,text,integer,integer,text,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_verified_match_result(uuid,integer,integer,text,integer,integer,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_verified_match_result(uuid,integer,integer,text,integer,integer,integer,integer,text) TO service_role;
