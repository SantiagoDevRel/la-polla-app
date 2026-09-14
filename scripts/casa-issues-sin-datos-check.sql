-- LOCAL ONLY. Regression of migration 121: "sin datos del proveedor" issues and the
-- issue e-mail outbox. Everything runs inside BEGIN...ROLLBACK: matches, pools,
-- users and issues created here never survive. Never run against production.
--
-- The first block creates an issue BEFORE the migration, to prove that installing
-- 121 marks existing issues as already notified. The file opens the transaction
-- (BEGIN) and closes it (ROLLBACK); the migration goes in the middle, at the
-- marker line. Usage with 121 not applied yet (Git Bash, repository root):
--   ( sed -n '1,/^-- @@ migration 121 @@$/p' scripts/casa-issues-sin-datos-check.sql; \
--     cat supabase/migrations/121_casa_match_issues_sin_datos_email.sql; \
--     sed -n '/^-- @@ migration 121 @@$/,$p' scripts/casa-issues-sin-datos-check.sql ) \
--     | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
-- With 121 already applied, pipe this file alone; the backfill assertions are skipped.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
CREATE TEMP TABLE casa_121_pre(issue uuid, migrated_here boolean) ON COMMIT DROP;
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); mid uuid; issue uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1981'||substr(replace(u::text,'-',''),1,10),'Antes de 121 local',true);
  INSERT INTO auth.users(id) VALUES(u);
  mid:=public.upsert_match_safe('casa-121-pre-'||u,'local_casa_121',1,'league','Pre home '||u,'Pre away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'casa-121-pre-'||p,'Antes de 121','partidos','local_casa_121','marcador','abierta',clock_timestamp()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  UPDATE public.matches SET status='live',elapsed=20,live_status_detail='STATUS_SUSPENDED' WHERE id=mid;
  SELECT id INTO issue FROM public.casa_match_issues WHERE match_id=mid AND kind='suspendido' AND decision IS NULL;
  ASSERT issue IS NOT NULL, 'Fixture: the suspension issue was not opened before the migration';
  INSERT INTO casa_121_pre VALUES(issue, NOT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='casa_match_issues' AND column_name='notified_at'));
END $$;
-- @@ migration 121 @@
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.must_fail_121(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.m121(tag text, u uuid) RETURNS uuid LANGUAGE sql AS $$
  -- Short unique identity (external_id is varchar(50)); kickoff in two hours.
  SELECT public.upsert_match_safe('c121-'||tag||'-'||replace(u::text,'-',''),'local_casa_121',1,'league',
    initcap(tag)||' local '||left(replace(u::text,'-',''),12),initcap(tag)||' visita '||left(replace(u::text,'-',''),12),
    NULL,NULL,now()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
$$;
CREATE TEMP TABLE IF NOT EXISTS casa_121_pre(issue uuid, migrated_here boolean) ON COMMIT DROP;

-- Installation: existing issues are history, never e-mailed.
DO $$
DECLARE pre record;
BEGIN
  SELECT * INTO pre FROM casa_121_pre LIMIT 1;
  IF pre.migrated_here IS TRUE THEN
    ASSERT (SELECT notified_at IS NOT NULL AND notify_attempts=0 AND notify_claim_token IS NULL
      FROM public.casa_match_issues WHERE id=pre.issue), 'An issue that existed before 121 was not marked as notified';
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE notified_at IS NULL), 'The installation left issues to e-mail';
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE kind='sin_datos'), 'The installation opened sin_datos issues';
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10)), 'History is claimable right after installation';
    RAISE NOTICE 'PASS installing 121 marks every existing issue as notified and opens nothing';
  ELSE
    RAISE NOTICE 'SKIP backfill assertions: 121 was already applied before this run';
  END IF;
END $$;

-- Privileges and structure.
DO $$
DECLARE f text; denied boolean;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.casa_match_awaiting_start(text,text)',
    'public.casa_match_sin_datos_due(text,text,timestamptz,boolean,timestamptz,timestamptz)',
    'public.casa_register_sin_datos_issue(uuid)','public.casa_close_stale_sin_datos_issues()',
    'public.casa_sweep_match_issues()','public.casa_resolve_sin_datos_with_result(uuid,integer,integer,uuid)',
    'public.casa_claim_match_issue_notifications(integer)','public.casa_finish_match_issue_notification(uuid,uuid,text,text)'] LOOP
    ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=f::regprocedure)='{postgres=X/postgres,service_role=X/postgres}',
      format('%s ACL is not service_role only', f);
    ASSERT (SELECT 'search_path=public, pg_temp'=ANY(proconfig) FROM pg_proc WHERE oid=f::regprocedure), format('%s has no fixed search_path', f);
    ASSERT NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE'), format('%s is executable by clients', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.casa_register_sin_datos_issue(uuid)','public.casa_close_stale_sin_datos_issues()',
    'public.casa_sweep_match_issues()','public.casa_resolve_sin_datos_with_result(uuid,integer,integer,uuid)',
    'public.casa_claim_match_issue_notifications(integer)','public.casa_finish_match_issue_notification(uuid,uuid,text,text)'] LOOP
    ASSERT (SELECT prosecdef FROM pg_proc WHERE oid=f::regprocedure), format('%s must be SECURITY DEFINER', f);
  END LOOP;
  ASSERT (SELECT prosrc LIKE '%FOR UPDATE OF i SKIP LOCKED%' FROM pg_proc WHERE oid='public.casa_claim_match_issue_notifications(integer)'::regprocedure),
    'The e-mail claim must skip locked issues';
  ASSERT (SELECT 'lock_timeout=2s'=ANY(proconfig) FROM pg_proc WHERE oid='public.casa_register_sin_datos_issue(uuid)'::regprocedure),
    'sin_datos registration must bound lock waits';
  ASSERT (SELECT prosrc LIKE '%casa_register_match_issue(m.id,m.status,m.live_status_detail,m.elapsed,''recover'')%'
    FROM pg_proc WHERE oid='public.casa_sweep_match_issues()'::regprocedure), 'The 108 recovery loop is gone from the sweep';
  ASSERT (SELECT prosrc LIKE '%casa_sweep_match_issues()%OPEN_MATCH_ISSUES%' FROM pg_proc
    WHERE oid='public.casa_settle_polla_v2(uuid,integer,uuid,bigint)'::regprocedure), 'Settlement must still sweep before OPEN_MATCH_ISSUES';
  ASSERT NOT has_table_privilege('service_role','public.casa_match_issues','INSERT,UPDATE,DELETE'), 'service_role writes issues directly';
  ASSERT NOT has_table_privilege('anon','public.casa_match_issues','SELECT') AND NOT has_table_privilege('authenticated','public.casa_match_issues','SELECT');
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.casa_match_issues'::regclass), 'RLS disabled';
  ASSERT (SELECT indisunique AND pg_get_expr(indpred,indrelid)='(decision IS NULL)' FROM pg_index
    WHERE indexrelid='public.casa_match_issues_one_open_idx'::regclass), 'One-open-issue partial unique index changed';
  denied:=false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.casa_claim_match_issue_notifications(10);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  RESET ROLE;
  ASSERT denied, 'authenticated can claim issue e-mails';
  denied:=false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.casa_sweep_match_issues();
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  RESET ROLE;
  ASSERT denied, 'anon can run the sweep';
  ASSERT current_user='postgres', 'Role was not restored';
  RAISE NOTICE 'PASS privileges: service_role only, fixed search_path, SKIP LOCKED claim, RLS and 108 guards intact';
END $$;

SELECT public.casa_v2_context(2);

-- Detection threshold, pool activity, identities and exclusions.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p_done uuid:=gen_random_uuid(); p_arch uuid:=gen_random_uuid();
  m_manual uuid; m_af uuid; m_prov uuid; m_done uuid; m_arch uuid; m_free uuid; m_live uuid; m_verified uuid;
  m_pst uuid; m_resched uuid; n integer; k timestamptz;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1982'||substr(replace(u::text,'-',''),1,10),'Sin datos SQL local',true);
  INSERT INTO auth.users(id) VALUES(u);
  -- Manual fixture (no provider identity) and an apifootball: row.
  m_manual:=pg_temp.m121('manual',u);
  m_af:=public.upsert_match_safe('apifootball:9121'||substr(replace(u::text,'-',''),1,6),'local_casa_121',2,'league','Af home '||u,'Af away '||u,
    NULL,NULL,now()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  m_prov:=pg_temp.m121('prov',u);
  m_done:=pg_temp.m121('done',u);
  m_arch:=pg_temp.m121('arch',u);
  m_free:=pg_temp.m121('free',u);
  m_live:=pg_temp.m121('live',u);
  m_verified:=pg_temp.m121('verified',u);
  m_pst:=pg_temp.m121('pst',u);
  m_resched:=pg_temp.m121('resched',u);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'casa-121-'||p,'Sin datos 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture'),
      (p_done,'casa-121-done-'||p_done,'Anulada 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture'),
      (p_arch,'casa-121-arch-'||p_arch,'Archivada 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id)
    SELECT p,x FROM unnest(ARRAY[m_manual,m_af,m_prov,m_live,m_verified,m_pst,m_resched]) x;
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p_done,m_done),(p_arch,m_arch);
  -- Links are only writable while a pool is active: finalize and archive afterwards.
  UPDATE public.casa_pollas SET status='anulada' WHERE id=p_done;
  UPDATE public.casa_pollas SET archived_at=now() WHERE id=p_arch;

  -- 29m59s after a confirmed kickoff: nothing.
  UPDATE public.matches SET scheduled_at=now()-interval '29 minutes 59 seconds'
    WHERE id IN (m_manual,m_af,m_done,m_arch,m_free,m_live,m_verified,m_pst,m_resched);
  UPDATE public.matches SET scheduled_at=now()-interval '29 hours 59 minutes',scheduled_at_confirmed=false WHERE id=m_prov;
  PERFORM public.casa_sweep_match_issues();
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id IN (m_manual,m_af,m_prov,m_done,m_arch,m_free,m_live,m_verified,m_pst,m_resched)),
    'An issue opened before 30 minutes (or 30 hours for a provisional kickoff)';

  -- Exactly 30 minutes (30 hours if provisional): due.
  UPDATE public.matches SET scheduled_at=now()-interval '30 minutes'
    WHERE id IN (m_manual,m_af,m_done,m_arch,m_free,m_live,m_verified,m_pst,m_resched);
  UPDATE public.matches SET scheduled_at=now()-interval '30 hours' WHERE id=m_prov;
  UPDATE public.matches SET status='live',elapsed=12,live_status_detail='STATUS_FIRST_HALF' WHERE id=m_live;
  PERFORM public.finalize_match_result(m_verified,1,1,'local 121 verified');
  UPDATE public.matches SET live_status_detail='STATUS_POSTPONED' WHERE id=m_pst;
  UPDATE public.matches SET status='cancelled',live_status_detail='STATUS_POSTPONED' WHERE id=m_resched;
  UPDATE public.matches SET status='scheduled',live_status_detail='STATUS_SCHEDULED' WHERE id=m_resched;
  ASSERT (SELECT status='cancelled' AND live_status_detail='STATUS_SCHEDULED' FROM public.matches WHERE id=m_resched), 'Fixture: rescheduled baseline changed';
  PERFORM public.casa_decide_match_issue((SELECT id FROM public.casa_match_issues WHERE match_id=m_resched AND kind='aplazado' AND decision IS NULL),'mantener',u,NULL);

  n:=public.casa_sweep_match_issues();
  ASSERT n>=4, format('Sweep reported %s new issues', n);
  SELECT scheduled_at INTO k FROM public.matches WHERE id=m_manual;
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_manual AND kind='sin_datos' AND decision IS NULL
    AND observed_status='scheduled' AND observed_scheduled_at=k AND notified_at IS NULL AND notify_attempts=0)=1, 'Manual fixture without data opened no issue';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_af AND kind='sin_datos' AND decision IS NULL)=1, 'apifootball: row without data opened no issue';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_prov AND kind='sin_datos' AND decision IS NULL)=1, 'Provisional kickoff 30 hours later opened no issue';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_resched AND kind='sin_datos' AND decision IS NULL)=1,
    'A rescheduled fixture kept cancelled with STATUS_SCHEDULED opened no issue';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id IN (m_done,m_arch,m_free)), 'An issue opened outside an active Casa pool';
  ASSERT public.casa_register_sin_datos_issue(m_done) IS NULL AND public.casa_register_sin_datos_issue(m_arch) IS NULL
    AND public.casa_register_sin_datos_issue(m_free) IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id IN (m_done,m_arch,m_free)), 'Direct registration opened an issue outside an active Casa pool';
  ASSERT public.casa_register_sin_datos_issue(m_live) IS NULL AND public.casa_register_sin_datos_issue(m_verified) IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id IN (m_live,m_verified)), 'Direct registration opened an issue for a live or verified match';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id IN (m_live,m_verified)), 'A live or verified match opened an issue';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_pst)=1
    AND EXISTS(SELECT 1 FROM public.casa_match_issues WHERE match_id=m_pst AND kind='aplazado'), 'A postponed match must keep its 108 issue only';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE match_id IN (m_manual,m_af,m_prov) AND voided_at IS NOT NULL), 'sin_datos voided something';
  ASSERT (SELECT count(*) FROM public.matches WHERE id IN (m_manual,m_af,m_prov) AND status='scheduled' AND final_verified_at IS NULL)=3, 'sin_datos changed a match';

  n:=public.casa_sweep_match_issues();
  ASSERT n=0, format('The sweep is not idempotent (%s)', n);
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id IN (m_manual,m_af,m_prov,m_resched))=5, 'A repeated sweep duplicated issues';
  PERFORM public.casa_register_sin_datos_issue(m_manual);
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_manual)=1, 'Direct registration duplicated an open issue';
  RAISE NOTICE 'PASS sin_datos opens at +30 min (+30 h provisional) only in active pools, for manual and apifootball rows, once';
END $$;

-- Auto-close, kickoff corrections, decisions and reopening rules.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
  m_data uuid; m_ver uuid; m_move uuid; m_flap uuid; m_fix uuid; m_keep uuid; m_void uuid; i uuid; k1 timestamptz; n integer;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1983'||substr(replace(u::text,'-',''),1,10),'Cierre solo 121 local',true);
  INSERT INTO auth.users(id) VALUES(u);
  m_data:=pg_temp.m121('data',u);
  m_ver:=pg_temp.m121('ver',u);
  m_move:=pg_temp.m121('move',u);
  m_flap:=pg_temp.m121('flap',u);
  m_fix:=pg_temp.m121('fix',u);
  m_keep:=pg_temp.m121('keep',u);
  m_void:=pg_temp.m121('void',u);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'casa-121-auto-'||p,'Cierre solo 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture'),
      (p2,'casa-121-auto2-'||p2,'Otra activa 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id)
    SELECT p,x FROM unnest(ARRAY[m_data,m_ver,m_move,m_flap,m_fix,m_keep,m_void]) x;
  UPDATE public.matches SET scheduled_at=now()-interval '40 minutes' WHERE id IN (m_data,m_ver,m_move,m_flap,m_keep,m_void);
  UPDATE public.matches SET scheduled_at=now()-interval '60 minutes' WHERE id=m_fix;
  PERFORM public.casa_sweep_match_issues();
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id IN (m_data,m_ver,m_move,m_flap,m_fix,m_keep,m_void)
    AND kind='sin_datos' AND decision IS NULL)=7, 'Fixture: seven open sin_datos issues expected';

  -- Provider data arrives (live writer), a verification closes another.
  ASSERT public.update_match_live_provider(m_data,'api-football','af-121-'||u,'live',0,0,41,'STATUS_SECOND_HALF',clock_timestamp());
  PERFORM public.finalize_match_result(m_ver,2,0,'local 121 verify');
  -- The kickoff moves to the future: no longer due.
  UPDATE public.matches SET scheduled_at=now()+interval '2 days' WHERE id=m_move;
  -- Kickoff corrected while still overdue: same open issue, new observation.
  UPDATE public.matches SET scheduled_at=now()-interval '45 minutes' WHERE id=m_fix;
  n:=public.casa_sweep_match_issues();
  ASSERT (SELECT decision='resuelto' AND decided_by IS NULL AND decided_at IS NOT NULL AND note='Se cerró solo: llegaron datos del proveedor.'
    FROM public.casa_match_issues WHERE match_id=m_data AND kind='sin_datos'), 'Provider data did not close the issue';
  ASSERT (SELECT decision='resuelto' AND note='Se cerró solo: el resultado quedó verificado.'
    FROM public.casa_match_issues WHERE match_id=m_ver AND kind='sin_datos'), 'Verification did not close the issue';
  ASSERT (SELECT decision='resuelto' AND note='Se cerró solo: el partido tiene una nueva hora de inicio.'
    FROM public.casa_match_issues WHERE match_id=m_move AND kind='sin_datos'), 'A new kickoff did not close the issue';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_fix)=1
    AND (SELECT decision IS NULL AND observed_scheduled_at=now()-interval '45 minutes' FROM public.casa_match_issues WHERE match_id=m_fix),
    'A corrected overdue kickoff did not refresh the open issue';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_active_open_match_issue_ids() x JOIN public.casa_match_issues ci ON ci.id=x.issue_id
    WHERE ci.match_id IN (m_data,m_ver,m_move)), 'Closed issues are still counted as open';
  RAISE NOTICE 'PASS provider data, verification and a future kickoff close sin_datos by themselves; an overdue correction refreshes it';

  -- The new kickoff also passes without data: a new issue (new e-mail) opens.
  UPDATE public.matches SET scheduled_at=now()-interval '35 minutes' WHERE id=m_move;
  PERFORM public.casa_sweep_match_issues();
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_move AND kind='sin_datos')=2
    AND (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_move AND decision IS NULL)=1, 'A new overdue kickoff did not open a new issue';

  -- Flapping on the same kickoff never repeats the issue.
  UPDATE public.matches SET status='live',elapsed=5 WHERE id=m_flap;
  PERFORM public.casa_sweep_match_issues();
  ASSERT (SELECT decision FROM public.casa_match_issues WHERE match_id=m_flap)='resuelto', 'Fixture: flap did not close';
  UPDATE public.matches SET status='scheduled',elapsed=NULL WHERE id=m_flap;
  PERFORM public.casa_sweep_match_issues();
  ASSERT public.casa_register_sin_datos_issue(m_flap) IS NULL, 'Direct registration reopened a resolved kickoff';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_flap)=1, 'Back to scheduled on the same kickoff reopened the issue';

  -- mantener: no repetition for that kickoff; anular: nothing ever again, even through another active pool.
  SELECT id INTO i FROM public.casa_match_issues WHERE match_id=m_keep AND decision IS NULL;
  PERFORM public.casa_decide_match_issue(i,'mantener',u,'Esperamos al proveedor');
  SELECT id INTO i FROM public.casa_match_issues WHERE match_id=m_void AND decision IS NULL;
  ASSERT (public.casa_decide_match_issue(i,'anular',u,NULL)->>'voided_pollas')::integer=1, 'anular did not void the sin_datos match';
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p2,m_void);
  PERFORM public.casa_sweep_match_issues();
  ASSERT public.casa_register_sin_datos_issue(m_keep) IS NULL, 'Direct registration reopened a kept kickoff';
  ASSERT public.casa_register_sin_datos_issue(m_void) IS NULL, 'Direct registration reopened an annulled match';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_keep)=1, 'A kept sin_datos issue reopened on the same kickoff';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_void)=1, 'An annulled match opened a new issue';
  UPDATE public.matches SET scheduled_at=now()-interval '50 minutes' WHERE id IN (m_keep,m_void);
  ASSERT public.casa_register_sin_datos_issue(m_void) IS NULL, 'Direct registration reopened an annulled match with a new kickoff';
  PERFORM public.casa_sweep_match_issues();
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_keep AND decision IS NULL)=1, 'A kept match with a new overdue kickoff did not reopen';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE match_id=m_void)=1, 'An annulled match reopened after a kickoff change';
  RAISE NOTICE 'PASS new overdue kickoff reopens; same kickoff never repeats; mantener waits; anular closes the match for good';
END $$;

-- Manual 90-minute result from /admin/issues, and settlement.
DO $$
DECLARE u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid;
  m_res uuid; m_race uuid; m_pst uuid; i uuid; i_race uuid; i_pst uuid; r jsonb; notes text;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1984'||substr(replace(u::text,'-',''),1,10),'Resultado 121 local',true),
      (outsider,'+1985'||substr(replace(outsider::text,'-',''),1,10),'Sin permiso 121 local',false);
  INSERT INTO auth.users(id) VALUES(u);
  m_res:=pg_temp.m121('res',u);
  m_race:=pg_temp.m121('race',u);
  m_pst:=pg_temp.m121('rpst',u);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'casa-121-res-'||p,'Resultado manual 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,m_res);
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,m_res,2,1);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,m_race),(p,m_pst);
  UPDATE public.matches SET scheduled_at=now()-interval '3 hours' WHERE id IN (m_res,m_race,m_pst);
  UPDATE public.matches SET live_status_detail='STATUS_POSTPONED' WHERE id=m_pst;
  PERFORM public.casa_sweep_match_issues();
  SELECT id INTO i FROM public.casa_match_issues WHERE match_id=m_res AND kind='sin_datos' AND decision IS NULL;
  SELECT id INTO i_race FROM public.casa_match_issues WHERE match_id=m_race AND kind='sin_datos' AND decision IS NULL;
  SELECT id INTO i_pst FROM public.casa_match_issues WHERE match_id=m_pst AND kind='aplazado' AND decision IS NULL;
  ASSERT i IS NOT NULL AND i_race IS NOT NULL AND i_pst IS NOT NULL, 'Fixture: issues missing';

  PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,2,1,%L)',i_pst,u),'ISSUE_RESULT_NOT_ALLOWED');
  ASSERT (SELECT final_verified_at IS NULL FROM public.matches WHERE id=m_pst), 'A result was written for a postponed match';
  PERFORM public.casa_decide_match_issue(i_pst,'anular',u,NULL);
  PERFORM public.casa_decide_match_issue(i_race,'anular',u,NULL);
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,u),'OPEN_MATCH_ISSUES');
  RAISE NOTICE 'PASS an open sin_datos issue blocks settlement with OPEN_MATCH_ISSUES; other kinds do not take a manual result';

  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,2,1,%L)',i,outsider),'ADMIN_REQUIRED');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,-1,1,%L)',i,u),'INVALID_SCORE');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,2,100,%L)',i,u),'INVALID_SCORE');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,NULL,1,%L)',i,u),'INVALID_SCORE');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,2,1,%L)',gen_random_uuid(),u),'ISSUE_NOT_FOUND');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,2,1,%L)',i_pst,u),'ISSUE_ALREADY_DECIDED');
  ASSERT (SELECT decision IS NULL FROM public.casa_match_issues WHERE id=i) AND (SELECT final_verified_at IS NULL FROM public.matches WHERE id=m_res),
    'A rejected manual result changed something';

  PERFORM public.casa_transition_mode('v2','paused');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,2,1,%L)',i,u),'OPERATIONS_PAUSED');
  PERFORM public.casa_transition_mode('paused','v2');
  PERFORM public.casa_v2_context(2);

  r:=public.casa_resolve_sin_datos_with_result(i,2,1,u);
  ASSERT r->>'decision'='resuelto' AND r->>'issue_id'=i::text AND r->>'match_id'=m_res::text AND (r->>'home')::integer=2 AND (r->>'away')::integer=1,
    format('Unexpected manual result response %s', r);
  SELECT final_verification_notes INTO notes FROM public.matches WHERE id=m_res;
  ASSERT (SELECT status='finished' AND home_score=2 AND away_score=1 AND final_verified_at IS NOT NULL FROM public.matches WHERE id=m_res),
    'The manual result did not finalize the match';
  ASSERT notes LIKE 'manual override por Resultado 121 local ('||u||') via /admin/issues source=manual caso='||i||' at=%', format('Unexpected notes: %s', notes);
  ASSERT (SELECT decision='resuelto' AND decided_by=u AND decided_at IS NOT NULL AND note='Resultado manual de los 90 minutos: 2-1.'
    FROM public.casa_match_issues WHERE id=i), 'The manual result did not close the issue';
  ASSERT (SELECT points_earned FROM public.casa_picks WHERE polla_id=p AND match_id=m_res)>0, 'The manual result was not scored';
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,3,1,%L)',i,u),'ISSUE_ALREADY_DECIDED');
  ASSERT (SELECT home_score FROM public.matches WHERE id=m_res)=2, 'A second manual result overwrote the first';

  r:=public.casa_settle_polla_v2(p,2,u,NULL);
  ASSERT r->>'outcome'='money_awarded', format('Settlement after the manual result: %s', r);
  RAISE NOTICE 'PASS manual 90-minute result: admin only, validated, finalizes through the RPC, scores, closes the issue and unblocks settlement';
END $$;

-- A match verified by another process while its issue is still open.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); mid uuid; i uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1986'||substr(replace(u::text,'-',''),1,10),'Carrera 121 local',true);
  INSERT INTO auth.users(id) VALUES(u);
  mid:=pg_temp.m121('verified',u);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'casa-121-vr-'||p,'Carrera 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  UPDATE public.matches SET scheduled_at=now()-interval '2 hours' WHERE id=mid;
  PERFORM public.casa_sweep_match_issues();
  SELECT id INTO i FROM public.casa_match_issues WHERE match_id=mid AND kind='sin_datos' AND decision IS NULL;
  PERFORM public.finalize_verified_match_result(mid,0,0,'local 121 automatic verification');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_resolve_sin_datos_with_result(%L,4,4,%L)',i,u),'MATCH_ALREADY_VERIFIED');
  ASSERT (SELECT decision IS NULL FROM public.casa_match_issues WHERE id=i) AND (SELECT home_score=0 AND away_score=0 FROM public.matches WHERE id=mid),
    'A conflicting manual result wrote something';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i), 'A sin_datos issue that is no longer due was e-mailed';
  PERFORM public.casa_sweep_match_issues();
  ASSERT (SELECT decision='resuelto' AND note='Se cerró solo: el resultado quedó verificado.' FROM public.casa_match_issues WHERE id=i), 'Sweep did not close the verified issue';
  RAISE NOTICE 'PASS a result verified meanwhile answers MATCH_ALREADY_VERIFIED, is never overwritten and the sweep closes the issue';
END $$;

-- E-mail outbox: exactly once, retries with backoff, release, cap and filters.
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p_off uuid:=gen_random_uuid();
  m1 uuid; m2 uuid; m_off uuid; m_dec uuid; m_moved uuid; i1 uuid; i2 uuid; i_off uuid; i_dec uuid; i_moved uuid;
  r record; t_old uuid; t_new uuid; n integer; round integer;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1987'||substr(replace(u::text,'-',''),1,10),'Correo 121 local',true);
  INSERT INTO auth.users(id) VALUES(u);
  m1:=pg_temp.m121('mail1',u);
  m2:=pg_temp.m121('mail2',u);
  m_off:=pg_temp.m121('mailoff',u);
  m_dec:=pg_temp.m121('maildec',u);
  m_moved:=pg_temp.m121('mailmove',u);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'casa-121-mail-'||p,'Correo 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture'),
      (p_off,'casa-121-mailoff-'||p_off,'Correo inactiva 121','partidos','local_casa_121','marcador','abierta',now()+interval '1 hour',u,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,m1),(p,m2),(p,m_dec),(p,m_moved),(p_off,m_off);
  UPDATE public.matches SET scheduled_at=now()-interval '40 minutes' WHERE id IN (m1,m_off,m_dec,m_moved);
  UPDATE public.matches SET status='live',elapsed=30 WHERE id=m2;
  UPDATE public.matches SET live_status_detail='STATUS_SUSPENDED' WHERE id=m2;
  PERFORM public.casa_sweep_match_issues();
  SELECT id INTO i1 FROM public.casa_match_issues WHERE match_id=m1 AND decision IS NULL;
  SELECT id INTO i2 FROM public.casa_match_issues WHERE match_id=m2 AND kind='suspendido' AND decision IS NULL;
  SELECT id INTO i_off FROM public.casa_match_issues WHERE match_id=m_off AND decision IS NULL;
  SELECT id INTO i_dec FROM public.casa_match_issues WHERE match_id=m_dec AND decision IS NULL;
  SELECT id INTO i_moved FROM public.casa_match_issues WHERE match_id=m_moved AND decision IS NULL;
  ASSERT i1 IS NOT NULL AND i2 IS NOT NULL AND i_off IS NOT NULL AND i_dec IS NOT NULL AND i_moved IS NOT NULL, 'Fixture: outbox issues missing';
  ASSERT (SELECT notified_at IS NULL FROM public.casa_match_issues WHERE id=i2), 'A trigger-opened issue must be e-mailed too';
  PERFORM public.casa_decide_match_issue(i_dec,'mantener',u,NULL);
  PERFORM public.casa_change_status_v2(p_off,'anular',2,u,NULL);
  UPDATE public.matches SET status='live',elapsed=3 WHERE id=m_moved;  -- not swept yet: no longer due

  PERFORM pg_temp.must_fail_121('SELECT * FROM public.casa_claim_match_issue_notifications(0)','INVALID_LIMIT');
  PERFORM pg_temp.must_fail_121('SELECT * FROM public.casa_claim_match_issue_notifications(11)','INVALID_LIMIT');

  CREATE TEMP TABLE casa_121_claims(issue uuid, token uuid, kind text, home text, names text[], confirmed boolean) ON COMMIT DROP;
  FOR round IN 1..60 LOOP
    INSERT INTO casa_121_claims
      SELECT c.issue_id,c.claim_token,c.kind,c.home_team,c.polla_names,c.scheduled_at_confirmed
      FROM public.casa_claim_match_issue_notifications(10) c;
    GET DIAGNOSTICS n=ROW_COUNT;
    EXIT WHEN n=0;
    ASSERT n<=10, 'A claim returned more than its limit';
  END LOOP;
  ASSERT (SELECT count(*) FROM casa_121_claims)=(SELECT count(DISTINCT issue) FROM casa_121_claims), 'An issue was claimed twice';
  ASSERT EXISTS(SELECT 1 FROM casa_121_claims WHERE issue=i1 AND kind='sin_datos' AND home='Mail1 local '||left(replace(u::text,'-',''),12) AND names=ARRAY['Correo 121'] AND confirmed),
    'The sin_datos issue was not claimed with its match and pool';
  ASSERT EXISTS(SELECT 1 FROM casa_121_claims WHERE issue=i2 AND kind='suspendido'), 'A 108 issue was not claimed';
  ASSERT NOT EXISTS(SELECT 1 FROM casa_121_claims WHERE issue IN (i_off,i_dec,i_moved)), 'An inactive, decided or no longer due issue was claimed';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10)), 'A second claim returned claimed issues';
  ASSERT (SELECT count(*) FROM public.casa_match_issues WHERE id IN (SELECT issue FROM casa_121_claims) AND (notify_claim_token IS NULL OR notify_attempts<>1))=0,
    'Claims must set a token and count one attempt';
  RAISE NOTICE 'PASS two claims never return the same issue; only open, active, due issues are claimed';

  -- Stale claim: taken again with a new token; the old holder can no longer finish it.
  SELECT token INTO t_old FROM casa_121_claims WHERE issue=i1;
  UPDATE public.casa_match_issues SET notify_claimed_at=now()-interval '6 minutes' WHERE id=i1;
  SELECT c.claim_token INTO t_new FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i1;
  ASSERT t_new IS NOT NULL AND t_new<>t_old AND (SELECT notify_attempts FROM public.casa_match_issues WHERE id=i1)=2, 'A stale claim was not taken again';
  ASSERT NOT public.casa_finish_match_issue_notification(i1,t_old,'sent'), 'A stale token finished the claim';
  ASSERT (SELECT notified_at IS NULL FROM public.casa_match_issues WHERE id=i1);
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_finish_match_issue_notification(%L,%L,%L,%L)',i1,t_new,'failed','Resend said: x@y.com'),'INVALID_ERROR_CODE');
  PERFORM pg_temp.must_fail_121(format('SELECT public.casa_finish_match_issue_notification(%L,%L,%L)',i1,t_new,'borrar'),'INVALID_OUTCOME');
  ASSERT public.casa_finish_match_issue_notification(i1,t_new,'failed','resend_rate_limit_exceeded_429'), 'The failed claim was not recorded';
  ASSERT (SELECT notified_at IS NULL AND notify_claim_token IS NULL AND notify_attempts=2 AND notify_last_error='resend_rate_limit_exceeded_429'
    FROM public.casa_match_issues WHERE id=i1), 'Failure bookkeeping is wrong';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i1), 'A failed issue was retried before its backoff';
  UPDATE public.casa_match_issues SET notify_claimed_at=now()-interval '6 minutes' WHERE id=i1;
  SELECT c.claim_token INTO t_new FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i1;
  ASSERT t_new IS NOT NULL AND (SELECT notify_attempts FROM public.casa_match_issues WHERE id=i1)=3, 'The failed issue was not retried after its backoff';
  ASSERT public.casa_finish_match_issue_notification(i1,t_new,'sent'), 'The sent claim was not recorded';
  ASSERT (SELECT notified_at IS NOT NULL AND notify_claim_token IS NULL AND notify_last_error IS NULL FROM public.casa_match_issues WHERE id=i1);
  ASSERT NOT public.casa_finish_match_issue_notification(i1,t_new,'sent'), 'A claim finished twice';
  UPDATE public.casa_match_issues SET notify_claimed_at=now()-interval '2 hours' WHERE id=i1;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i1), 'A notified issue was claimed again';
  RAISE NOTICE 'PASS stale claims are taken again, stale tokens are ignored, failures back off and a sent issue never returns';

  -- Release gives the attempt back; the attempt cap stops retries; backoff grows.
  SELECT token INTO t_old FROM casa_121_claims WHERE issue=i2;
  ASSERT public.casa_finish_match_issue_notification(i2,t_old,'released'), 'Release was not recorded';
  ASSERT (SELECT notify_attempts=0 AND notify_claimed_at IS NULL AND notify_claim_token IS NULL FROM public.casa_match_issues WHERE id=i2);
  SELECT c.claim_token INTO t_new FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i2;
  ASSERT t_new IS NOT NULL, 'A released issue was not claimable right away';
  ASSERT public.casa_finish_match_issue_notification(i2,t_new,'failed','exception');
  UPDATE public.casa_match_issues SET notify_attempts=5,notify_claimed_at=now()-interval '31 minutes' WHERE id=i2;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i2), 'Backoff after five attempts must be 32 minutes';
  UPDATE public.casa_match_issues SET notify_claimed_at=now()-interval '33 minutes' WHERE id=i2;
  SELECT c.claim_token INTO t_new FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i2;
  ASSERT t_new IS NOT NULL, 'Backoff after five attempts did not expire at 32 minutes';
  ASSERT public.casa_finish_match_issue_notification(i2,t_new,'failed','timeout');
  UPDATE public.casa_match_issues SET notify_attempts=8,notify_claimed_at=now()-interval '5 hours' WHERE id=i2;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_claim_match_issue_notifications(10) c WHERE c.issue_id=i2), 'An issue was claimed after eight attempts';
  RAISE NOTICE 'PASS release, exponential backoff and the eight-attempt cap';
END $$;
ROLLBACK;
