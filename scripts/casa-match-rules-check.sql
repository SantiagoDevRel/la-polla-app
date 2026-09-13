-- Local Docker only. All fresh fixtures roll back in this transaction.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
CREATE FUNCTION pg_temp.must_fail_match_rule(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    IF position(expected IN msg)=0 THEN RAISE EXCEPTION 'Expected %, got %',expected,msg; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %, but operation succeeded',expected;
END $$;

DO $$
DECLARE u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); mid uuid; good_mid uuid;
  e uuid; d jsonb; result jsonb; issue uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1998'||substr(replace(u::text,'-',''),1,10),'Reglas SQL local',true),
      (outsider,'+1988'||substr(replace(outsider::text,'-',''),1,10),'Sin permiso local',false);
  INSERT INTO auth.users(id) VALUES(u);
  mid:=public.upsert_match_safe('casa-rules-'||u,'local_casa_rules',1,'league','Home '||u,'Away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-'||p,'Reglas local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,mid,2,1);
  PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
  UPDATE public.casa_picks SET home_score=3 WHERE polla_id=p AND match_id=mid;
  ASSERT (SELECT home_score FROM public.casa_picks WHERE polla_id=p)=3;
  d:=public.casa_pick_distribution(p);
  ASSERT NOT (d->'marcador' ? mid::text), 'Upcoming picks leaked';
  RAISE NOTICE 'PASS later matches remain editable after closing entries; upcoming picks stay private';

  UPDATE public.matches SET scheduled_at=clock_timestamp()+interval '5 minutes' WHERE id=mid;
  PERFORM pg_temp.must_fail_match_rule(format('UPDATE public.casa_picks SET home_score=4 WHERE polla_id=%L',p),'5 minutos');
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '1 minute' WHERE id=mid;
  d:=public.casa_pick_distribution(p);
  ASSERT NOT (d->'marcador' ? mid::text), 'A scheduled but delayed match leaked picks';
  UPDATE public.matches SET status='live' WHERE id=mid;
  d:=public.casa_pick_distribution(p);
  ASSERT (d->'marcador'->mid::text->'conteo'->>'3-1')::integer=1, 'Started picks missing';
  PERFORM pg_temp.must_fail_match_rule(format('UPDATE public.casa_picks SET home_score=4 WHERE polla_id=%L',p),'5 minutos');
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions WHERE match_id=mid), 'Historical predictions must remain untouched';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=mid), 'A normal live match opened an issue';
  RAISE NOTICE 'PASS five-minute DB lock; delayed versus started privacy; historical model untouched';

  -- Migration 108: a suspension opens ONE issue and never voids by itself.
  UPDATE public.matches SET live_status_detail='STATUS_SUSPENDED',elapsed=15 WHERE id=mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1, 'Suspension did not open exactly one issue';
  SELECT id INTO issue FROM public.casa_match_issues WHERE match_id=mid AND kind='suspendido' AND decision IS NULL
    AND observed_status='live' AND observed_detail='STATUS_SUSPENDED' AND observed_elapsed=15;
  ASSERT issue IS NOT NULL, 'Open suspension issue missing or incomplete';
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Suspension voided automatically';
  ASSERT (SELECT final_verified_at IS NULL FROM public.matches WHERE id=mid), 'Issue must not finalize a global match';
  UPDATE public.matches SET elapsed=16 WHERE id=mid;
  UPDATE public.matches SET live_status_detail='SUSP',elapsed=17 WHERE id=mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1, 'Repeated ticks duplicated the issue';
  ASSERT (SELECT observed_elapsed=17 AND observed_detail='SUSP' FROM public.casa_match_issues WHERE id=issue), 'Tick did not refresh the observation';
  UPDATE public.matches SET live_status_detail='STATUS_SECOND_HALF',status='live',elapsed=50 WHERE id=mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1;
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Resumption voided the match';
  RAISE NOTICE 'PASS suspension opens one open issue, repeated ticks refresh it, nothing is voided';

  -- A different, correctly predicted game provides a real winner.
  good_mid:=public.upsert_match_safe('casa-good-'||u,'local_casa_rules',2,'league','Good home '||u,'Good away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,good_mid);
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,good_mid,2,1);
  PERFORM public.finalize_match_result(good_mid,2,1,'local Casa rule test');
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,u),'OPEN_MATCH_ISSUES');
  ASSERT (SELECT status='cerrada' FROM public.casa_pollas WHERE id=p) AND NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p);
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',issue,'borrar',u),'INVALID_DECISION');
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',gen_random_uuid(),'anular',u),'ISSUE_NOT_FOUND');
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',issue,'anular',outsider),'ADMIN_REQUIRED');
  RAISE NOTICE 'PASS settlement with an open issue fails with OPEN_MATCH_ISSUES; invalid decisions are rejected';

  result:=public.casa_decide_match_issue(issue,'anular',u,'  Suspendido por lluvia  ');
  ASSERT result->>'issue_id'=issue::text AND result->>'match_id'=mid::text AND result->>'decision'='anular'
    AND (result->>'voided_pollas')::integer=1, format('Unexpected decision result %s',result);
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Anular did not void';
  ASSERT (SELECT decision='anular' AND decided_by=u AND decided_at IS NOT NULL AND note='Suspendido por lluvia'
    FROM public.casa_match_issues WHERE id=issue), 'Decision metadata missing';
  ASSERT (SELECT points_earned FROM public.casa_picks WHERE polla_id=p AND match_id=mid)=0;
  PERFORM pg_temp.must_fail_match_rule(format('UPDATE public.casa_polla_matches SET voided_at=NULL WHERE polla_id=%L AND match_id=%L',p,mid),'anulado');
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',issue,'mantener',u),'ISSUE_ALREADY_DECIDED');
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',issue,'anular',u),'ISSUE_ALREADY_DECIDED');
  result:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT result->>'outcome'='money_awarded', 'Settlement kept waiting for a voided match';
  ASSERT (SELECT points FROM public.casa_payouts WHERE polla_id=p)=3;
  PERFORM public.finalize_match_result(mid,3,1,'local resumed fixture');
  ASSERT (SELECT points_earned FROM public.casa_picks WHERE polla_id=p AND match_id=mid)=0;
  ASSERT (SELECT points FROM public.casa_leaderboard(p))=3;
  RAISE NOTICE 'PASS anular voids with 0 points, deciding twice fails, settlement no longer waits for the voided match';
END $$;

-- Migration 108: every live writer opens issues for abandonment/cancellation; mantener keeps the match.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid; ab_mid uuid; espn_mid uuid; fd_mid uuid; good_mid uuid;
  result jsonb; mid uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1997'||substr(replace(u::text,'-',''),1,10),'Abandono SQL local',true);
  INSERT INTO auth.users(id) VALUES(u);
  ab_mid:=public.upsert_match_safe('casa-abd-'||u,'local_casa_rules',11,'league','Abd home '||u,'Abd away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  espn_mid:=public.upsert_match_safe('casa-espn-abd-'||u,'local_casa_rules',12,'league','Espn home '||u,'Espn away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  fd_mid:=public.upsert_match_safe('casa-fd-susp-'||u,'local_casa_rules',13,'league','Fd home '||u,'Fd away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  good_mid:=public.upsert_match_safe('casa-abd-good-'||u,'local_casa_rules',14,'league','Abd good home '||u,'Abd good away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-abd-'||p,'Abandono local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  FOREACH mid IN ARRAY ARRAY[ab_mid,espn_mid,fd_mid,good_mid] LOOP
    INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
    INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,mid,2,1);
  END LOOP;
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '70 minutes' WHERE id IN (ab_mid,espn_mid,fd_mid);

  -- API-Football ABD: status cancelled + STATUS_ABANDONED after 60 minutes.
  ASSERT public.update_match_live_provider(ab_mid,'api-football','af-'||u,'live',1,0,60,'STATUS_SECOND_HALF',clock_timestamp());
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=ab_mid), 'A live match opened an issue';
  ASSERT public.update_match_live_provider(ab_mid,'api-football','af-'||u,'cancelled',1,0,60,'STATUS_ABANDONED',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=ab_mid AND kind='abandonado' AND decision IS NULL
    AND observed_status='cancelled' AND observed_elapsed=60)=1, 'API-Football abandonment opened no issue';
  -- ESPN STATUS_ABANDONED, which may arrive with no minute.
  ASSERT public.update_match_live_espn(espn_mid,'espn-'||u,'live',0,0,55,'STATUS_SECOND_HALF');
  ASSERT public.update_match_live_espn(espn_mid,'espn-'||u,'cancelled',0,0,NULL,'STATUS_ABANDONED');
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=espn_mid AND kind='abandonado' AND decision IS NULL)=1, 'ESPN abandonment opened no issue';
  -- football-data SUSPENDED maps to cancelled with no detail.
  UPDATE public.matches SET status='live',elapsed=40 WHERE id=fd_mid;
  UPDATE public.matches SET status='cancelled',elapsed=NULL WHERE id=fd_mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=fd_mid AND kind='cancelado' AND decision IS NULL)=1, 'Cancelled with no detail opened no issue';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p AND voided_at IS NOT NULL), 'Something was voided automatically';
  ASSERT (SELECT count(*) FROM public.matches WHERE id IN (ab_mid,espn_mid,fd_mid) AND final_verified_at IS NULL AND status='cancelled')=3,
    'Issues must keep the global fixtures unfinalized and with the provider status';
  ASSERT NOT EXISTS(SELECT 1 FROM public.admin_alerts WHERE dedupe_key LIKE 'casa_match_void_pending:%'
    AND split_part(dedupe_key,':',2) IN (ab_mid::text,espn_mid::text,fd_mid::text)), 'The 107 void alert is still opened';
  RAISE NOTICE 'PASS abandonment (API-Football ABD, ESPN) and cancellation (football-data) open issues and void nothing';

  PERFORM public.finalize_match_result(good_mid,2,1,'local Casa abandonment test');
  PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,u),'OPEN_MATCH_ISSUES');
  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=ab_mid),'anular',u,NULL);
  ASSERT (result->>'voided_pollas')::integer=1;
  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=fd_mid),'anular',u,NULL);
  ASSERT (result->>'voided_pollas')::integer=1;
  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=espn_mid),'mantener',u,'Se reprograma');
  ASSERT result->>'decision'='mantener' AND (result->>'voided_pollas')::integer=0;
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=espn_mid), 'Mantener voided the match';
  ASSERT (SELECT decision='mantener' AND decided_by=u AND note='Se reprograma' FROM public.casa_match_issues WHERE match_id=espn_mid);
  -- The kept match is still part of the pool: settlement waits for its verified result.
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,u),'UNVERIFIED_MATCHES');
  PERFORM public.finalize_match_result(espn_mid,2,1,'local kept fixture');
  result:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT result->>'outcome'='money_awarded', 'Settlement failed after all decisions';
  ASSERT (SELECT points FROM public.casa_payouts WHERE polla_id=p)=6, 'Kept match was not scored normally';
  ASSERT (SELECT sum(points_earned) FROM public.casa_picks WHERE polla_id=p AND match_id IN (ab_mid,fd_mid))=0;
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions WHERE match_id IN (ab_mid,espn_mid,fd_mid,good_mid));
  RAISE NOTICE 'PASS mantener keeps the match and scores it normally; anular gives 0; settlement proceeds after decisions';
END $$;

-- Migration 108: no start evidence needed; postponed + rescheduled keeps picks and does not reopen issues.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid; canc_mid uuid; late_mid uuid; resched_mid uuid; link_mid uuid;
  mid uuid; result jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1996'||substr(replace(u::text,'-',''),1,10),'Aplazado SQL local',true);
  INSERT INTO auth.users(id) VALUES(u);
  canc_mid:=public.upsert_match_safe('casa-canc-'||u,'local_casa_rules',21,'league','Canc home '||u,'Canc away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  late_mid:=public.upsert_match_safe('casa-late-'||u,'local_casa_rules',22,'league','Late home '||u,'Late away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  resched_mid:=public.upsert_match_safe('casa-resched-'||u,'local_casa_rules',23,'league','Resched home '||u,'Resched away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-prestart-'||p,'Antes de iniciar local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  FOREACH mid IN ARRAY ARRAY[canc_mid,late_mid,resched_mid] LOOP
    INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  END LOOP;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,canc_mid,1,1),(p,e,u,late_mid,1,1);

  ASSERT public.update_match_live_provider(canc_mid,'api-football','af-c-'||u,'cancelled',NULL,NULL,NULL,'STATUS_CANCELED',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=canc_mid AND kind='cancelado' AND decision IS NULL)=1, 'Cancellation before kickoff opened no issue';
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=canc_mid), 'Cancellation before kickoff was voided';
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '10 minutes' WHERE id=canc_mid;
  ASSERT public.update_match_live_provider(canc_mid,'api-football','af-c-'||u,'cancelled',NULL,NULL,0,'STATUS_ABANDONED',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=canc_mid)=2
    AND EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=canc_mid AND kind='abandonado'), 'A different kind did not open its own issue';
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '10 minutes' WHERE id=late_mid;
  UPDATE public.matches SET status='cancelled' WHERE id=late_mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=late_mid AND kind='cancelado')=1, 'Delayed then cancelled opened no issue';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p AND voided_at IS NOT NULL), 'Pre-start states were voided';
  RAISE NOTICE 'PASS cancelled/abandoned with no start evidence opens issues and voids nothing';

  UPDATE public.matches SET status='cancelled',live_status_detail='STATUS_POSTPONED' WHERE id=resched_mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=resched_mid AND kind='aplazado' AND decision IS NULL)=1, 'Postponement opened no issue';
  UPDATE public.matches SET status='scheduled',scheduled_at=clock_timestamp()+interval '3 days' WHERE id=resched_mid;
  ASSERT (SELECT status='cancelled' FROM public.matches WHERE id=resched_mid), 'Fixture baseline changed: cancelled no longer sticks after rescheduling';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=resched_mid)=1;
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=resched_mid);
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,resched_mid,0,2);
  UPDATE public.casa_picks SET home_score=1 WHERE polla_id=p AND match_id=resched_mid;
  ASSERT (SELECT home_score FROM public.casa_picks WHERE polla_id=p AND match_id=resched_mid)=1;
  UPDATE public.matches SET scheduled_at=clock_timestamp()+interval '5 minutes' WHERE id=resched_mid;
  PERFORM pg_temp.must_fail_match_rule(format('UPDATE public.casa_picks SET home_score=2 WHERE polla_id=%L AND match_id=%L',p,resched_mid),'5 minutos');
  UPDATE public.matches SET scheduled_at=clock_timestamp()+interval '3 days',elapsed=30 WHERE id=resched_mid;
  PERFORM pg_temp.must_fail_match_rule(format('UPDATE public.casa_picks SET home_score=2 WHERE polla_id=%L AND match_id=%L',p,resched_mid),'5 minutos');
  ASSERT (SELECT home_score FROM public.casa_picks WHERE polla_id=p AND match_id=resched_mid)=1;
  RAISE NOTICE 'PASS postponed and rescheduled match accepts picks; five-minute lock and start evidence still close it';

  -- Mantener a postponement, then the provider reports the new kickoff: the
  -- no-regress trigger keeps status cancelled, but no second issue opens, the
  -- match can go live, be verified and the pool settles.
  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=resched_mid),'mantener',u,NULL);
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '1 minute',elapsed=NULL WHERE id=resched_mid;
  ASSERT public.update_match_live_provider(resched_mid,'api-football','af-r-'||u,'scheduled',NULL,NULL,NULL,'STATUS_SCHEDULED',clock_timestamp());
  ASSERT (SELECT status='cancelled' AND live_status_detail='STATUS_SCHEDULED' FROM public.matches WHERE id=resched_mid), 'Rescheduled baseline changed';
  ASSERT public.casa_match_issue_kind('cancelled','STATUS_SCHEDULED') IS NULL;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=resched_mid)=1, 'Rescheduled kickoff reopened an issue';
  ASSERT public.update_match_live_provider(resched_mid,'api-football','af-r-'||u,'live',1,2,10,'STATUS_FIRST_HALF',clock_timestamp());
  ASSERT (SELECT status='live' FROM public.matches WHERE id=resched_mid), 'A kept postponed match cannot go live';
  PERFORM public.finalize_match_result(resched_mid,1,2,'local kept postponement');
  ASSERT (SELECT points_earned FROM public.casa_picks WHERE polla_id=p AND match_id=resched_mid)=3, 'Kept postponement was not scored';
  PERFORM public.casa_decide_match_issue(id,'anular',u,NULL) FROM public.casa_match_issues
    WHERE match_id IN (canc_mid,late_mid) AND decision IS NULL ORDER BY id;
  PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
  result:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT result->>'outcome'='money_awarded' AND (result->>'top_points')::integer=3, format('Kept postponement blocked settlement: %s',result);
  RAISE NOTICE 'PASS mantener on a postponed match: new kickoff opens no second issue, it plays, verifies and settles';

  -- A match outside Casa opens nothing; linking it to a pool opens its issue.
  link_mid:=public.upsert_match_safe('casa-link-'||u,'local_casa_rules',24,'league','Link home '||u,'Link away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  UPDATE public.matches SET status='cancelled',live_status_detail='STATUS_POSTPONED' WHERE id=link_mid;
  UPDATE public.matches SET live_status_detail='STATUS_SUSPENDED',elapsed=20 WHERE id=link_mid;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=link_mid), 'A match outside Casa opened an issue';
  p:=gen_random_uuid();
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-link-'||p,'Enlace local','partidos','local_casa_rules','marcador','borrador',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,link_mid);
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=link_mid AND kind='suspendido' AND decision IS NULL)=1,
    'Linking a suspended match opened no issue';
  RAISE NOTICE 'PASS matches outside Casa open no issue; linking an interrupted match opens it';
END $$;

-- Migration 108: the global live update never depends on the Casa mode.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid; mid uuid; issue uuid; result jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1995'||substr(replace(u::text,'-',''),1,10),'Pausa SQL local',true);
  INSERT INTO auth.users(id) VALUES(u);
  mid:=public.upsert_match_safe('casa-paused-'||u,'local_casa_rules',31,'league','Paused home '||u,'Paused away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-paused-'||p,'Pausa local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,mid,2,1);
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '30 minutes' WHERE id=mid;
  ASSERT public.update_match_live_provider(mid,'api-football','af-p-'||u,'live',0,0,20,'STATUS_FIRST_HALF',clock_timestamp());

  PERFORM public.casa_transition_mode('v2','paused');
  ASSERT public.update_match_live_provider(mid,'api-football','af-p-'||u,'live',0,0,20,'STATUS_SUSPENDED',clock_timestamp()),
    'Paused Casa rejected a global live observation';
  ASSERT (SELECT live_status_detail='STATUS_SUSPENDED' AND elapsed=20 FROM public.matches WHERE id=mid), 'Global live data was not stored';
  ASSERT public.update_match_live_provider(mid,'api-football','af-p-'||u,'live',0,0,21,'STATUS_SUSPENDED',clock_timestamp());
  SELECT id INTO issue FROM public.casa_match_issues WHERE match_id=mid AND kind='suspendido' AND decision IS NULL AND observed_elapsed=21;
  ASSERT issue IS NOT NULL AND (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1, 'Paused Casa lost or duplicated the issue';
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Casa was voided while paused';
  ASSERT NOT EXISTS(SELECT 1 FROM public.admin_alerts WHERE dedupe_key='casa_match_void_pending:'||mid), 'The 107 void alert is still opened';
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',issue,'anular',u),'OPERATIONS_PAUSED');
  ASSERT (SELECT decision IS NULL FROM public.casa_match_issues WHERE id=issue);
  PERFORM public.casa_transition_mode('paused','v2');
  PERFORM public.casa_v2_context(2);
  result:=public.casa_decide_match_issue(issue,'anular',u,NULL);
  ASSERT (result->>'voided_pollas')::integer=1 AND
    (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Decision after resuming v2 did not void';
  RAISE NOTICE 'PASS paused Casa keeps the global live update and the issue; decisions wait for v2';
END $$;

-- Migration 108: a Casa failure never aborts the global update; frozen pools are skipped by anular.
DO $$
DECLARE u uuid:=gen_random_uuid(); ok_p uuid:=gen_random_uuid(); frozen_p uuid:=gen_random_uuid(); e uuid; mid uuid; fail_mid uuid;
  pid uuid; result jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1994'||substr(replace(u::text,'-',''),1,10),'Fallo SQL local',true);
  INSERT INTO auth.users(id) VALUES(u);
  mid:=public.upsert_match_safe('casa-frozen-'||u,'local_casa_rules',41,'league','Frozen home '||u,'Frozen away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  fail_mid:=public.upsert_match_safe('casa-fail-'||u,'local_casa_rules',42,'league','Fail home '||u,'Fail away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  FOREACH pid IN ARRAY ARRAY[ok_p,frozen_p] LOOP
    INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
      VALUES(pid,'rules-fail-'||pid,'Fallo local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
    INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(pid,mid),(pid,fail_mid);
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(pid,u,'pagada',10000) RETURNING id INTO e;
    INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(pid,e,u,mid,2,1);
  END LOOP;
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '50 minutes',status='live',elapsed=45 WHERE id IN (mid,fail_mid);

  CREATE FUNCTION pg_temp.casa_rules_forced_failure() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'forced local failure'; END $f$;
  CREATE TRIGGER zz_casa_rules_forced_failure BEFORE INSERT ON public.casa_match_issues
    FOR EACH ROW EXECUTE FUNCTION pg_temp.casa_rules_forced_failure();
  ASSERT public.update_match_live_provider(fail_mid,'api-football','af-f-'||u,'cancelled',0,0,45,'STATUS_ABANDONED',clock_timestamp());
  DROP TRIGGER zz_casa_rules_forced_failure ON public.casa_match_issues;
  ASSERT (SELECT status='cancelled' AND live_status_detail='STATUS_ABANDONED' FROM public.matches WHERE id=fail_mid), 'Global update was aborted by a Casa failure';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=fail_mid);
  RAISE NOTICE 'PASS a failing issue write never blocks the global match update';

  PERFORM public.casa_change_status_v2(frozen_p,'anular',2,u,NULL);
  ASSERT public.update_match_live_provider(mid,'api-football','af-z-'||u,'live',0,0,46,'STATUS_INTERRUPTED',clock_timestamp());
  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=mid AND kind='suspendido'),'anular',u,NULL);
  ASSERT (result->>'voided_pollas')::integer=1 AND (result->>'skipped_pollas')::integer=1, format('Unexpected frozen result %s',result);
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=ok_p AND match_id=mid), 'Active pool was not voided';
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=frozen_p AND match_id=mid), 'Frozen pool was written';
  RAISE NOTICE 'PASS anular skips frozen pools without failing and counts them';
END $$;

-- Migration 108: a kept match that is suspended again reopens; anular closes the
-- match for good; lost registrations are recovered by the sweep and by settlement.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid();
  e uuid; mid uuid; good_mid uuid; lost_mid uuid; void_mid uuid; stale_mid uuid;
  first_issue uuid; second_issue uuid; stale_issue uuid; result jsonb; n integer;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1993'||substr(replace(u::text,'-',''),1,10),'Reapertura SQL local',true);
  INSERT INTO auth.users(id) VALUES(u);
  mid:=public.upsert_match_safe('casa-reopen-'||u,'local_casa_rules',51,'league','Reopen home '||u,'Reopen away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  good_mid:=public.upsert_match_safe('casa-rgood-'||u,'local_casa_rules',52,'league','Rgood home '||u,'Rgood away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  lost_mid:=public.upsert_match_safe('casa-lost-'||u,'local_casa_rules',53,'league','Lost home '||u,'Lost away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  void_mid:=public.upsert_match_safe('casa-void2-'||u,'local_casa_rules',54,'league','Void home '||u,'Void away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-reopen-'||p,'Reapertura local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  FOREACH n IN ARRAY ARRAY[1,2,3,4] LOOP
    INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,(ARRAY[mid,good_mid,lost_mid,void_mid])[n]);
    INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score)
      VALUES(p,e,u,(ARRAY[mid,good_mid,lost_mid,void_mid])[n],2,1);
  END LOOP;
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '50 minutes',status='live',elapsed=30 WHERE id IN (mid,lost_mid,void_mid);

  -- Suspend, repeated ticks, mantener, still suspended, resume, suspend again.
  ASSERT public.update_match_live_provider(mid,'api-football','af-re-'||u,'live',0,0,30,'STATUS_SUSPENDED',clock_timestamp());
  SELECT id INTO first_issue FROM public.casa_match_issues WHERE match_id=mid AND kind='suspendido' AND decision IS NULL;
  ASSERT first_issue IS NOT NULL, 'Suspension opened no issue';
  ASSERT public.update_match_live_provider(mid,'api-football','af-re-'||u,'live',0,0,31,'STATUS_SUSPENDED',clock_timestamp());
  UPDATE public.matches SET elapsed=32 WHERE id=mid;
  UPDATE public.matches SET live_status_detail='SUSP' WHERE id=mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1, 'Ticks without a transition duplicated the issue';
  ASSERT (SELECT observed_elapsed=32 AND observed_detail='SUSP' FROM public.casa_match_issues WHERE id=first_issue), 'Tick did not refresh the open issue';
  result:=public.casa_decide_match_issue(first_issue,'mantener',u,'Se reanuda');
  ASSERT result->>'decision'='mantener';
  UPDATE public.matches SET elapsed=33 WHERE id=mid;
  ASSERT public.update_match_live_provider(mid,'api-football','af-re-'||u,'live',0,0,34,'STATUS_SUSPENDED',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1
    AND NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=mid AND decision IS NULL), 'A tick after mantener reopened the issue without a transition';
  ASSERT (SELECT observed_elapsed FROM public.casa_match_issues WHERE id=first_issue)=32, 'A decided issue was refreshed';
  ASSERT public.update_match_live_provider(mid,'api-football','af-re-'||u,'live',0,0,50,'STATUS_SECOND_HALF',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=1, 'Resuming opened an issue';
  ASSERT public.update_match_live_provider(mid,'api-football','af-re-'||u,'live',0,0,60,'STATUS_SUSPENDED',clock_timestamp());
  SELECT id INTO second_issue FROM public.casa_match_issues WHERE match_id=mid AND kind='suspendido' AND decision IS NULL;
  ASSERT second_issue IS NOT NULL AND second_issue<>first_issue, 'Suspending a kept match again opened no new issue';
  ASSERT (SELECT observed_elapsed FROM public.casa_match_issues WHERE id=second_issue)=60;
  ASSERT public.update_match_live_provider(mid,'api-football','af-re-'||u,'live',0,0,61,'STATUS_SUSPENDED',clock_timestamp());
  UPDATE public.matches SET live_status_detail='STATUS_INTERRUPTED' WHERE id=mid;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=2
    AND (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid AND decision IS NULL)=1, 'Repeated ticks on the reopened issue duplicated it';
  ASSERT (SELECT decision='mantener' FROM public.casa_match_issues WHERE id=first_issue), 'The earlier decision changed';
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_decide_match_issue(%L,%L,%L)',first_issue,'anular',u),'ISSUE_ALREADY_DECIDED');
  PERFORM public.finalize_match_result(good_mid,2,1,'local reopen test');
  PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,u),'OPEN_MATCH_ISSUES');
  RAISE NOTICE 'PASS suspend -> mantener -> resume -> suspend again opens a new issue; settlement waits with OPEN_MATCH_ISSUES; ticks never duplicate';

  -- Anular, then the match is suspended/abandoned again, even inside another active pool: nothing opens.
  ASSERT public.update_match_live_provider(void_mid,'api-football','af-va-'||u,'live',0,0,30,'STATUS_SUSPENDED',clock_timestamp());
  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=void_mid AND decision IS NULL),'anular',u,NULL);
  ASSERT (result->>'voided_pollas')::integer=1;
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p2,'rules-reopen-p2-'||p2,'Reapertura local 2','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p2,void_mid);
  ASSERT public.casa_match_in_active_polla(void_mid), 'Fixture: the voided match must be active through the new pool';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=void_mid)=1, 'Linking an annulled suspended match reopened it';
  ASSERT public.update_match_live_provider(void_mid,'api-football','af-va-'||u,'live',0,0,50,'STATUS_SECOND_HALF',clock_timestamp());
  ASSERT public.update_match_live_provider(void_mid,'api-football','af-va-'||u,'live',0,0,55,'STATUS_SUSPENDED',clock_timestamp());
  ASSERT public.update_match_live_provider(void_mid,'api-football','af-va-'||u,'cancelled',0,0,55,'STATUS_ABANDONED',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=void_mid)=1, 'An annulled match opened a new issue';
  PERFORM public.casa_sweep_match_issues();
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=void_mid)=1, 'The sweep reopened an annulled match';
  RAISE NOTICE 'PASS after anular no transition, link or sweep opens a new issue for that match';

  -- A lost registration: the insert fails inside the trigger and later ticks have no transition.
  CREATE FUNCTION pg_temp.casa_rules_lost_issue() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'forced lost registration'; END $f$;
  CREATE TRIGGER zz_casa_rules_lost_issue BEFORE INSERT ON public.casa_match_issues
    FOR EACH ROW EXECUTE FUNCTION pg_temp.casa_rules_lost_issue();
  ASSERT public.update_match_live_provider(lost_mid,'api-football','af-lost-'||u,'live',0,0,40,'STATUS_SUSPENDED',clock_timestamp());
  DROP TRIGGER zz_casa_rules_lost_issue ON public.casa_match_issues;
  ASSERT (SELECT live_status_detail='STATUS_SUSPENDED' FROM public.matches WHERE id=lost_mid), 'Global update was aborted';
  ASSERT public.update_match_live_provider(lost_mid,'api-football','af-lost-'||u,'live',0,0,41,'STATUS_SUSPENDED',clock_timestamp());
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=lost_mid), 'Fixture: the registration must be lost';
  -- Settlement sweeps first: without it this would fail later with UNVERIFIED_MATCHES.
  result:=public.casa_decide_match_issue(second_issue,'mantener',u,NULL);
  -- Linking a match whose current state was already decided does not reopen it.
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p2,mid);
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=2
    AND NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=mid AND decision IS NULL), 'Linking a kept suspended match reopened it';
  PERFORM public.finalize_match_result(mid,2,1,'local reopen kept');
  PERFORM pg_temp.must_fail_match_rule(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,u),'OPEN_MATCH_ISSUES');
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=lost_mid), 'Issues swept by a failed settlement roll back with it';
  n:=public.casa_sweep_match_issues();
  ASSERT n>=1 AND (SELECT count(*) FROM public.casa_match_issues WHERE match_id=lost_mid AND kind='suspendido' AND decision IS NULL
    AND observed_status='live' AND observed_detail='STATUS_SUSPENDED' AND observed_elapsed=41)=1, format('Sweep did not recover the lost issue (%s)',n);
  n:=public.casa_sweep_match_issues();
  ASSERT n=0 AND (SELECT count(*) FROM public.casa_match_issues WHERE match_id=lost_mid)=1, format('Sweep is not idempotent (%s)',n);
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=mid)=2, 'Sweep reopened a state already decided as mantener';
  RAISE NOTICE 'PASS a lost registration is recovered by casa_sweep_match_issues and settlement sweeps before OPEN_MATCH_ISSUES';

  result:=public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=lost_mid AND decision IS NULL),'mantener',u,NULL);
  PERFORM public.finalize_match_result(lost_mid,2,1,'local lost kept');
  result:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT result->>'outcome'='money_awarded' AND (result->>'top_points')::integer=9, format('Settlement after recovered issues: %s',result);

  -- Open issues whose pools are no longer active are not counted.
  stale_mid:=public.upsert_match_safe('casa-stale-'||u,'local_casa_rules',55,'league','Stale home '||u,'Stale away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p3,'rules-stale-'||p3,'Inactiva local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p3,stale_mid);
  UPDATE public.matches SET status='live',elapsed=10 WHERE id=stale_mid;
  UPDATE public.matches SET live_status_detail='STATUS_SUSPENDED' WHERE id=stale_mid;
  SELECT id INTO stale_issue FROM public.casa_match_issues WHERE match_id=stale_mid AND decision IS NULL;
  ASSERT stale_issue IN (SELECT issue_id FROM public.casa_active_open_match_issue_ids()), 'Active open issue missing from the count';
  ASSERT first_issue NOT IN (SELECT issue_id FROM public.casa_active_open_match_issue_ids()), 'A decided issue was counted';
  PERFORM public.casa_change_status_v2(p3,'anular',2,u,NULL);
  ASSERT stale_issue NOT IN (SELECT issue_id FROM public.casa_active_open_match_issue_ids()), 'An issue of an annulled pool was counted';
  ASSERT (SELECT decision IS NULL FROM public.casa_match_issues WHERE id=stale_issue), 'Annulling the pool decided the issue';
  RAISE NOTICE 'PASS the admin count only includes open issues of active Casa pools';
END $$;

-- Migration 108: privileges.
DO $$
DECLARE denied boolean:=false;
BEGIN
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.casa_decide_match_issue(uuid,text,uuid,text)'::regprocedure)
    ='{postgres=X/postgres,service_role=X/postgres}', 'casa_decide_match_issue ACL is not service_role only';
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.casa_settle_polla_v2(uuid,integer,uuid,bigint)'::regprocedure)
    ='{postgres=X/postgres,service_role=X/postgres}', 'casa_settle_polla_v2 ACL changed';
  ASSERT NOT has_function_privilege('anon','public.casa_decide_match_issue(uuid,text,uuid,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_decide_match_issue(uuid,text,uuid,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_decide_match_issue(uuid,text,uuid,text)','EXECUTE');
  ASSERT NOT has_table_privilege('anon','public.casa_match_issues','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.casa_match_issues','SELECT');
  ASSERT NOT has_table_privilege('service_role','public.casa_match_issues','INSERT,UPDATE,DELETE');
  ASSERT has_table_privilege('service_role','public.casa_match_issues','SELECT');
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.casa_match_issues'::regclass);
  ASSERT (SELECT 'lock_timeout=2s'=ANY(proconfig) FROM pg_proc WHERE oid='public.casa_register_match_issue(uuid,text,text,integer,text)'::regprocedure),
    'Issue registration must bound lock waits: statement_timeout (57014) escapes WHEN OTHERS';
  ASSERT to_regprocedure('public.casa_register_match_issue(uuid,text,text,integer)') IS NULL, 'The four-argument registration still exists';
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.casa_sweep_match_issues()'::regprocedure)
    ='{postgres=X/postgres,service_role=X/postgres}', 'casa_sweep_match_issues ACL is not service_role only';
  ASSERT (SELECT prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig) FROM pg_proc WHERE oid='public.casa_sweep_match_issues()'::regprocedure),
    'casa_sweep_match_issues must be SECURITY DEFINER with a fixed search_path';
  ASSERT NOT has_function_privilege('anon','public.casa_sweep_match_issues()','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_sweep_match_issues()','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_sweep_match_issues()','EXECUTE');
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.casa_active_open_match_issue_ids()'::regprocedure)
    ='{postgres=X/postgres,service_role=X/postgres}', 'casa_active_open_match_issue_ids ACL is not service_role only';
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.casa_match_in_active_polla(uuid)'::regprocedure)
    ='{postgres=X/postgres,service_role=X/postgres}', 'casa_match_in_active_polla ACL is not service_role only';
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.casa_register_match_issue(uuid,text,text,integer,text)'::regprocedure)
    ='{postgres=X/postgres,service_role=X/postgres}', 'casa_register_match_issue ACL is not service_role only';
  ASSERT NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.casa_match_issues'::regclass AND contype='u'),
    'A full UNIQUE constraint would block reopening a kept match';
  ASSERT (SELECT indisunique AND pg_get_expr(indpred,indrelid)='(decision IS NULL)' FROM pg_index
    WHERE indexrelid='public.casa_match_issues_one_open_idx'::regclass), 'One-open-issue partial unique index missing';
  ASSERT (SELECT prosrc LIKE '%casa_sweep_match_issues()%OPEN_MATCH_ISSUES%' FROM pg_proc
    WHERE oid='public.casa_settle_polla_v2(uuid,integer,uuid,bigint)'::regprocedure), 'Settlement must sweep before OPEN_MATCH_ISSUES';
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.casa_sweep_match_issues();
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  ASSERT denied, 'authenticated can run casa_sweep_match_issues';
  denied:=false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.casa_sweep_match_issues();
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  ASSERT denied, 'anon can run casa_sweep_match_issues';
  denied:=false;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.casa_match_issues;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  ASSERT denied, 'authenticated can read casa_match_issues';
  denied:=false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.casa_match_issues;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  ASSERT denied, 'anon can read casa_match_issues';
  ASSERT current_user='postgres', 'Role was not restored';
  RAISE NOTICE 'PASS decision RPC is service_role only; issues table is unreadable for authenticated and anon';
END $$;
ROLLBACK;
