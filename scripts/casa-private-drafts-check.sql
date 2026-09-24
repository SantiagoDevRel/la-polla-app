-- LOCAL ONLY: Docker supabase_db_la-polla. Fresh random fixtures, all rolled back.
-- Does not create matches, predictions, payments, object draws or change operation mode.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.private_draft_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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

CREATE TEMP TABLE private_draft_people ON COMMIT DROP AS
  SELECT n,gen_random_uuid() id FROM generate_series(1,5) n;
INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
  SELECT id,'+1667'||substr(replace(id::text,'-',''),1,10),'Local private draft fixture '||n,n<=4
  FROM private_draft_people;

DO $$
DECLARE actor uuid:=(SELECT id FROM pg_temp.private_draft_people WHERE n=1);
  outsider uuid:=(SELECT id FROM pg_temp.private_draft_people WHERE n=4);
  player uuid:=(SELECT id FROM pg_temp.private_draft_people WHERE n=5);
  draft jsonb; cfg jsonb; r jsonb; p uuid:=gen_random_uuid(); sl text:='private-fixture-'||gen_random_uuid();
  matches_before bigint:=(SELECT count(*) FROM public.matches);
  normal_id uuid; uid uuid;
BEGIN
  draft:=jsonb_build_object('version',1,'allowed_admin_ids',(SELECT jsonb_agg(id ORDER BY n) FROM pg_temp.private_draft_people WHERE n<=3),
    'tie_break','earliest_registration','image_path',NULL,'sources',jsonb_build_array(jsonb_build_object('title','Fixture rules','url','https://example.org/rules')),
    'schedule_confirmed',false,'slots',jsonb_build_array(jsonb_build_object('slot_id','a-j1-p1','order',1,'stage','cuadrangulares',
      'stage_label','Cuadrangulares','group','A','matchday',1,'game_in_group_matchday',1,'leg',NULL,'label','First pending game',
      'home_label','Home pending','away_label','Away pending','home_team',NULL,'away_team',NULL,'scheduled_at',NULL,'match_id',NULL)));
  cfg:=jsonb_build_object('id',p,'name','Local private campaign','description','Fixture only','tournament','betplay_2026',
    'entryPriceCop',20000,'prizeObject','Local fixture prize','closesAt',clock_timestamp()+interval '90 days','campaignDraft',draft);

  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_create_private_draft_v1(%L,%L,%L,2)',cfg,sl,outsider),'INVALID_PRIVATE_DRAFT');
  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_create_private_draft_v1(%L,%L,%L,2)',cfg,sl,player),'ADMIN_REQUIRED');
  r:=public.casa_create_private_draft_v1(cfg,sl,actor,2);
  ASSERT (r->>'id')::uuid=p;
  ASSERT (SELECT status='borrador' AND publication_mode='oculta' AND entry_price_cop=20000 AND prize_kind='objeto'
    AND scoring_mode='1x2' AND campaign_draft=draft FROM public.casa_pollas WHERE id=p);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p);
  ASSERT (SELECT count(*) FROM public.matches)=matches_before;
  RAISE NOTICE 'PASS selected admins can create a hidden 1X2 draft without fixtures or entries';

  FOREACH uid IN ARRAY ARRAY[actor,outsider,player] LOOP
    PERFORM set_config('request.jwt.claim.sub',uid::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=p), 'Data API exposed private campaign';
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p);
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p);
    EXECUTE 'RESET ROLE';
  END LOOP;
  ASSERT NOT has_table_privilege('anon','public.casa_pollas','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.casa_create_private_draft_v1(jsonb,text,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_update_private_draft_v1(uuid,jsonb,uuid,integer)','EXECUTE');
  RAISE NOTICE 'PASS direct Data API access denied even to selected admins; server RPCs remain private';

  -- Defense in depth: a future overly broad permissive policy cannot reveal
  -- drafts. All temporary ACL/policy changes stay inside this rolled-back test.
  EXECUTE 'GRANT SELECT ON public.casa_pollas TO anon';
  EXECUTE 'CREATE POLICY private_draft_fixture_permissive ON public.casa_pollas FOR SELECT TO anon,authenticated USING (true)';
  EXECUTE 'SET LOCAL ROLE anon';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=p), 'Anonymous permissive policy bypassed the restrictive gate';
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=p), 'Authenticated permissive policy bypassed the restrictive gate';
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS restrictive policies deny anon/authenticated even alongside a permissive allow-all policy';

  -- Every old administrative lifecycle mutation fails, including archive's direct row update.
  FOREACH uid IN ARRAY ARRAY[actor,outsider] LOOP
    PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_archive_polla_v2(%L,%L,2)',p,uid),'PRIVATE_DRAFT_LOCKED');
    PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_change_status_v2(%L,''anular'',2,%L,NULL)',p,uid),'PRIVATE_DRAFT_LOCKED');
    PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_set_publication_v2(%L,''oculta'',NULL,%L,2)',p,uid),'PRIVATE_DRAFT_LOCKED');
  END LOOP;
  PERFORM pg_temp.private_draft_must_fail(format('UPDATE public.casa_pollas SET campaign_draft=NULL,status=''abierta'',publication_mode=''ahora'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_draft_must_fail(format('UPDATE public.casa_pollas SET status=''abierta'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_begin_entry_proof_v2(%L,%L,%L,NULL,%L,''image/png'',100,2)',p,player,gen_random_uuid(),repeat('a',64)),'POLLA_NOT_PUBLISHED');
  PERFORM pg_temp.private_draft_must_fail(format('INSERT INTO public.casa_questions(polla_id,prompt,order_index,points,input_kind) VALUES(%L,''Fixture'',0,3,''opciones'')',p),'PRIVATE_DRAFT_LOCKED');
  ASSERT (SELECT status='borrador' AND publication_mode='oculta' AND archived_at IS NULL FROM public.casa_pollas WHERE id=p);
  RAISE NOTICE 'PASS old admin mutations, direct publication, registrations and operational children cannot escape the draft';

  draft:=draft||jsonb_build_object('image_path',p::text||'/iphone.jpg');
  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_update_private_draft_v1(%L,%L,%L,2)',p,draft,outsider),'POLLA_NOT_FOUND');
  PERFORM public.casa_update_private_draft_v1(p,draft,actor,2);
  ASSERT (SELECT campaign_draft=draft FROM public.casa_pollas WHERE id=p);
  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_update_private_draft_v1(%L,%L,%L,2)',p,
    draft||jsonb_build_object('image_path',outsider::text||'/iphone.jpg'),actor),'INVALID_PRIVATE_DRAFT_IMAGE');
  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_update_private_draft_v1(%L,%L,%L,2)',p,
    draft||jsonb_build_object('allowed_admin_ids',jsonb_build_array(actor,outsider)),actor),'INVALID_PRIVATE_DRAFT');
  PERFORM pg_temp.private_draft_must_fail(format('SELECT public.casa_update_private_draft_v1(%L,%L,%L,2)',p,
    draft||jsonb_build_object('slots',draft->'slots'||draft->'slots'),actor),'INVALID_PRIVATE_DRAFT');
  RAISE NOTICE 'PASS only selected admin can update review metadata, with immutable allowlist and unique slots';

  -- Ordinary legacy pool visibility and lifecycle are unchanged by the new guards.
  r:=public.casa_create_polla_v2(jsonb_build_object('name','Ordinary local fixture','kind','manual','prizeKind','pozo',
    'entryPriceCop',0,'houseCutPct',30,'potMode','proporcional','closesAt',clock_timestamp()+interval '1 day',
    'closeMode','manual','publicationMode','ahora','questions',jsonb_build_array(jsonb_build_object('prompt','Fixture?',
      'points',3,'inputKind','opciones','options',jsonb_build_array('Yes','No')))),'normal-fixture-'||gen_random_uuid(),actor,2);
  normal_id:=(r->>'id')::uuid;
  UPDATE public.casa_pollas SET opens_at=transaction_timestamp()-interval '1 second' WHERE id=normal_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=normal_id);
  ASSERT EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=normal_id);
  EXECUTE 'RESET ROLE';
  PERFORM public.casa_change_status_v2(normal_id,'cerrar',2,actor,NULL);
  ASSERT (SELECT status='cerrada' FROM public.casa_pollas WHERE id=normal_id);
  ASSERT (SELECT count(*) FROM public.matches)=matches_before;
  RAISE NOTICE 'PASS existing ordinary creation, RLS reads and closing are unchanged';
END $$;
ROLLBACK;
