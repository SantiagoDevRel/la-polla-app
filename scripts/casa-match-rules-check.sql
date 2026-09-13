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
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); mid uuid; good_mid uuid; delayed_mid uuid; e uuid; d jsonb; result jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1998'||substr(replace(u::text,'-',''),1,10),'Reglas SQL local',true);
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
  RAISE NOTICE 'PASS five-minute DB lock; delayed versus started privacy; historical model untouched';

  UPDATE public.matches SET live_status_detail='STATUS_SUSPENDED',elapsed=15 WHERE id=mid;
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Suspended match was not voided';
  ASSERT (SELECT points FROM public.casa_leaderboard(p))=0;
  ASSERT (SELECT final_verified_at IS NULL FROM public.matches WHERE id=mid), 'Void must not finalize a global match';
  PERFORM pg_temp.must_fail_match_rule(format('UPDATE public.casa_polla_matches SET voided_at=NULL WHERE polla_id=%L AND match_id=%L',p,mid),'anulado');
  UPDATE public.matches SET live_status_detail='STATUS_SECOND_HALF',status='live',elapsed=50 WHERE id=mid;
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Resumption reactivated a voided match';

  -- A different, correctly predicted game provides a real winner. The voided
  -- match stays unverified; it must not prevent settlement.
  good_mid:=public.upsert_match_safe('casa-good-'||u,'local_casa_rules',2,'league','Good home '||u,'Good away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,good_mid);
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,good_mid,2,1);
  PERFORM public.finalize_match_result(good_mid,2,1,'local Casa rule test');
  result:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT result->>'outcome'='money_awarded';
  ASSERT (SELECT points FROM public.casa_payouts WHERE polla_id=p)=3;
  PERFORM public.finalize_match_result(mid,3,1,'local resumed fixture');
  ASSERT (SELECT points_earned FROM public.casa_picks WHERE polla_id=p AND match_id=mid)=0;
  ASSERT (SELECT points FROM public.casa_leaderboard(p))=3;
  RAISE NOTICE 'PASS permanent Casa suspension, zero points after resumption, settlement without finalizing voided match';

  p:=gen_random_uuid();
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'rules-delayed-'||p,'Aplazado local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  delayed_mid:=public.upsert_match_safe('casa-delay-'||u,'local_casa_rules',3,'league','Delay home '||u,'Delay away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,delayed_mid);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,delayed_mid,6,4);
  UPDATE public.matches SET status='cancelled',live_status_detail='STATUS_POSTPONED' WHERE id=delayed_mid;
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p), 'Pre-match postponement was voided';
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '1 minute',status='live',live_status_detail='STATUS_SUSPENDED',elapsed=0 WHERE id=delayed_mid;
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p), 'Unknown start was assumed from suspension status';
  d:=public.casa_pick_distribution(p);
  ASSERT NOT (d->'marcador' ? delayed_mid::text), 'Suspension with no start evidence leaked picks';
  RAISE NOTICE 'PASS postponed/unknown-start matches stay intact';
END $$;

-- Migration 107: abandonment after kickoff voids through every live writer.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid; ab_mid uuid; espn_mid uuid; fd_mid uuid; good_mid uuid;
  result jsonb; mid uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1997'||substr(replace(u::text,'-',''),1,10),'Abandono SQL local',true);
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
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=ab_mid), 'A live match was voided';
  ASSERT public.update_match_live_provider(ab_mid,'api-football','af-'||u,'cancelled',1,0,60,'STATUS_ABANDONED',clock_timestamp());
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=ab_mid), 'API-Football abandonment was not voided';
  -- ESPN STATUS_ABANDONED, which may arrive with no minute: the previous minute proves the start.
  ASSERT public.update_match_live_espn(espn_mid,'espn-'||u,'live',0,0,55,'STATUS_SECOND_HALF');
  ASSERT public.update_match_live_espn(espn_mid,'espn-'||u,'cancelled',0,0,NULL,'STATUS_ABANDONED');
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=espn_mid), 'ESPN abandonment was not voided';
  -- football-data SUSPENDED maps to cancelled with no detail.
  UPDATE public.matches SET status='live',elapsed=40 WHERE id=fd_mid;
  UPDATE public.matches SET status='cancelled',elapsed=NULL WHERE id=fd_mid;
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=fd_mid), 'Cancelled after kickoff was not voided';
  ASSERT (SELECT count(*) FROM public.matches WHERE id IN (ab_mid,espn_mid,fd_mid) AND final_verified_at IS NULL AND status='cancelled')=3,
    'Void must keep the global fixtures unfinalized and with the provider status';

  PERFORM public.finalize_match_result(good_mid,2,1,'local Casa abandonment test');
  PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
  result:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT result->>'outcome'='money_awarded', 'Abandoned matches blocked settlement';
  ASSERT (SELECT points FROM public.casa_payouts WHERE polla_id=p)=3;
  ASSERT (SELECT sum(points_earned) FROM public.casa_picks WHERE polla_id=p AND match_id IN (ab_mid,espn_mid,fd_mid))=0;
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions WHERE match_id IN (ab_mid,espn_mid,fd_mid,good_mid));
  RAISE NOTICE 'PASS abandonment after kickoff (API-Football ABD, ESPN, football-data cancelled) voids and settlement proceeds';
END $$;

-- Migration 107: no start evidence never voids; postponed + rescheduled accepts picks.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid; canc_mid uuid; late_mid uuid; resched_mid uuid; mid uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1996'||substr(replace(u::text,'-',''),1,10),'Aplazado SQL local',true);
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
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=canc_mid), 'Cancellation before kickoff was voided';
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '10 minutes' WHERE id=canc_mid;
  ASSERT public.update_match_live_provider(canc_mid,'api-football','af-c-'||u,'cancelled',NULL,NULL,0,'STATUS_ABANDONED',clock_timestamp());
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=canc_mid), 'Abandonment with no start evidence was voided';
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '10 minutes' WHERE id=late_mid;
  UPDATE public.matches SET status='cancelled' WHERE id=late_mid;
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=late_mid), 'Delayed then cancelled match was voided';
  RAISE NOTICE 'PASS cancelled/abandoned with no start evidence stays intact';

  UPDATE public.matches SET status='cancelled',live_status_detail='STATUS_POSTPONED' WHERE id=resched_mid;
  UPDATE public.matches SET status='scheduled',scheduled_at=clock_timestamp()+interval '3 days' WHERE id=resched_mid;
  ASSERT (SELECT status='cancelled' FROM public.matches WHERE id=resched_mid), 'Fixture baseline changed: cancelled no longer sticks after rescheduling';
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
END $$;

-- Migration 107: the global live update never depends on the Casa mode.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid; mid uuid; key text;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1995'||substr(replace(u::text,'-',''),1,10),'Pausa SQL local',true);
  mid:=public.upsert_match_safe('casa-paused-'||u,'local_casa_rules',31,'league','Paused home '||u,'Paused away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  key:='casa_match_void_pending:'||mid;
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
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Casa was written while paused';
  ASSERT EXISTS(SELECT 1 FROM public.admin_alerts WHERE dedupe_key=key AND kind='casa_match_void_pending' AND resolved_at IS NULL
    AND position(('rules-paused-'||p) IN body)>0 AND position('pausa' IN body)>0), 'Paused suspension left no admin alert';
  -- The paused branch does not even attempt (and lock) Casa writes.
  ASSERT (SELECT position('OPERATIONS_PAUSED' IN body)=0 FROM public.admin_alerts WHERE dedupe_key=key), 'Paused mode attempted a Casa write';
  ASSERT public.update_match_live_provider(mid,'api-football','af-p-'||u,'live',0,0,21,'STATUS_SUSPENDED',clock_timestamp());
  ASSERT (SELECT count(*) FROM public.admin_alerts WHERE dedupe_key=key)=1;
  PERFORM public.casa_transition_mode('paused','v2');
  PERFORM public.casa_v2_context(2);
  ASSERT public.update_match_live_provider(mid,'api-football','af-p-'||u,'live',0,0,22,'STATUS_SUSPENDED',clock_timestamp());
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=p AND match_id=mid), 'Next observation after resuming did not void';
  ASSERT (SELECT resolved_at IS NOT NULL FROM public.admin_alerts WHERE dedupe_key=key), 'Alert stayed open after the void was applied';
  RAISE NOTICE 'PASS paused Casa keeps the global live update, opens one alert, and voids on the next v2 observation';
END $$;

-- Migration 107: a failing Casa pool never aborts the global update or the other pools.
DO $$
DECLARE u uuid:=gen_random_uuid(); ok_p uuid:=gen_random_uuid(); bad_p uuid:=gen_random_uuid(); e uuid; mid uuid; pid uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1994'||substr(replace(u::text,'-',''),1,10),'Fallo SQL local',true);
  mid:=public.upsert_match_safe('casa-fail-'||u,'local_casa_rules',41,'league','Fail home '||u,'Fail away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  FOREACH pid IN ARRAY ARRAY[ok_p,bad_p] LOOP
    INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
      VALUES(pid,'rules-fail-'||pid,'Fallo local','partidos','local_casa_rules','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
    INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(pid,mid);
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(pid,u,'pagada',10000) RETURNING id INTO e;
    INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(pid,e,u,mid,2,1);
  END LOOP;
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '50 minutes',status='live',elapsed=45 WHERE id=mid;
  CREATE FUNCTION pg_temp.casa_rules_forced_failure() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'forced local failure'; END $f$;
  EXECUTE format('CREATE TRIGGER zz_casa_rules_forced_failure BEFORE UPDATE OF voided_at ON public.casa_polla_matches
    FOR EACH ROW WHEN (NEW.polla_id=%L::uuid) EXECUTE FUNCTION pg_temp.casa_rules_forced_failure()',bad_p);
  ASSERT public.update_match_live_provider(mid,'api-football','af-f-'||u,'cancelled',0,0,45,'STATUS_ABANDONED',clock_timestamp());
  DROP TRIGGER zz_casa_rules_forced_failure ON public.casa_polla_matches;
  ASSERT (SELECT status='cancelled' AND live_status_detail='STATUS_ABANDONED' FROM public.matches WHERE id=mid), 'Global update was aborted';
  ASSERT (SELECT voided_at IS NOT NULL FROM public.casa_polla_matches WHERE polla_id=ok_p), 'Healthy pool was not voided';
  ASSERT (SELECT voided_at IS NULL FROM public.casa_polla_matches WHERE polla_id=bad_p), 'Failed pool kept a partial write';
  ASSERT EXISTS(SELECT 1 FROM public.admin_alerts WHERE dedupe_key='casa_match_void_pending:'||mid AND resolved_at IS NULL
    AND position(('rules-fail-'||bad_p) IN body)>0 AND position('forced local failure' IN body)>0
    AND position(('rules-fail-'||ok_p) IN body)=0), 'Failed pool left no precise alert';
  RAISE NOTICE 'PASS a failing Casa pool is isolated, alerted, and never blocks the global match update';
END $$;
ROLLBACK;
