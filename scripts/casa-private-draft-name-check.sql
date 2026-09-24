-- LOCAL ONLY: Docker supabase_db_la-polla. All random fixtures roll back.
-- No global matches, predictions, payments or operation-mode changes.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.private_name_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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

CREATE TEMP TABLE private_name_people ON COMMIT DROP AS
  SELECT n,gen_random_uuid() id FROM generate_series(1,5) n;
INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
  SELECT id,'+1667'||substr(replace(id::text,'-',''),1,10),'Local name fixture '||n,n<=4
  FROM private_name_people;

DO $$
DECLARE actor uuid:=(SELECT id FROM pg_temp.private_name_people WHERE n=1);
  second_admin uuid:=(SELECT id FROM pg_temp.private_name_people WHERE n=2);
  third_admin uuid:=(SELECT id FROM pg_temp.private_name_people WHERE n=3);
  outsider uuid:=(SELECT id FROM pg_temp.private_name_people WHERE n=4);
  player uuid:=(SELECT id FROM pg_temp.private_name_people WHERE n=5);
  p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); normal_id uuid;
  sl text:='name-fixture-'||gen_random_uuid(); second_sl text:='name-fixture-'||gen_random_uuid();
  original_name text:='Local first private draft'; target_name text:='Local private draft #1';
  draft jsonb; cfg jsonb; original_row jsonb; r jsonb;
  polls_before bigint:=(SELECT count(*) FROM public.casa_pollas);
  matches_before bigint:=(SELECT count(*) FROM public.matches);
BEGIN
  draft:=jsonb_build_object('version',1,'allowed_admin_ids',(SELECT jsonb_agg(id ORDER BY n) FROM pg_temp.private_name_people WHERE n<=3),
    'tie_break','earliest_registration','image_path',NULL,'sources',jsonb_build_array(),
    'schedule_confirmed',false,'slots',jsonb_build_array(jsonb_build_object('slot_id','a-j1-p1','order',1,'stage','cuadrangulares',
      'stage_label','Cuadrangulares','group','A','matchday',1,'game_in_group_matchday',1,'leg',NULL,'label','Pending game',
      'home_label','Home pending','away_label','Away pending','home_team',NULL,'away_team',NULL,'scheduled_at',NULL,'match_id',NULL)));
  cfg:=jsonb_build_object('id',p,'name',original_name,'description','Local fixture only','tournament','betplay_2026',
    'entryPriceCop',60000,'prizeObject','Local first fixture prize','closesAt',clock_timestamp()+interval '90 days','campaignDraft',draft);
  PERFORM public.casa_create_private_draft_v1(cfg,sl,actor,2);
  SELECT to_jsonb(c) INTO original_row FROM public.casa_pollas c WHERE id=p;

  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,target_name,original_name,outsider),'POLLA_NOT_FOUND');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,target_name,original_name,player),'ADMIN_REQUIRED');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,NULL,2)',p,target_name,original_name),'ADMIN_REQUIRED');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,1)',p,target_name,original_name,actor),'UPDATE_REQUIRED');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',gen_random_uuid(),target_name,original_name,actor),'POLLA_NOT_FOUND');
  ASSERT NOT has_function_privilege('anon','public.casa_set_private_draft_name_v1(uuid,text,text,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_set_private_draft_name_v1(uuid,text,text,uuid,integer)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_set_private_draft_name_v1(uuid,text,text,uuid,integer)','EXECUTE');
  RAISE NOTICE 'PASS only service-role callers and current allowlisted administrators can rename';

  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,NULL,%L,%L,2)',p,original_name,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,'  ',original_name,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,'ab',original_name,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,repeat('x',81),original_name,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,NULL,%L,2)',p,target_name,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,target_name,original_name||' ',actor),'PRIVATE_DRAFT_NAME_CHANGED');
  ASSERT (SELECT name=original_name FROM public.casa_pollas WHERE id=p);
  r:=public.casa_set_private_draft_name_v1(p,' '||target_name||' ',original_name,actor,2);
  ASSERT r->'changed'='true'::jsonb AND r->>'previousName'=original_name AND r->>'name'=target_name;
  ASSERT (SELECT (to_jsonb(c)-ARRAY['name','updated_at'])=(original_row-ARRAY['name','updated_at']) FROM public.casa_pollas c WHERE id=p);
  ASSERT (SELECT count(*) FROM public.casa_pollas)=polls_before+1, 'Renaming duplicated the pool';
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',p,'A competing name',original_name,actor),'PRIVATE_DRAFT_NAME_CHANGED');
  SELECT to_jsonb(c) INTO original_row FROM public.casa_pollas c WHERE id=p;
  r:=public.casa_set_private_draft_name_v1(p,target_name,target_name,actor,2);
  ASSERT r->'changed'='false'::jsonb;
  ASSERT (SELECT to_jsonb(c)=original_row FROM public.casa_pollas c WHERE id=p), 'No-op changed the row';
  PERFORM public.casa_set_private_draft_name_v1(p,'Another local draft name',target_name,second_admin,2);
  PERFORM public.casa_set_private_draft_name_v1(p,target_name,'Another local draft name',third_admin,2);
  ASSERT nullif(current_setting('app.casa_private_draft_actor',true),'') IS NULL;
  ASSERT nullif(current_setting('app.casa_private_draft_id',true),'') IS NULL;
  ASSERT nullif(current_setting('app.casa_private_draft_name_from',true),'') IS NULL;
  ASSERT nullif(current_setting('app.casa_private_draft_name_to',true),'') IS NULL;
  RAISE NOTICE 'PASS CAS detects stale names; all three admins can rename; exact no-op and other columns are preserved';

  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_edit_polla_v2(%L,%L,ARRAY[]::uuid[],ARRAY[]::uuid[],%L,2)',p,'{"name":"Changed name"}',actor),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_actor',actor::text,true);
  PERFORM set_config('app.casa_private_draft_id',p::text,true);
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_name_from',original_name,true);
  PERFORM set_config('app.casa_private_draft_name_to','Changed name',true);
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_name_from',target_name,true);
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'',campaign_draft=campaign_draft||%L::jsonb WHERE id=%L','{"note":"Unexpected metadata"}',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'',campaign_draft=jsonb_set(campaign_draft,''{allowed_admin_ids}'',%L::jsonb) WHERE id=%L',jsonb_build_array(outsider),p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'',status=''abierta'',publication_mode=''ahora'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'',slug=''changed-slug'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_price_from','60000',true);
  PERFORM set_config('app.casa_private_draft_price_to','70000',true);
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'',entry_price_cop=70000 WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_actor',outsider::text,true);
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'' WHERE id=%L',p),'PRIVATE_DRAFT_FORBIDDEN');
  PERFORM set_config('app.casa_private_draft_actor',actor::text,true);
  PERFORM set_config('app.casa_private_draft_id',q::text,true);
  PERFORM pg_temp.private_name_must_fail(format('UPDATE public.casa_pollas SET name=''Changed name'' WHERE id=%L',p),'PRIVATE_DRAFT_FORBIDDEN');
  PERFORM set_config('app.casa_private_draft_name_from','',true);
  PERFORM set_config('app.casa_private_draft_name_to','',true);
  PERFORM set_config('app.casa_private_draft_price_from','',true);
  PERFORM set_config('app.casa_private_draft_price_to','',true);
  PERFORM set_config('app.casa_private_draft_actor','',true);
  PERFORM set_config('app.casa_private_draft_id','',true);
  RAISE NOTICE 'PASS exact rename context cannot edit price, metadata, ACL, slug or publication, or bypass actor/pool checks';

  draft:=draft||jsonb_build_object('image_path',p::text||'/prize-transparent.png');
  PERFORM public.casa_update_private_draft_v1(p,draft,actor,2);
  PERFORM public.casa_set_private_draft_price_v1(p,70000,60000,actor,2);
  PERFORM public.casa_set_private_draft_price_v1(p,60000,70000,actor,2);
  ASSERT (SELECT name=target_name AND slug=sl AND campaign_draft=draft AND entry_price_cop=60000
    AND status='borrador' AND publication_mode='oculta' FROM public.casa_pollas WHERE id=p);
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_archive_polla_v2(%L,%L,2)',p,actor),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_name_must_fail(format('INSERT INTO public.casa_questions(polla_id,prompt,order_index,points,input_kind) VALUES(%L,''Fixture'',0,3,''opciones'')',p),'PRIVATE_DRAFT_LOCKED');
  RAISE NOTICE 'PASS metadata and price RPCs still work separately; lifecycle and child protection remain active';

  cfg:=cfg||jsonb_build_object('id',q,'name','Local second private draft','entryPriceCop',80000,'prizeObject','Local second fixture prize');
  PERFORM public.casa_create_private_draft_v1(cfg,second_sl,actor,2);
  PERFORM public.casa_set_private_draft_name_v1(q,'Local private draft #2','Local second private draft',actor,2);
  ASSERT (SELECT name='Local private draft #2' AND entry_price_cop=80000 AND slug=second_sl FROM public.casa_pollas WHERE id=q);
  ASSERT (SELECT name=target_name AND entry_price_cop=60000 AND slug=sl FROM public.casa_pollas WHERE id=p);
  ASSERT (SELECT count(*) FROM public.casa_pollas)=polls_before+2;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id IN (p,q));
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id IN (p,q));
  ASSERT (SELECT count(*) FROM public.matches)=matches_before;
  -- An existing operational record blocks even a no-op rename. Fixture only.
  INSERT INTO public.casa_object_draws(polla_id,prize_object,top_points) VALUES(q,'Local fixture prize',3);
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',q,'Local private draft #2','Local private draft #2',actor),'PRIVATE_DRAFT_LOCKED');
  RAISE NOTICE 'PASS distinct drafts keep their identity and prices; an operational record blocks renaming';

  r:=public.casa_create_polla_v2(jsonb_build_object('name','Ordinary local name fixture','kind','manual','prizeKind','pozo',
    'entryPriceCop',0,'houseCutPct',30,'potMode','proporcional','closesAt',clock_timestamp()+interval '1 day',
    'closeMode','manual','publicationMode','ahora','questions',jsonb_build_array(jsonb_build_object('prompt','Fixture?',
      'points',3,'inputKind','opciones','options',jsonb_build_array('Yes','No')))),'normal-name-'||gen_random_uuid(),actor,2);
  normal_id:=(r->>'id')::uuid;
  PERFORM pg_temp.private_name_must_fail(format('SELECT public.casa_set_private_draft_name_v1(%L,%L,%L,%L,2)',normal_id,'Changed ordinary pool','Ordinary local name fixture',actor),'POLLA_NOT_FOUND');
  ASSERT (SELECT name='Ordinary local name fixture' AND campaign_draft IS NULL FROM public.casa_pollas WHERE id=normal_id);
  RAISE NOTICE 'PASS this RPC cannot modify an ordinary pool';
END $$;
ROLLBACK;
