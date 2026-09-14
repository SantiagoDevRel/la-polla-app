-- Casa only. Two additions to the match issues of migration 108:
--
-- 1) "Sin datos del proveedor" (kind sin_datos). A match of an active Casa pool
--    whose kickoff passed and that still has no provider data (status still
--    scheduled, no problem state, not verified) opens an issue in /admin/issues,
--    with or without an apifootball: identity. Confirmed kickoff: 30 minutes
--    after it. Provisional kickoff (scheduled_at_confirmed=false is a date at
--    midnight UTC, migration 103): 30 hours after it, so a match with an
--    unknown hour is never reported before its day is over. The administrator
--    enters the 90-minute result (finalize_verified_match_result), voids it
--    (anular) or keeps waiting (mantener). An open sin_datos issue closes by
--    itself (decision 'resuelto') when the match gets provider data, is
--    verified or gets a new kickoff that has not come due.
-- 2) E-mail outbox. Every newly opened issue (any kind) is claimed once by the
--    minute cron, e-mailed through Resend and marked notified.
--
-- Installing this migration writes no match, pick, entry, prediction, pool or
-- settlement rows and opens no issue. The only rows it touches are the
-- existing issues, marked as already notified (notified_at set, attempts 0) so
-- the sender never e-mails history. Detection starts with the first sweep after
-- installation: /admin/issues load, settlement, or the minute cron once the
-- code is deployed. Kept verbatim from 108: every problem-state rule,
-- casa_register_match_issue, the matches and link triggers, casa_decide_match_issue,
-- casa_settle_polla_v2 and casa_active_open_match_issue_ids.

-- 1) Table. kind/decision constraints were created inline by 108, so their
--    names are deterministic; a different name aborts the migration.
ALTER TABLE public.casa_match_issues
  DROP CONSTRAINT casa_match_issues_kind_check,
  DROP CONSTRAINT casa_match_issues_decision_check,
  ADD COLUMN observed_scheduled_at timestamptz,
  ADD COLUMN notified_at timestamptz,
  ADD COLUMN notify_claimed_at timestamptz,
  ADD COLUMN notify_claim_token uuid,
  ADD COLUMN notify_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN notify_last_error text;
ALTER TABLE public.casa_match_issues
  ADD CONSTRAINT casa_match_issues_kind_check
    CHECK (kind IN ('suspendido','aplazado','cancelado','abandonado','sin_datos')),
  -- 'resuelto' closes a sin_datos issue without a void/keep decision: provider
  -- data arrived, the result was verified or entered by an administrator.
  ADD CONSTRAINT casa_match_issues_decision_check
    CHECK (decision IN ('anular','mantener','resuelto')),
  ADD CONSTRAINT casa_match_issues_resuelto_only_sin_datos
    CHECK (decision IS DISTINCT FROM 'resuelto' OR kind='sin_datos'),
  ADD CONSTRAINT casa_match_issues_sin_datos_kickoff
    CHECK (kind<>'sin_datos' OR observed_scheduled_at IS NOT NULL),
  ADD CONSTRAINT casa_match_issues_notify_attempts_check
    CHECK (notify_attempts BETWEEN 0 AND 8),
  -- Error codes only (e.g. resend_rate_limit_exceeded_429): never a provider
  -- message, which can contain the recipient address.
  ADD CONSTRAINT casa_match_issues_notify_error_code
    CHECK (notify_last_error IS NULL OR notify_last_error ~ '^[a-z0-9_.:-]{1,64}$');
COMMENT ON COLUMN public.casa_match_issues.observed_scheduled_at IS 'sin_datos: kickoff that came due without provider data. Another sin_datos issue for the same kickoff never opens.';
COMMENT ON COLUMN public.casa_match_issues.notified_at IS 'E-mail accepted by Resend. Rows that existed when migration 121 was installed carry notified_at with notify_attempts=0 (history, never e-mailed).';
COMMENT ON COLUMN public.casa_match_issues.notify_claim_token IS 'Current e-mail claim. Only the holder can finish it; a claim older than its backoff can be taken again.';
COMMENT ON COLUMN public.casa_match_issues.notify_last_error IS 'Last e-mail error code, no message and no personal data.';
CREATE INDEX casa_match_issues_notify_pending_idx ON public.casa_match_issues (first_seen_at,id)
  WHERE notified_at IS NULL AND decision IS NULL;

-- History is not e-mailed.
UPDATE public.casa_match_issues SET notified_at=now() WHERE notified_at IS NULL;

-- 2) Classification. A match is still waiting for its start when its state is not
--    a problem (108) and its status is scheduled, or cancelled while the provider
--    already reports STATUS_SCHEDULED (a rescheduled fixture kept cancelled by
--    matches_prevent_status_regress, see 108).
CREATE FUNCTION public.casa_match_awaiting_start(p_status text, p_detail text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT public.casa_match_issue_kind(p_status,p_detail) IS NULL
    AND (lower(btrim(coalesce(p_status,'')))='scheduled'
      OR (lower(btrim(coalesce(p_status,'')))='cancelled' AND upper(btrim(coalesce(p_detail,'')))='STATUS_SCHEDULED'));
$$;
REVOKE ALL ON FUNCTION public.casa_match_awaiting_start(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_match_awaiting_start(text,text) TO service_role;

-- Detection, auto-close and the e-mail claim share this one definition.
CREATE FUNCTION public.casa_match_sin_datos_due(p_status text, p_detail text, p_scheduled_at timestamptz,
  p_confirmed boolean, p_final_verified_at timestamptz, p_now timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT p_final_verified_at IS NULL AND p_scheduled_at IS NOT NULL AND p_now IS NOT NULL
    AND public.casa_match_awaiting_start(p_status,p_detail)
    AND p_now >= p_scheduled_at + CASE WHEN p_confirmed IS FALSE THEN interval '30 hours' ELSE interval '30 minutes' END;
$$;
REVOKE ALL ON FUNCTION public.casa_match_sin_datos_due(text,text,timestamptz,boolean,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_match_sin_datos_due(text,text,timestamptz,boolean,timestamptz,timestamptz) TO service_role;

-- 3) Registration. Returns the id of a newly opened issue, NULL otherwise. Reads
--    the match without locking it, so it never waits for or blocks a match
--    write. An open sin_datos issue only refreshes its observation when the
--    kickoff was corrected while still overdue. Nothing new opens after an
--    'anular' decision (108) or when a sin_datos issue for this same kickoff
--    already exists (open, kept or resolved); a new kickoff that comes due
--    again without data opens a new one. lock_timeout as in 108.
CREATE FUNCTION public.casa_register_sin_datos_issue(p_match_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
DECLARE m record; v_open public.casa_match_issues; v_id uuid;
BEGIN
  SELECT mt.id,mt.status,mt.live_status_detail,mt.elapsed,mt.scheduled_at,mt.scheduled_at_confirmed,mt.final_verified_at
    INTO m FROM public.matches mt WHERE mt.id=p_match_id;
  IF NOT FOUND
    OR NOT public.casa_match_sin_datos_due(m.status,m.live_status_detail,m.scheduled_at,m.scheduled_at_confirmed,m.final_verified_at,now())
    OR NOT public.casa_match_in_active_polla(p_match_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_open FROM public.casa_match_issues
    WHERE match_id=p_match_id AND kind='sin_datos' AND decision IS NULL FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    IF v_open.observed_scheduled_at IS DISTINCT FROM m.scheduled_at THEN
      UPDATE public.casa_match_issues SET last_seen_at=now(),observed_status=m.status,observed_detail=m.live_status_detail,
          observed_elapsed=m.elapsed,observed_scheduled_at=m.scheduled_at
        WHERE id=v_open.id;
    END IF;
    RETURN NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=p_match_id
    AND (decision='anular' OR (kind='sin_datos' AND observed_scheduled_at=m.scheduled_at))) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.casa_match_issues(match_id,kind,observed_status,observed_detail,observed_elapsed,observed_scheduled_at)
    VALUES(p_match_id,'sin_datos',m.status,m.live_status_detail,m.elapsed,m.scheduled_at)
    ON CONFLICT (match_id,kind) WHERE decision IS NULL DO NOTHING
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.casa_register_sin_datos_issue(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_register_sin_datos_issue(uuid) TO service_role;

-- Closes open sin_datos issues whose match is no longer due, whatever pool it is
-- in. Never waits: rows locked by a decision or a manual result are skipped and
-- retried on the next sweep. Returns how many it closed.
CREATE FUNCTION public.casa_close_stale_sin_datos_issues() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
DECLARE v_closed integer;
BEGIN
  WITH stale AS (
    SELECT i.id,
      CASE
        WHEN mt.final_verified_at IS NOT NULL THEN 'Se cerró solo: el resultado quedó verificado.'
        WHEN NOT public.casa_match_awaiting_start(mt.status,mt.live_status_detail) THEN 'Se cerró solo: llegaron datos del proveedor.'
        ELSE 'Se cerró solo: el partido tiene una nueva hora de inicio.'
      END AS reason
    FROM public.casa_match_issues i
    JOIN public.matches mt ON mt.id=i.match_id
    WHERE i.kind='sin_datos' AND i.decision IS NULL
      AND NOT public.casa_match_sin_datos_due(mt.status,mt.live_status_detail,mt.scheduled_at,mt.scheduled_at_confirmed,mt.final_verified_at,now())
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.casa_match_issues i SET decision='resuelto',decided_by=NULL,decided_at=clock_timestamp(),note=stale.reason
    FROM stale WHERE i.id=stale.id;
  GET DIAGNOSTICS v_closed=ROW_COUNT;
  RETURN v_closed;
END $$;
REVOKE ALL ON FUNCTION public.casa_close_stale_sin_datos_issues() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_close_stale_sin_datos_issues() TO service_role;

-- 4) Sweep. The first loop is the 108 body, verbatim. Then it closes stale
--    sin_datos issues and opens the due ones. Still called by /admin/issues and
--    at the start of casa_settle_polla_v2 (unchanged), and now every minute by
--    /api/matches/sync-live. Returns how many issues it opened (any kind). One
--    failing match or step never stops the rest.
CREATE OR REPLACE FUNCTION public.casa_sweep_match_issues() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m record; v_id uuid; v_created integer:=0;
BEGIN
  FOR m IN
    SELECT x.id,x.status,x.live_status_detail,x.elapsed
    FROM (SELECT DISTINCT mt.id,mt.status,mt.live_status_detail,mt.elapsed,
            public.casa_match_issue_kind(mt.status,mt.live_status_detail) AS kind
          FROM public.casa_polla_matches pm
          JOIN public.casa_pollas p ON p.id=pm.polla_id
          JOIN public.matches mt ON mt.id=pm.match_id
          WHERE pm.voided_at IS NULL AND p.archived_at IS NULL AND p.status IN ('borrador','abierta','cerrada')
            AND mt.final_verified_at IS NULL) x
    WHERE x.kind IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.casa_match_issues i WHERE i.match_id=x.id
        AND (i.decision='anular' OR i.kind=x.kind))
    ORDER BY x.id
  LOOP
    BEGIN
      v_id:=public.casa_register_match_issue(m.id,m.status,m.live_status_detail,m.elapsed,'recover');
      IF v_id IS NOT NULL THEN v_created:=v_created+1; END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    PERFORM public.casa_close_stale_sin_datos_issues();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  FOR m IN
    SELECT DISTINCT mt.id
    FROM public.casa_polla_matches pm
    JOIN public.casa_pollas p ON p.id=pm.polla_id
    JOIN public.matches mt ON mt.id=pm.match_id
    WHERE pm.voided_at IS NULL AND p.archived_at IS NULL AND p.status IN ('borrador','abierta','cerrada')
      AND mt.final_verified_at IS NULL
      AND public.casa_match_sin_datos_due(mt.status,mt.live_status_detail,mt.scheduled_at,mt.scheduled_at_confirmed,mt.final_verified_at,now())
      AND NOT EXISTS(SELECT 1 FROM public.casa_match_issues i WHERE i.match_id=mt.id
        AND (i.decision='anular' OR (i.kind='sin_datos' AND i.observed_scheduled_at=mt.scheduled_at)))
    ORDER BY mt.id
  LOOP
    BEGIN
      v_id:=public.casa_register_sin_datos_issue(m.id);
      IF v_id IS NOT NULL THEN v_created:=v_created+1; END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN v_created;
END $$;
REVOKE ALL ON FUNCTION public.casa_sweep_match_issues() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_sweep_match_issues() TO service_role;

-- 5) Manual 90-minute result for a sin_datos issue, from /admin/issues. Same
--    guarantees as the manual path of /admin/discrepancias: administrator only,
--    whole non-negative goals, the match row lock and scoring transaction of
--    finalize_verified_match_result, and a conflict (not an overwrite) when the
--    match was already verified. The issue is locked first and closed in the
--    same transaction; a failure changes nothing. Decisions wait for Casa v2
--    exactly like casa_decide_match_issue.
CREATE FUNCTION public.casa_resolve_sin_datos_with_result(p_issue uuid, p_home integer, p_away integer, p_admin uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.casa_match_issues; v_name text; v_at text;
BEGIN
  PERFORM public.casa_v2_context(2);
  PERFORM public.casa_v2_admin(p_admin,NULL);
  IF p_home IS NULL OR p_away IS NULL OR p_home NOT BETWEEN 0 AND 99 OR p_away NOT BETWEEN 0 AND 99 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_SCORE';
  END IF;
  SELECT * INTO i FROM public.casa_match_issues WHERE id=p_issue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ISSUE_NOT_FOUND'; END IF;
  IF i.decision IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ISSUE_ALREADY_DECIDED'; END IF;
  IF i.kind<>'sin_datos' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ISSUE_RESULT_NOT_ALLOWED'; END IF;
  SELECT display_name INTO v_name FROM public.users WHERE id=p_admin;
  v_at:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  IF public.finalize_verified_match_result(i.match_id,p_home,p_away,
      format('manual override por %s (%s) via /admin/issues source=manual caso=%s at=%s',
        coalesce(nullif(btrim(v_name),''),'admin'),p_admin,i.id,v_at)) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MATCH_ALREADY_VERIFIED';
  END IF;
  UPDATE public.casa_match_issues SET decision='resuelto',decided_by=p_admin,decided_at=clock_timestamp(),
      note=format('Resultado manual de los 90 minutos: %s-%s.',p_home,p_away)
    WHERE id=i.id;
  RETURN jsonb_build_object('issue_id',i.id,'match_id',i.match_id,'decision','resuelto','home',p_home,'away',p_away);
END $$;
REVOKE ALL ON FUNCTION public.casa_resolve_sin_datos_with_result(uuid,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_resolve_sin_datos_with_result(uuid,integer,integer,uuid) TO service_role;

-- 6) E-mail outbox. The claim takes at most p_limit (1-10) open, not notified
--    issues of an active Casa pool, oldest first, with FOR UPDATE SKIP LOCKED:
--    concurrent claims never return the same issue. Each claim counts one
--    attempt and gets a new token. An unfinished or failed claim can be taken
--    again after max(5, 2^attempts) minutes, capped at 60; after 8 attempts the
--    issue stops being e-mailed (notify_last_error keeps the code). A sin_datos
--    issue that is no longer due is left for the sweep to close.
CREATE FUNCTION public.casa_claim_match_issue_notifications(p_limit integer DEFAULT 10)
RETURNS TABLE(issue_id uuid, claim_token uuid, kind text, observed_elapsed integer, first_seen_at timestamptz,
  match_id uuid, home_team text, away_team text, tournament text, scheduled_at timestamptz,
  scheduled_at_confirmed boolean, polla_names text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LIMIT';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT i.id FROM public.casa_match_issues i
    WHERE i.decision IS NULL AND i.notified_at IS NULL AND i.notify_attempts<8
      AND (i.notify_claimed_at IS NULL
        OR i.notify_claimed_at<=now()-make_interval(mins=>least(60,greatest(5,(2^i.notify_attempts)::integer))))
      AND public.casa_match_in_active_polla(i.match_id)
      AND (i.kind<>'sin_datos' OR EXISTS(SELECT 1 FROM public.matches mt WHERE mt.id=i.match_id
        AND public.casa_match_sin_datos_due(mt.status,mt.live_status_detail,mt.scheduled_at,mt.scheduled_at_confirmed,mt.final_verified_at,now())))
    ORDER BY i.first_seen_at,i.id
    LIMIT p_limit
    FOR UPDATE OF i SKIP LOCKED
  ), claimed AS (
    UPDATE public.casa_match_issues i
       SET notify_claimed_at=now(),notify_claim_token=gen_random_uuid(),notify_attempts=i.notify_attempts+1
      FROM picked WHERE i.id=picked.id
    RETURNING i.id,i.notify_claim_token,i.kind,i.observed_elapsed,i.first_seen_at,i.match_id
  )
  SELECT c.id,c.notify_claim_token,c.kind,c.observed_elapsed,c.first_seen_at,c.match_id,
    mt.home_team::text,mt.away_team::text,mt.tournament::text,mt.scheduled_at,mt.scheduled_at_confirmed,
    coalesce((SELECT array_agg(DISTINCT p.name::text ORDER BY p.name::text)
      FROM public.casa_polla_matches pm JOIN public.casa_pollas p ON p.id=pm.polla_id
      WHERE pm.match_id=c.match_id AND pm.voided_at IS NULL AND p.archived_at IS NULL
        AND p.status IN ('borrador','abierta','cerrada')
        AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws d WHERE d.polla_id=p.id)),'{}'::text[])
  FROM claimed c JOIN public.matches mt ON mt.id=c.match_id
  ORDER BY c.first_seen_at,c.id;
END $$;
REVOKE ALL ON FUNCTION public.casa_claim_match_issue_notifications(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_claim_match_issue_notifications(integer) TO service_role;

-- Finishes a claim held by p_claim_token: 'sent' marks it notified, 'failed'
-- keeps the attempt and records an error code, 'released' gives the attempt back
-- (the cron ran out of time before sending). A stale token changes nothing.
CREATE FUNCTION public.casa_finish_match_issue_notification(p_issue uuid, p_claim_token uuid, p_outcome text, p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent','failed','released') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OUTCOME';
  END IF;
  IF p_outcome='failed' AND (p_error IS NULL OR p_error !~ '^[a-z0-9_.:-]{1,64}$') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_ERROR_CODE';
  END IF;
  UPDATE public.casa_match_issues SET
      notified_at=CASE WHEN p_outcome='sent' THEN clock_timestamp() END,
      notify_last_error=CASE p_outcome WHEN 'sent' THEN NULL WHEN 'failed' THEN p_error ELSE notify_last_error END,
      notify_attempts=CASE WHEN p_outcome='released' THEN greatest(notify_attempts-1,0) ELSE notify_attempts END,
      notify_claimed_at=CASE WHEN p_outcome='released' THEN NULL ELSE notify_claimed_at END,
      notify_claim_token=NULL
    WHERE id=p_issue AND p_claim_token IS NOT NULL AND notify_claim_token=p_claim_token AND notified_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.casa_finish_match_issue_notification(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_finish_match_issue_notification(uuid,uuid,text,text) TO service_role;
