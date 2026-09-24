-- LOCAL ONLY: Docker supabase_db_la-polla. Random fixtures, rolled back in full.
-- Does not create matches, predictions, payments or change operation mode.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.private_price_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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

CREATE TEMP TABLE private_price_people ON COMMIT DROP AS
  SELECT n,gen_random_uuid() id FROM generate_series(1,5) n;
INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
  SELECT id,'+1666'||substr(replace(id::text,'-',''),1,10),'Local price fixture '||n,n<=4
  FROM private_price_people;

DO $$
DECLARE actor uuid:=(SELECT id FROM pg_temp.private_price_people WHERE n=1);
  second_admin uuid:=(SELECT id FROM pg_temp.private_price_people WHERE n=2);
  third_admin uuid:=(SELECT id FROM pg_temp.private_price_people WHERE n=3);
  outsider uuid:=(SELECT id FROM pg_temp.private_price_people WHERE n=4);
  player uuid:=(SELECT id FROM pg_temp.private_price_people WHERE n=5);
  p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); normal_id uuid;
  sl text:='price-fixture-'||gen_random_uuid(); second_sl text:='price-fixture-'||gen_random_uuid();
  draft jsonb; cfg jsonb; original_row jsonb; r jsonb;
  polls_before bigint:=(SELECT count(*) FROM public.casa_pollas);
  matches_before bigint:=(SELECT count(*) FROM public.matches);
BEGIN
  draft:=jsonb_build_object('version',1,'allowed_admin_ids',(SELECT jsonb_agg(id ORDER BY n) FROM pg_temp.private_price_people WHERE n<=3),
    'tie_break','earliest_registration','image_path',NULL,'sources',jsonb_build_array(),
    'schedule_confirmed',false,'slots',jsonb_build_array(jsonb_build_object('slot_id','a-j1-p1','order',1,'stage','cuadrangulares',
      'stage_label','Cuadrangulares','group','A','matchday',1,'game_in_group_matchday',1,'leg',NULL,'label','Pending game',
      'home_label','Home pending','away_label','Away pending','home_team',NULL,'away_team',NULL,'scheduled_at',NULL,'match_id',NULL)));
  cfg:=jsonb_build_object('id',p,'name','Local first private draft','description','Local fixture only','tournament','betplay_2026',
    'entryPriceCop',20000,'prizeObject','Local first fixture prize','closesAt',clock_timestamp()+interval '90 days','campaignDraft',draft);
  PERFORM public.casa_create_private_draft_v1(cfg,sl,actor,2);
  SELECT to_jsonb(c) INTO original_row FROM public.casa_pollas c WHERE id=p;

  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,20000,%L,2)',p,outsider),'POLLA_NOT_FOUND');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,20000,%L,2)',p,player),'ADMIN_REQUIRED');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,20000,%L,1)',p,actor),'UPDATE_REQUIRED');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,20000,%L,2)',gen_random_uuid(),actor),'POLLA_NOT_FOUND');
  ASSERT NOT has_function_privilege('anon','public.casa_set_private_draft_price_v1(uuid,integer,integer,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_set_private_draft_price_v1(uuid,integer,integer,uuid,integer)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_set_private_draft_price_v1(uuid,integer,integer,uuid,integer)','EXECUTE');
  RAISE NOTICE 'PASS only service-role callers and allowlisted administrators can request a private price edit';

  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,NULL,20000,%L,2)',p,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,-1,20000,%L,2)',p,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,10000001,20000,%L,2)',p,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,NULL,%L,2)',p,actor),'INVALID_CONFIG');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,19999,%L,2)',p,actor),'PRIVATE_DRAFT_PRICE_CHANGED');
  ASSERT (SELECT entry_price_cop=20000 FROM public.casa_pollas WHERE id=p);

  r:=public.casa_set_private_draft_price_v1(p,60000,20000,actor,2);
  ASSERT r->'changed'='true'::jsonb AND (r->>'previousEntryPriceCop')::integer=20000 AND (r->>'entryPriceCop')::integer=60000;
  ASSERT (SELECT (to_jsonb(c)-ARRAY['entry_price_cop','updated_at'])=(original_row-ARRAY['entry_price_cop','updated_at']) FROM public.casa_pollas c WHERE id=p);
  ASSERT (SELECT count(*) FROM public.casa_pollas)=polls_before+1, 'Changing the price duplicated the pool';
  ASSERT (SELECT slug=sl AND entry_price_cop=60000 AND status='borrador' AND publication_mode='oculta' FROM public.casa_pollas WHERE id=p);
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,70000,20000,%L,2)',p,actor),'PRIVATE_DRAFT_PRICE_CHANGED');
  r:=public.casa_set_private_draft_price_v1(p,60000,60000,actor,2);
  ASSERT r->'changed'='false'::jsonb;
  PERFORM public.casa_set_private_draft_price_v1(p,70000,60000,second_admin,2);
  PERFORM public.casa_set_private_draft_price_v1(p,60000,70000,third_admin,2);
  ASSERT nullif(current_setting('app.casa_private_draft_actor',true),'') IS NULL;
  ASSERT nullif(current_setting('app.casa_private_draft_id',true),'') IS NULL;
  ASSERT nullif(current_setting('app.casa_private_draft_price_from',true),'') IS NULL;
  ASSERT nullif(current_setting('app.casa_private_draft_price_to',true),'') IS NULL;
  RAISE NOTICE 'PASS compare-and-set changes the same row, preserves all other fields and clears context';

  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000 WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_edit_polla_v2(%L,%L,ARRAY[]::uuid[],ARRAY[]::uuid[],%L,2)',p,'{"entryPriceCop":70000}',actor),'PRIVATE_DRAFT_LOCKED');
  -- Even the metadata RPC context is insufficient to edit the price.
  PERFORM set_config('app.casa_private_draft_actor',actor::text,true);
  PERFORM set_config('app.casa_private_draft_id',p::text,true);
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000 WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_price_from','20000',true);
  PERFORM set_config('app.casa_private_draft_price_to','70000',true);
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000 WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  -- A valid price context must not widen the set of editable fields.
  PERFORM set_config('app.casa_private_draft_price_from','60000',true);
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000,name=''Changed name'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000,campaign_draft=campaign_draft||%L::jsonb WHERE id=%L','{"note":"Unexpected metadata"}',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000,status=''abierta'',publication_mode=''ahora'' WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM set_config('app.casa_private_draft_actor',outsider::text,true);
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000 WHERE id=%L',p),'PRIVATE_DRAFT_FORBIDDEN');
  PERFORM set_config('app.casa_private_draft_actor',actor::text,true);
  PERFORM set_config('app.casa_private_draft_id',q::text,true);
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET entry_price_cop=70000 WHERE id=%L',p),'PRIVATE_DRAFT_FORBIDDEN');
  PERFORM set_config('app.casa_private_draft_price_from','',true);
  PERFORM set_config('app.casa_private_draft_price_to','',true);
  PERFORM set_config('app.casa_private_draft_actor','',true);
  PERFORM set_config('app.casa_private_draft_id','',true);
  ASSERT (SELECT entry_price_cop=60000 AND campaign_draft=draft FROM public.casa_pollas WHERE id=p);
  RAISE NOTICE 'PASS exact price context cannot edit metadata, audience, name or publication, or bypass actor/pool checks';

  draft:=draft||jsonb_build_object('image_path',p::text||'/prize-transparent.png');
  PERFORM public.casa_update_private_draft_v1(p,draft,actor,2);
  ASSERT (SELECT campaign_draft=draft AND entry_price_cop=60000 FROM public.casa_pollas WHERE id=p);
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_archive_polla_v2(%L,%L,2)',p,actor),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_price_must_fail(format('UPDATE public.casa_pollas SET campaign_draft=NULL WHERE id=%L',p),'PRIVATE_DRAFT_LOCKED');
  PERFORM pg_temp.private_price_must_fail(format('INSERT INTO public.casa_questions(polla_id,prompt,order_index,points,input_kind) VALUES(%L,''Fixture'',0,3,''opciones'')',p),'PRIVATE_DRAFT_LOCKED');
  RAISE NOTICE 'PASS the original metadata edit works and lifecycle/children protections remain active';

  -- A genuinely different draft still uses the existing creator and its own image prefix.
  cfg:=cfg||jsonb_build_object('id',q,'name','Local second private draft','entryPriceCop',80000,
    'prizeObject','Local second fixture prize','campaignDraft',draft||jsonb_build_object('image_path',q::text||'/prize-transparent.png'));
  PERFORM public.casa_create_private_draft_v1(cfg,second_sl,actor,2);
  ASSERT (SELECT count(*) FROM public.casa_pollas)=polls_before+2;
  ASSERT (SELECT entry_price_cop=80000 AND status='borrador' AND publication_mode='oculta'
    AND campaign_draft->'allowed_admin_ids'=draft->'allowed_admin_ids' FROM public.casa_pollas WHERE id=q);
  ASSERT (SELECT entry_price_cop=60000 AND slug=sl FROM public.casa_pollas WHERE id=p);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id IN (p,q));
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id IN (p,q));
  ASSERT (SELECT count(*) FROM public.matches)=matches_before;
  RAISE NOTICE 'PASS the second 80k draft uses the existing creator while the first stays 60k without duplicate rows';

  r:=public.casa_create_polla_v2(jsonb_build_object('name','Ordinary local price fixture','kind','manual','prizeKind','pozo',
    'entryPriceCop',0,'houseCutPct',30,'potMode','proporcional','closesAt',clock_timestamp()+interval '1 day',
    'closeMode','manual','publicationMode','ahora','questions',jsonb_build_array(jsonb_build_object('prompt','Fixture?',
      'points',3,'inputKind','opciones','options',jsonb_build_array('Yes','No')))),'normal-price-'||gen_random_uuid(),actor,2);
  normal_id:=(r->>'id')::uuid;
  PERFORM pg_temp.private_price_must_fail(format('SELECT public.casa_set_private_draft_price_v1(%L,60000,0,%L,2)',normal_id,actor),'POLLA_NOT_FOUND');
  ASSERT (SELECT entry_price_cop=0 AND campaign_draft IS NULL FROM public.casa_pollas WHERE id=normal_id);
  RAISE NOTICE 'PASS this RPC cannot modify an ordinary pool';
END $$;
ROLLBACK;
