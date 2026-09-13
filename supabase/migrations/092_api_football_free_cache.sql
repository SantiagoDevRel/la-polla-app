-- Shared free-tier quota. A reservation counts even when the HTTP request fails.
CREATE TABLE public.api_football_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  request_day date NOT NULL,
  requests_used integer NOT NULL DEFAULT 0 CHECK (requests_used >= 0),
  last_attempt_at timestamptz NOT NULL
);
CREATE TABLE public.api_football_cache (
  fixture_date date PRIMARY KEY,
  fixtures jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fixtures) = 'array'),
  fetched_at timestamptz,
  last_attempt_at timestamptz NOT NULL
);
ALTER TABLE public.api_football_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_football_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_only ON public.api_football_budget FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY service_only ON public.api_football_cache FOR ALL TO public USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE ON public.api_football_budget, public.api_football_cache TO service_role;

CREATE FUNCTION public.reserve_api_football_request(p_fixture_date date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t timestamptz := clock_timestamp();
  d date := (t AT TIME ZONE 'UTC')::date;
  b public.api_football_budget%ROWTYPE;
BEGIN
  -- Free current-data window. Never request a whole season.
  IF p_fixture_date IS NULL OR p_fixture_date < d - 1 OR p_fixture_date > d THEN RETURN false; END IF;
  INSERT INTO public.api_football_budget(singleton, request_day, last_attempt_at)
    VALUES (true, d, '-infinity') ON CONFLICT DO NOTHING;
  SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
  IF b.request_day <> d THEN b.requests_used := 0; END IF;
  -- 20 requests remain available for dashboard/manual use; no HTTP retries.
  IF b.requests_used >= 80 OR b.last_attempt_at > t - interval '7 seconds' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.api_football_cache WHERE fixture_date = p_fixture_date
             AND last_attempt_at > t - interval '20 minutes') THEN RETURN false; END IF;
  INSERT INTO public.api_football_cache(fixture_date,last_attempt_at) VALUES(p_fixture_date,t)
    ON CONFLICT(fixture_date) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at;
  UPDATE public.api_football_budget SET request_day=d, requests_used=b.requests_used+1,
    last_attempt_at=t WHERE singleton;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_api_football_request(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_football_request(date) TO service_role;

-- Lock before writing extras/finalizing: concurrent cron ticks cannot change
-- an already verified result, and scoring sees the extras in the same transaction.
CREATE FUNCTION public.finalize_api_football_result(
  p_match_id uuid, p_home_score integer, p_away_score integer, p_notes text,
  p_fulltime_home integer DEFAULT NULL, p_fulltime_away integer DEFAULT NULL,
  p_penalty_home integer DEFAULT NULL, p_penalty_away integer DEFAULT NULL,
  p_advancer text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE verified timestamptz;
BEGIN
  SELECT final_verified_at INTO verified FROM public.matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR verified IS NOT NULL THEN RETURN false; END IF;
  IF p_home_score IS NULL OR p_away_score IS NULL OR p_home_score < 0 OR p_away_score < 0
    OR (p_fulltime_home IS NULL) <> (p_fulltime_away IS NULL)
    OR (p_penalty_home IS NULL) <> (p_penalty_away IS NULL)
    OR p_fulltime_home < 0 OR p_fulltime_away < 0 OR p_penalty_home < 0 OR p_penalty_away < 0
    OR (p_advancer IS NOT NULL AND p_advancer NOT IN ('home','away')) THEN
    RAISE EXCEPTION 'Invalid final result';
  END IF;
  IF p_fulltime_home IS NOT NULL THEN
    UPDATE public.matches SET fulltime_home_score=p_fulltime_home, fulltime_away_score=p_fulltime_away,
      penalty_home=p_penalty_home, penalty_away=p_penalty_away,
      advancer=COALESCE(p_advancer, advancer) WHERE id=p_match_id;
  END IF;
  RETURN public.finalize_match_result(p_match_id,p_home_score,p_away_score,p_notes);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_api_football_result(uuid,integer,integer,text,integer,integer,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_api_football_result(uuid,integer,integer,text,integer,integer,integer,integer,text) TO service_role;
