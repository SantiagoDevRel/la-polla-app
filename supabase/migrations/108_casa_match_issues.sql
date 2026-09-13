-- Casa only. Nothing is voided automatically any more: a suspended, interrupted,
-- postponed, cancelled or abandoned match inside a non-final Casa pool opens a
-- "match issue", and an administrator decides in /admin/issues whether to
-- void it (0 points in every non-final Casa pool) or keep it.
--
-- Installing this migration never changes predictions, fixtures, money,
-- settlements or existing voided_at values. The only rows it writes are open
-- issues for matches that are in one of those states today (backfill = sweep).
-- Kept from 106/107: casa_polla_matches.voided_at and its preservation trigger,
-- the pick guard for postponed + rescheduled fixtures, the fixed-prize house
-- balance and the POLLA_NOT_PUBLISHED close guard.

-- 1) Issues table. Service role reads it; writes only through the functions
--    below (SECURITY DEFINER), so a decision always runs its guards.
CREATE TABLE public.casa_match_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('suspendido','aplazado','cancelado','abandonado')),
  observed_status text,
  observed_detail text,
  observed_elapsed int,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  decision text CHECK (decision IN ('anular','mantener')),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  note text
);
COMMENT ON TABLE public.casa_match_issues IS 'Casa: match observed suspended/interrupted, postponed, cancelled or abandoned while in a non-final Casa pool. An administrator decides anular (void, 0 points) or mantener. Nothing is voided without a decision.';
-- At most ONE open issue per match and kind. Decided issues stay as history, so
-- a match kept (mantener) that falls into the same state again opens a new one.
CREATE UNIQUE INDEX casa_match_issues_one_open_idx ON public.casa_match_issues (match_id,kind) WHERE decision IS NULL;
CREATE INDEX casa_match_issues_match_idx ON public.casa_match_issues (match_id);
ALTER TABLE public.casa_match_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY casa_match_issues_deny ON public.casa_match_issues
  FOR ALL TO anon,authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.casa_match_issues FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.casa_match_issues TO service_role;

-- 2) Classification, shared by the trigger, the pool-link trigger and the backfill.
--    A row kept as 'cancelled' by matches_prevent_status_regress while the
--    provider already reports STATUS_SCHEDULED is a rescheduled fixture, not a
--    new cancellation, so it does not open a second issue.
CREATE FUNCTION public.casa_match_issue_kind(p_status text, p_detail text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT CASE
    WHEN d IN ('STATUS_SUSPENDED','SUSPENDED','SUSP','STATUS_INTERRUPTED','INTERRUPTED','INT') THEN 'suspendido'
    WHEN d IN ('STATUS_POSTPONED','POSTPONED','PST') THEN 'aplazado'
    WHEN d IN ('STATUS_ABANDONED','ABANDONED','ABD') THEN 'abandonado'
    WHEN d IN ('STATUS_CANCELED','STATUS_CANCELLED','CANCELED','CANCELLED','CANC') THEN 'cancelado'
    WHEN s='CANCELLED' AND d<>'STATUS_SCHEDULED' THEN 'cancelado'
  END
  FROM (SELECT upper(btrim(coalesce(p_detail,''))) AS d, upper(btrim(coalesce(p_status,''))) AS s) x;
$$;
REVOKE ALL ON FUNCTION public.casa_match_issue_kind(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_match_issue_kind(text,text) TO service_role;

-- A match is "in an active Casa pool" when a link that is not voided belongs to
-- a pool that is not archived, has status borrador/abierta/cerrada and has no
-- object draw. Shared by registration, the sweep and the admin count, so the
-- three agree on which issues matter.
CREATE FUNCTION public.casa_match_in_active_polla(p_match_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.casa_polla_matches pm JOIN public.casa_pollas p ON p.id=pm.polla_id
    WHERE pm.match_id=p_match_id AND pm.voided_at IS NULL AND p.archived_at IS NULL
      AND p.status IN ('borrador','abierta','cerrada')
      AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws d WHERE d.polla_id=p.id));
$$;
REVOKE ALL ON FUNCTION public.casa_match_in_active_polla(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_match_in_active_polla(uuid) TO service_role;

-- Records one observation. An open issue of the same kind only refreshes its
-- observation, in every mode. When there is none, p_mode decides:
--   'refresh'    (matches trigger, no state transition): open nothing.
--   'transition' (matches trigger, the match just entered this state): open a
--                new issue, even after an earlier 'mantener' of the same kind.
--   'recover'    (pool link, sweep, backfill: no transition to go by): open only
--                if no issue of this kind was ever decided for the match.
-- A match with an 'anular' decision is already void in Casa: nothing new opens.
-- Never waits for a decision in progress: a locked open issue is skipped and
-- the partial unique index keeps the insert from duplicating it.
-- lock_timeout (restored on exit) turns any other lock wait into 55P03, which
-- the triggers and the sweep swallow. Without it a wait would end in
-- statement_timeout (57014, 8s under PostgREST), which WHEN OTHERS does not
-- catch, and the global matches UPDATE would abort.
CREATE FUNCTION public.casa_register_match_issue(p_match_id uuid, p_status text, p_detail text, p_elapsed integer, p_mode text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
DECLARE v_kind text:=public.casa_match_issue_kind(p_status,p_detail); v_id uuid;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('refresh','transition','recover') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_ISSUE_MODE';
  END IF;
  IF v_kind IS NULL OR NOT public.casa_match_in_active_polla(p_match_id) THEN
    RETURN NULL;
  END IF;
  UPDATE public.casa_match_issues SET last_seen_at=now(),observed_status=p_status,
      observed_detail=p_detail,observed_elapsed=p_elapsed
    WHERE id=(SELECT id FROM public.casa_match_issues
      WHERE match_id=p_match_id AND kind=v_kind AND decision IS NULL FOR UPDATE SKIP LOCKED)
    RETURNING id INTO v_id;
  IF v_id IS NOT NULL OR p_mode='refresh' THEN
    RETURN v_id;
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=p_match_id AND decision='anular') THEN
    RETURN NULL;
  END IF;
  IF p_mode='recover' AND EXISTS(SELECT 1 FROM public.casa_match_issues
    WHERE match_id=p_match_id AND kind=v_kind AND decision IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.casa_match_issues(match_id,kind,observed_status,observed_detail,observed_elapsed)
    VALUES(p_match_id,v_kind,p_status,p_detail,p_elapsed)
    ON CONFLICT (match_id,kind) WHERE decision IS NULL DO NOTHING
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.casa_register_match_issue(uuid,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_register_match_issue(uuid,text,text,integer,text) TO service_role;

-- 3) The existing trigger casa_void_on_suspension keeps its name (created in
--    106) but no longer voids, scores or opens admin alerts. A new issue opens
--    only on a TRANSITION into a problem state (OLD classified differently or
--    not at all); repeated ticks in the same state only refresh the open issue.
--    Any Casa failure is swallowed: the global matches UPDATE never fails
--    because of Casa, in any operation mode (legacy, paused or v2). A lost
--    registration is recovered by casa_sweep_match_issues (section 4).
CREATE OR REPLACE FUNCTION public.casa_void_suspended_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_new text; v_old text;
BEGIN
  BEGIN
    IF NEW.final_verified_at IS NULL THEN
      v_new:=public.casa_match_issue_kind(NEW.status,NEW.live_status_detail);
      IF v_new IS NOT NULL THEN
        v_old:=public.casa_match_issue_kind(OLD.status,OLD.live_status_detail);
        PERFORM public.casa_register_match_issue(NEW.id,NEW.status,NEW.live_status_detail,NEW.elapsed,
          CASE WHEN v_old IS DISTINCT FROM v_new THEN 'transition' ELSE 'refresh' END);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.casa_void_suspended_match() IS 'Historical name (106). Since 108 it only records casa_match_issues; voiding requires casa_decide_match_issue.';
REVOKE ALL ON FUNCTION public.casa_void_suspended_match() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_void_suspended_match() TO service_role;

-- A match that is already in one of those states when it is linked to a pool
-- opens its issue too, unless that state was already decided ('recover' mode).
-- Linking a match never fails because of this.
CREATE FUNCTION public.casa_register_match_issue_on_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m record;
BEGIN
  BEGIN
    SELECT id,status,live_status_detail,elapsed,final_verified_at INTO m FROM public.matches WHERE id=NEW.match_id;
    IF FOUND AND m.final_verified_at IS NULL THEN
      PERFORM public.casa_register_match_issue(m.id,m.status,m.live_status_detail,m.elapsed,'recover');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_register_match_issue_on_link() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_register_match_issue_on_link() TO service_role;
CREATE TRIGGER casa_register_issue_on_link AFTER INSERT ON public.casa_polla_matches
  FOR EACH ROW EXECUTE FUNCTION public.casa_register_match_issue_on_link();

-- 4) Sweep (idempotent): recovers registrations lost to a swallowed error or a
--    lock_timeout. For every unverified match of an active Casa pool whose
--    current state is a problem, with no open issue of that kind, no decided
--    issue of that kind and no 'anular' decision, it opens the issue. Returns
--    how many open issues it created. One failing match never stops the rest.
--    Called by the backfill below, at the start of casa_settle_polla_v2 and when
--    /admin/issues loads.
CREATE FUNCTION public.casa_sweep_match_issues() RETURNS integer
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
  RETURN v_created;
END $$;
REVOKE ALL ON FUNCTION public.casa_sweep_match_issues() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_sweep_match_issues() TO service_role;

-- Backfill: open issues for matches in those states today.
SELECT public.casa_sweep_match_issues();

-- 5) Administrative decision. 'anular' voids the match in every non-final Casa
--    pool that contains it (parent lock before child, like settlement) and
--    rescores that pool. Settled, voided, archived or draw-pending pools are
--    skipped and counted; they never fail the decision. 'mantener' only records.
CREATE FUNCTION public.casa_decide_match_issue(p_issue uuid, p_decision text, p_admin uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.casa_match_issues; p public.casa_pollas; v_polla uuid; v_voided integer:=0; v_skipped integer:=0;
BEGIN
  PERFORM public.casa_v2_context(2);
  PERFORM public.casa_v2_admin(p_admin,NULL);
  IF p_decision IS NULL OR p_decision NOT IN ('anular','mantener') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_DECISION';
  END IF;
  SELECT * INTO i FROM public.casa_match_issues WHERE id=p_issue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ISSUE_NOT_FOUND'; END IF;
  IF i.decision IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ISSUE_ALREADY_DECIDED'; END IF;

  IF p_decision='anular' THEN
    FOR v_polla IN
      SELECT pm.polla_id FROM public.casa_polla_matches pm
      WHERE pm.match_id=i.match_id AND pm.voided_at IS NULL ORDER BY pm.polla_id
    LOOP
      SELECT * INTO p FROM public.casa_pollas WHERE id=v_polla FOR UPDATE;
      IF NOT FOUND OR p.archived_at IS NOT NULL OR p.status NOT IN ('borrador','abierta','cerrada')
        OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=v_polla) THEN
        v_skipped:=v_skipped+1;
        CONTINUE;
      END IF;
      UPDATE public.casa_polla_matches SET voided_at=clock_timestamp()
        WHERE polla_id=v_polla AND match_id=i.match_id AND voided_at IS NULL;
      IF FOUND THEN
        v_voided:=v_voided+1;
        PERFORM public.casa_score_polla(v_polla);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.casa_match_issues SET decision=p_decision,decided_by=p_admin,decided_at=clock_timestamp(),
    note=nullif(btrim(p_note),'')
  WHERE id=i.id;
  RETURN jsonb_build_object('issue_id',i.id,'match_id',i.match_id,'decision',p_decision,
    'voided_pollas',v_voided,'skipped_pollas',v_skipped);
END $$;
REVOKE ALL ON FUNCTION public.casa_decide_match_issue(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_decide_match_issue(uuid,text,uuid,text) TO service_role;

-- 6) Settlement waits for every open issue of a match still active in the pool.
--    Body copied verbatim from the installed definition (after 106/107); the
--    only additions are the sweep (so a lost registration can never let a pool
--    pay with an undecided problem match) and the OPEN_MATCH_ISSUES check after
--    the lock and the idempotent draw/already-settled answers. When settlement
--    then fails, the issues the sweep opened roll back with it; /admin/issues
--    runs the same sweep on load and persists them.
CREATE OR REPLACE FUNCTION public.casa_settle_polla_v2(p_polla_id uuid, p_contract integer, p_actor_id uuid DEFAULT NULL::uuid, p_chat_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p public.casa_pollas; d public.casa_object_draws; v_prize bigint; v_paid integer;
  v_top integer; v_winners integer; v_each bigint:=0; v_remainder bigint:=0; v_outcome text; v_user uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  PERFORM public.casa_sweep_match_issues();
  p := public.casa_v2_lock_polla(p_polla_id,true);
  IF p.status<>'cerrada' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CLOSE_FIRST'; END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE polla_id=p.id;
  IF FOUND THEN
    IF d.state<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED'; END IF;
    RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
      'draw_id',d.id,'prize_cop',0,'winners',0,'each_cop',0,'top_points',d.top_points);
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_match_issues mi JOIN public.casa_polla_matches pm ON pm.match_id=mi.match_id
    WHERE pm.polla_id=p.id AND pm.voided_at IS NULL AND mi.decision IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPEN_MATCH_ISSUES',DETAIL='Hay partidos con novedades sin decidir.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_entries e LEFT JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id
    WHERE e.polla_id=p.id AND e.status='pendiente' AND
      (e.proof_path IS NOT NULL OR (a.state='uploading' AND a.expires_at>clock_timestamp()))) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PENDING_PROOFS',DETAIL='Revisa los comprobantes pendientes y espera las cargas en curso.';
  END IF;
  SELECT paid_entries,prize_cop INTO v_paid,v_prize FROM public.casa_pot_summaries_v2(ARRAY[p.id]);
  IF v_paid=0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES',DETAIL='Esta polla no tiene inscripciones pagadas.'; END IF;
  IF p.kind='partidos' AND EXISTS(SELECT 1 FROM public.casa_polla_matches pm JOIN public.matches m ON m.id=pm.match_id
    WHERE pm.polla_id=p.id AND m.final_verified_at IS NULL AND pm.voided_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNVERIFIED_MATCHES',DETAIL='Faltan partidos por verificar.';
  END IF;
  IF p.kind='manual' AND EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id AND resolved_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNRESOLVED_QUESTIONS',DETAIL='Faltan preguntas por resolver.';
  END IF;
  IF p.prize_kind='objeto' AND nullif(btrim(p.prize_object),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_REQUIRED';
  END IF;
  IF p.kind='rifa' THEN
    IF p.drawn_number IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_NUMBER_REQUIRED'; END IF;
    SELECT user_id INTO v_user FROM public.casa_entries WHERE polla_id=p.id AND status='pagada' AND ticket_number=p.drawn_number;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNSOLD_TICKET',DETAIL='La boleta sorteada no está pagada. No se ha adjudicado el premio.'; END IF;
    v_winners:=1;
  ELSE
    PERFORM public.casa_score_polla(p.id);
    SELECT max(points) INTO v_top FROM public.casa_leaderboard(p.id);
    IF v_top IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES'; END IF;
    IF v_top=0 THEN
      UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,
        settled_chat_id=p_chat_id,settlement_outcome='house_retained_zero_points',settlement_prize_cop=v_prize WHERE id=p.id;
      RETURN jsonb_build_object('contract',2,'outcome','house_retained_zero_points','polla_id',p.id,'status','resuelta',
        'prize_cop',0,'retained_prize_cop',v_prize,'winners',0,'each_cop',0,'top_points',0);
    END IF;
    IF v_top<0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POINTS'; END IF;
    SELECT count(*) INTO v_winners FROM public.casa_leaderboard(p.id) WHERE points=v_top;
    IF p.prize_kind='objeto' AND v_winners>1 THEN
      INSERT INTO public.casa_object_draws(polla_id,prize_object,top_points)
        VALUES(p.id,p.prize_object,v_top) RETURNING * INTO d;
      INSERT INTO public.casa_object_draw_candidates(draw_id,user_id,points,ticket)
        SELECT d.id,user_id,points,row_number() OVER(ORDER BY user_id)::integer
        FROM public.casa_leaderboard(p.id) WHERE points=v_top;
      RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
        'draw_id',d.id,'prize_cop',0,'winners',0,'candidates',v_winners,'each_cop',0,'top_points',v_top);
    END IF;
  END IF;
  v_each:=v_prize/v_winners;
  v_remainder:=v_prize-v_each*v_winners;
  v_outcome:=CASE WHEN p.prize_kind='objeto' THEN 'object_awarded' ELSE 'money_awarded' END;
  IF p.kind='rifa' THEN
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      VALUES(p.id,v_user,1,NULL,v_prize,'Boleta '||p.drawn_number||' — '||p.draw_method,p.prize_kind,
        CASE WHEN p.prize_kind='objeto' THEN p.prize_object END);
  ELSE
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      SELECT p.id,user_id,1,points,v_each+CASE WHEN n<=v_remainder THEN 1 ELSE 0 END,
        CASE WHEN v_winners>1 THEN 'Empate en '||v_top||' puntos' END,p.prize_kind,
        CASE WHEN p.prize_kind='objeto' THEN p.prize_object END
      FROM (SELECT user_id,points,row_number() OVER(ORDER BY user_id) n FROM public.casa_leaderboard(p.id) WHERE points=v_top) winners;
  END IF;
  UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,settled_chat_id=p_chat_id,
    settlement_outcome=v_outcome,settlement_prize_cop=v_prize WHERE id=p.id;
  RETURN jsonb_build_object('contract',2,'outcome',v_outcome,'polla_id',p.id,'status','resuelta',
    'prize_cop',v_prize,'winners',v_winners,'each_cop',v_each,'remainder',v_remainder,'top_points',v_top);
END $function$;
REVOKE ALL ON FUNCTION public.casa_settle_polla_v2(uuid,integer,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_settle_polla_v2(uuid,integer,uuid,bigint) TO service_role;

-- 7) Open issues that still matter: at least one active Casa pool contains the
--    match (same definition as registration). /admin/pollas counts these and
--    /admin/issues lists them first; the rest stay visible apart, since they no
--    longer block any settlement.
CREATE FUNCTION public.casa_active_open_match_issue_ids() RETURNS TABLE(issue_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT i.id FROM public.casa_match_issues i
  WHERE i.decision IS NULL AND public.casa_match_in_active_polla(i.match_id)
  ORDER BY i.first_seen_at,i.id;
$$;
REVOKE ALL ON FUNCTION public.casa_active_open_match_issue_ids() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_active_open_match_issue_ids() TO service_role;
