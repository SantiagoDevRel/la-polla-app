-- Recent/upcoming club fixtures are independent of which calendar dates a user opened.
ALTER TABLE public.api_football_teams ADD COLUMN matches jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(matches)='array');
CREATE OR REPLACE FUNCTION public.reserve_api_football_detail(p_fixture_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t timestamptz:=clock_timestamp(); d date:=(t AT TIME ZONE 'UTC')::date;
 b public.api_football_budget%ROWTYPE; f jsonb; ttl interval;
BEGIN
 SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
 IF NOT FOUND OR b.plan='Free' OR b.plan_expires_at IS NULL OR b.plan_expires_at<=t
  OR b.plan_checked_at IS NULL OR b.plan_checked_at<t-interval '1 hour' THEN RETURN false; END IF;
 IF b.request_day<>d THEN b.requests_used:=0; END IF;
 -- Leave 1,000 requests for calendar/live/final checks, 500 for manual usage.
 IF b.requests_used>=6000 THEN RETURN false; END IF;
 -- Only fixtures already discovered in the nine-league calendar, never arbitrary user IDs.
 SELECT item INTO f FROM public.api_football_cache c CROSS JOIN LATERAL jsonb_array_elements(c.fixtures) item
 WHERE c.fixture_date BETWEEN d-7 AND d+7 AND item->'fixture'->>'id'=p_fixture_id::text
 ORDER BY c.fetched_at DESC NULLS LAST LIMIT 1;
 IF f IS NULL THEN
 SELECT item INTO f FROM public.api_football_teams c CROSS JOIN LATERAL jsonb_array_elements(c.matches) item
 WHERE c.fetched_at>t-interval '2 days' AND item->'fixture'->>'id'=p_fixture_id::text
 ORDER BY c.fetched_at DESC LIMIT 1;
 END IF;
 IF f IS NULL THEN RETURN false; END IF;
 ttl:=CASE WHEN f->'fixture'->'status'->>'short' IN ('FT','AET','PEN','CANC','ABD','AWD','WO') THEN interval '1 hour'
  WHEN abs(extract(epoch FROM (t-(f->'fixture'->>'date')::timestamptz)))<14400 THEN interval '60 seconds'
  ELSE interval '1 hour' END;
 IF EXISTS(SELECT 1 FROM public.api_football_details WHERE fixture_id=p_fixture_id AND last_attempt_at>t-ttl) THEN RETURN false; END IF;
 INSERT INTO public.api_football_details(fixture_id,last_attempt_at) VALUES(p_fixture_id,t)
 ON CONFLICT(fixture_id) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at;
 UPDATE public.api_football_budget SET request_day=d,requests_used=b.requests_used+1,last_attempt_at=t WHERE singleton;
 RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION public.reserve_api_football_team(p_team_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t timestamptz:=clock_timestamp(); d date:=(t AT TIME ZONE 'UTC')::date; b public.api_football_budget%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
 IF NOT FOUND OR b.plan='Free' OR b.plan_expires_at IS NULL OR b.plan_expires_at<=t
  OR b.plan_checked_at IS NULL OR b.plan_checked_at<t-interval '1 hour' THEN RETURN false; END IF;
 IF b.request_day<>d THEN b.requests_used:=0; END IF;
 IF b.requests_used+4>6000 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM (
  SELECT fixtures FROM public.api_football_cache WHERE fixture_date BETWEEN d-7 AND d+7
  UNION ALL SELECT matches FROM public.api_football_teams WHERE fetched_at>t-interval '2 days'
 ) c CROSS JOIN LATERAL jsonb_array_elements(c.fixtures) f
 WHERE f->'teams'->'home'->>'id'=p_team_id::text OR f->'teams'->'away'->>'id'=p_team_id::text) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.api_football_teams WHERE team_id=p_team_id AND last_attempt_at>t-interval '1 hour') THEN RETURN false; END IF;
 INSERT INTO public.api_football_teams(team_id,last_attempt_at) VALUES(p_team_id,t)
 ON CONFLICT(team_id) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at;
 UPDATE public.api_football_budget SET request_day=d,requests_used=b.requests_used+2,last_attempt_at=t WHERE singleton;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_live_provider(
 p_match_id uuid,p_source text,p_provider_id text,p_status text,p_home_score integer,p_away_score integer,
 p_elapsed integer,p_status_detail text,p_observed_at timestamptz,
 p_regulation_home integer DEFAULT NULL,p_regulation_away integer DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.matches%ROWTYPE;
BEGIN
 IF p_source NOT IN ('api-football','espn') OR p_status NOT IN ('scheduled','live','finished','cancelled')
  OR p_observed_at IS NULL OR p_observed_at>clock_timestamp()+interval '30 seconds'
  OR p_home_score<0 OR p_away_score<0 THEN RAISE EXCEPTION 'Invalid live observation'; END IF;
 SELECT * INTO m FROM public.matches WHERE id=p_match_id FOR UPDATE;
 IF NOT FOUND OR m.final_verified_at IS NOT NULL THEN RETURN false; END IF;
 IF m.live_updated_at>=p_observed_at THEN RETURN false; END IF;
 IF p_status='scheduled' AND m.status IN ('live','finished') AND m.scheduled_at<clock_timestamp() THEN RETURN false; END IF;
 -- ESPN is a fallback only; a fresh primary observation owns the live score.
 IF p_source='espn' AND m.live_source='api-football' AND m.live_updated_at>now()-interval '3 minutes' THEN RETURN false; END IF;
 IF p_regulation_home IS NOT NULL AND p_regulation_away IS NOT NULL AND p_regulation_home>=0 AND p_regulation_away>=0
  AND (p_status_detail='STATUS_END_OF_REGULATION' OR (p_source='api-football' AND p_status_detail IN ('STATUS_OVERTIME','STATUS_SHOOTOUT','STATUS_FINAL_AET','STATUS_FINAL_PEN'))) THEN
  UPDATE public.matches SET regulation_home_score=p_regulation_home,regulation_away_score=p_regulation_away
  WHERE id=p_match_id AND regulation_home_score IS NULL AND regulation_away_score IS NULL;
 END IF;
 UPDATE public.matches SET
  espn_id=CASE WHEN p_source='espn' THEN COALESCE(espn_id,p_provider_id) ELSE espn_id END,
  status=p_status,home_score=COALESCE(p_home_score,home_score),away_score=COALESCE(p_away_score,away_score),
  elapsed=p_elapsed,live_status_detail=p_status_detail,live_updated_at=p_observed_at,live_source=p_source
 WHERE id=p_match_id;
 RETURN true;
END;
$$;
