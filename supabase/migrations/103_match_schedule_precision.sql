-- Preserve date precision and refresh upcoming Casa calendars (2026-09-13).
-- Snapshot: production upsert_match_safe; existing 16-argument callers remain compatible.
-- No prediction, pick, score, payment or result is changed by this migration.
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS scheduled_at_confirmed boolean NOT NULL DEFAULT true;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS source_external_ids text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.matches.scheduled_at_confirmed IS 'False means a provisional calendar date, not a timezone-convertible kickoff. Only confirmed observations may replace confirmed times.';

-- Legacy football-data SCHEDULED rows discarded the provider precision flag.
UPDATE public.matches SET scheduled_at_confirmed=false
 WHERE status='scheduled' AND final_verified_at IS NULL AND scheduled_at>now()
   AND external_id ~ '^[0-9]+$' AND espn_id IS NULL
   AND (scheduled_at AT TIME ZONE 'UTC')::time=time '00:00:00';

CREATE OR REPLACE FUNCTION public.upsert_match_safe(p_external_id text, p_tournament text, p_match_day integer, p_phase text, p_home_team text, p_away_team text, p_home_team_flag text, p_away_team_flag text, p_scheduled_at timestamp with time zone, p_venue text, p_home_score integer, p_away_score integer, p_status text, p_elapsed integer, p_home_team_abbr text, p_away_team_abbr text, p_scheduled_at_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_live_recent boolean;
  v_candidates integer;
  v_is_espn boolean := p_external_id LIKE 'espn:%';
  v_espn_numeric text := CASE WHEN p_external_id LIKE 'espn:%' THEN substring(p_external_id from 6) END;
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
   WHERE external_id = p_external_id OR p_external_id = ANY(source_external_ids);

  IF v_id IS NULL AND v_is_espn THEN
    v_espn_numeric := substring(p_external_id from 6);
    SELECT id, (live_updated_at IS NOT NULL AND live_updated_at > NOW() - INTERVAL '10 minutes')
      INTO v_id, v_live_recent
      FROM public.matches
     WHERE espn_id = v_espn_numeric;
  END IF;

  IF v_id IS NULL THEN
    -- A provisional date can move by a day when the matchday is assigned.
    -- Broaden only when one side is provisional; require a unique pair.
    SELECT count(*), (array_agg(id))[1] INTO v_candidates, v_id
      FROM public.matches
     WHERE tournament = p_tournament
       AND (scheduled_at BETWEEN p_scheduled_at - INTERVAL '2 hours'
                             AND p_scheduled_at + INTERVAL '2 hours'
         OR ((NOT scheduled_at_confirmed OR NOT p_scheduled_at_confirmed
             OR ((p_external_id LIKE 'espn:%' AND external_id ~ '^[0-9]+$')
               OR (external_id LIKE 'espn:%' AND p_external_id ~ '^[0-9]+$')))
           AND (p_match_day IS NULL OR match_day IS NULL OR p_match_day=match_day)
           AND scheduled_at BETWEEN p_scheduled_at - INTERVAL '3 days'
                                AND p_scheduled_at + INTERVAL '3 days'))
       AND public.normalize_team_name(home_team) = public.normalize_team_name(p_home_team)
       AND public.normalize_team_name(away_team) = public.normalize_team_name(p_away_team)
       AND home_team <> 'TBD';
    IF v_candidates > 1 THEN
      RAISE EXCEPTION 'Ambiguous fixture identity: %', p_external_id;
    END IF;
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
      scheduled_at, scheduled_at_confirmed, venue,
      home_score, away_score, status, elapsed,
      espn_id
    ) VALUES (
      p_external_id, p_tournament, p_match_day, p_phase,
      p_home_team, p_away_team,
      -- 080: si el provider no manda flag, heredar la última conocida del equipo.
      COALESCE(p_home_team_flag, public.lookup_team_flag(p_tournament, p_home_team)),
      COALESCE(p_away_team_flag, public.lookup_team_flag(p_tournament, p_away_team)),
      p_home_team_abbr, p_away_team_abbr,
      p_scheduled_at, p_scheduled_at_confirmed, p_venue,
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

  -- Keep every provider identity once linked, including FD on an ESPN row.
  -- Later reschedules can then move any distance without creating another UUID.
  UPDATE public.matches SET source_external_ids=array_append(source_external_ids,p_external_id),
    espn_id=CASE WHEN v_is_espn THEN v_espn_numeric ELSE espn_id END
    WHERE id=v_id AND NOT (p_external_id=ANY(source_external_ids));

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
      scheduled_at    = CASE WHEN final_verified_at IS NOT NULL OR (scheduled_at_confirmed AND NOT p_scheduled_at_confirmed) THEN scheduled_at ELSE p_scheduled_at END,
      scheduled_at_confirmed = scheduled_at_confirmed OR p_scheduled_at_confirmed,
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
      scheduled_at    = CASE WHEN final_verified_at IS NOT NULL OR (scheduled_at_confirmed AND NOT p_scheduled_at_confirmed) THEN scheduled_at ELSE p_scheduled_at END,
      scheduled_at_confirmed = scheduled_at_confirmed OR p_scheduled_at_confirmed,
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
      scheduled_at    = CASE WHEN final_verified_at IS NOT NULL OR (scheduled_at_confirmed AND NOT p_scheduled_at_confirmed) THEN scheduled_at ELSE p_scheduled_at END,
      scheduled_at_confirmed = scheduled_at_confirmed OR p_scheduled_at_confirmed,
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
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_match_safe(p_external_id text, p_tournament text, p_match_day integer, p_phase text, p_home_team text, p_away_team text, p_home_team_flag text, p_away_team_flag text, p_scheduled_at timestamp with time zone, p_venue text, p_home_score integer, p_away_score integer, p_status text, p_elapsed integer, p_home_team_abbr text DEFAULT NULL::text, p_away_team_abbr text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
 SELECT public.upsert_match_safe(p_external_id,p_tournament,p_match_day,p_phase,
   p_home_team,p_away_team,p_home_team_flag,p_away_team_flag,p_scheduled_at,p_venue,
   p_home_score,p_away_score,p_status,p_elapsed,p_home_team_abbr,p_away_team_abbr,
   NOT (p_external_id ~ '^[0-9]+$' AND p_status='scheduled'
     AND (p_scheduled_at AT TIME ZONE 'UTC')::time = time '00:00:00'));
$function$;

-- The new overload is server-only. Existing overload ACLs remain unchanged.
REVOKE ALL ON FUNCTION public.upsert_match_safe(text,text,integer,text,text,text,text,text,timestamptz,text,integer,integer,text,integer,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_match_safe(text,text,integer,text,text,text,text,text,timestamptz,text,integer,integer,text,integer,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_tournament_schedule_sync(p_tournament text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reserved boolean;
BEGIN
 IF p_tournament IS NULL OR p_tournament !~ '^[a-z0-9_]{1,60}$' THEN RETURN false; END IF;
 WITH reservation AS (
   INSERT INTO public.app_config(key,value,updated_at)
   VALUES ('schedule_'||p_tournament,'pending',now())
   ON CONFLICT (key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
    WHERE app_config.updated_at<now()-interval '15 minutes'
   RETURNING 1
 ) SELECT EXISTS(SELECT 1 FROM reservation) INTO reserved;
 RETURN reserved;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_tournament_schedule_sync(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tournament_schedule_sync(text) TO service_role;

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
  -- Active Casa leagues need upcoming schedules even with no legacy P2P pools.
  -- The endpoint applies the shared per-league reservation and configured list.
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
$function$
;

-- Repair the two reported fixtures through the same writer, preserving UUIDs.
-- Confirmed 2026-09-13 by football-data TIMED, ESPN and both official clubs:
-- https://www.fcbarcelona.com/en/matches/138333/fc-barcelona-racing-la-liga-2026-2027
-- https://www.atleticodemadrid.com/entradas/entrada/atletico-de-madrid-osasuna-20
SELECT public.upsert_match_safe(m.external_id,m.tournament,m.match_day,m.phase,
 m.home_team,m.away_team,m.home_team_flag,m.away_team_flag,fix.kickoff,m.venue,
 m.home_score,m.away_score,m.status,m.elapsed,m.home_team_abbr,m.away_team_abbr,true)
FROM public.matches m JOIN (VALUES
 ('564687','2026-09-16T19:30:00Z'::timestamptz),
 ('564684','2026-09-16T17:00:00Z'::timestamptz)
) AS fix(external_id,kickoff) ON m.external_id=fix.external_id
WHERE m.tournament='laliga_2025' AND m.status='scheduled' AND m.final_verified_at IS NULL
 AND m.scheduled_at='2026-09-16T00:00:00Z'::timestamptz;

NOTIFY pgrst, 'reload schema';
