-- Shared quota/cache for Pro. No match or prediction data is changed here.
ALTER TABLE public.api_football_budget
 ADD COLUMN plan text NOT NULL DEFAULT 'Free',
 ADD COLUMN plan_expires_at timestamptz,
 ADD COLUMN plan_checked_at timestamptz;

CREATE TABLE public.api_football_details (
 fixture_id bigint PRIMARY KEY CHECK(fixture_id > 0),
 fixture jsonb,
 fetched_at timestamptz,
 last_attempt_at timestamptz NOT NULL
);
ALTER TABLE public.api_football_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_only ON public.api_football_details FOR ALL TO public USING(false) WITH CHECK(false);
GRANT SELECT,INSERT,UPDATE ON public.api_football_details TO service_role;

CREATE FUNCTION public.record_api_football_account(p_plan text,p_expires timestamptz,p_used integer,p_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_used < 0 OR p_limit < 0 THEN RAISE EXCEPTION 'Invalid account quota'; END IF;
 INSERT INTO public.api_football_budget(singleton,request_day,last_attempt_at)
 VALUES(true,d,'-infinity') ON CONFLICT DO NOTHING;
 UPDATE public.api_football_budget SET
  requests_used=GREATEST(CASE WHEN request_day=d THEN requests_used ELSE 0 END,p_used),request_day=d,
  plan=CASE WHEN p_limit>=7500 AND p_expires>now() THEN p_plan ELSE 'Free' END,
  plan_expires_at=p_expires,plan_checked_at=now() WHERE singleton;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_api_football_request(p_fixture_date date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t timestamptz:=clock_timestamp(); d date:=(t AT TIME ZONE 'UTC')::date;
 b public.api_football_budget%ROWTYPE; paid boolean; ttl interval;
BEGIN
 INSERT INTO public.api_football_budget(singleton,request_day,last_attempt_at)
 VALUES(true,d,'-infinity') ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
 paid:=COALESCE(b.plan<>'Free' AND b.plan_expires_at>t AND b.plan_checked_at>t-interval '1 hour',false);
 IF p_fixture_date IS NULL OR p_fixture_date<d-(CASE WHEN paid THEN 7 ELSE 1 END)
  OR p_fixture_date>d+(CASE WHEN paid THEN 7 ELSE 0 END) THEN RETURN false; END IF;
 IF b.request_day<>d THEN b.requests_used:=0; END IF;
 IF b.requests_used>=(CASE WHEN paid THEN 7000 ELSE 80 END)
  OR (NOT paid AND b.last_attempt_at>t-interval '7 seconds') THEN RETURN false; END IF;
 ttl:=CASE WHEN NOT paid THEN interval '20 minutes'
  WHEN p_fixture_date BETWEEN d-1 AND d+1 THEN interval '60 seconds' ELSE interval '1 hour' END;
 IF EXISTS(SELECT 1 FROM public.api_football_cache WHERE fixture_date=p_fixture_date AND last_attempt_at>t-ttl) THEN RETURN false; END IF;
 INSERT INTO public.api_football_cache(fixture_date,last_attempt_at) VALUES(p_fixture_date,t)
 ON CONFLICT(fixture_date) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at;
 UPDATE public.api_football_budget SET request_day=d,requests_used=b.requests_used+1,last_attempt_at=t WHERE singleton;
 RETURN true;
END;
$$;

CREATE FUNCTION public.reserve_api_football_detail(p_fixture_id bigint)
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

-- ONE live write path for both sources, with freshness and final-result locks.
CREATE FUNCTION public.update_match_live_provider(
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

CREATE OR REPLACE FUNCTION public.update_match_live_espn(p_match_id uuid,p_espn_id text,p_status text,p_home_score integer,p_away_score integer,p_elapsed integer,p_status_detail text DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.update_match_live_provider(p_match_id,'espn',p_espn_id,p_status,p_home_score,p_away_score,p_elapsed,p_status_detail,clock_timestamp(),
 CASE WHEN p_status_detail='STATUS_END_OF_REGULATION' THEN p_home_score END,
 CASE WHEN p_status_detail='STATUS_END_OF_REGULATION' THEN p_away_score END);
$$;
REVOKE ALL ON FUNCTION public.record_api_football_account(text,timestamptz,integer,integer),public.reserve_api_football_detail(bigint),public.update_match_live_provider(uuid,text,text,text,integer,integer,integer,text,timestamptz,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_api_football_account(text,timestamptz,integer,integer),public.reserve_api_football_detail(bigint),public.update_match_live_provider(uuid,text,text,text,integer,integer,integer,text,timestamptz,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_api_football_request(date),public.update_match_live_espn(uuid,text,text,integer,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_football_request(date),public.update_match_live_espn(uuid,text,text,integer,integer,integer,text) TO service_role;

CREATE TABLE public.api_football_teams (
 team_id bigint PRIMARY KEY CHECK(team_id>0), profile jsonb, squad jsonb,
 fetched_at timestamptz, last_attempt_at timestamptz NOT NULL
);
ALTER TABLE public.api_football_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_only ON public.api_football_teams FOR ALL TO public USING(false) WITH CHECK(false);
GRANT SELECT,INSERT,UPDATE ON public.api_football_teams TO service_role;
CREATE FUNCTION public.reserve_api_football_team(p_team_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t timestamptz:=clock_timestamp(); d date:=(t AT TIME ZONE 'UTC')::date; b public.api_football_budget%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
 IF NOT FOUND OR b.plan='Free' OR b.plan_expires_at IS NULL OR b.plan_expires_at<=t
  OR b.plan_checked_at IS NULL OR b.plan_checked_at<t-interval '1 hour' THEN RETURN false; END IF;
 IF b.request_day<>d THEN b.requests_used:=0; END IF;
 IF b.requests_used+2>6000 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.api_football_cache c CROSS JOIN LATERAL jsonb_array_elements(c.fixtures) f
  WHERE c.fixture_date BETWEEN d-7 AND d+7 AND (f->'teams'->'home'->>'id'=p_team_id::text OR f->'teams'->'away'->>'id'=p_team_id::text)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.api_football_teams WHERE team_id=p_team_id AND last_attempt_at>t-interval '24 hours') THEN RETURN false; END IF;
 INSERT INTO public.api_football_teams(team_id,last_attempt_at) VALUES(p_team_id,t)
 ON CONFLICT(team_id) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at;
 UPDATE public.api_football_budget SET request_day=d,requests_used=b.requests_used+2,last_attempt_at=t WHERE singleton;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_api_football_team(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_football_team(bigint) TO service_role;
