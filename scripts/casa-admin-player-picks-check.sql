-- Fresh isolated CI database only; no production writes. Fixtures roll back.
BEGIN;
SELECT public.casa_v2_context(2);
CREATE FUNCTION pg_temp.admin_pick_fails(q text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    ASSERT position(expected IN msg)>0,format('Expected %s, got %s',expected,msg); RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %',expected;
END $$;
DO $$
DECLARE actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  player uuid; other_player uuid; e uuid; other_entry uuid; q uuid:=gen_random_uuid(); o uuid:=gen_random_uuid();
  request uuid:=gen_random_uuid(); input jsonb; result jsonb; state jsonb; m uuid; mp uuid; me uuid;
BEGIN
  INSERT INTO public.users(id,display_name,is_admin) VALUES(actor,'Admin picks fixture',true),(outsider,'Outsider fixture',false);
  SELECT user_id INTO player FROM public.casa_admin_players WHERE position=1;
  SELECT user_id INTO other_player FROM public.casa_admin_players WHERE position=2;
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'admin-picks-'||p,'Admin picks fixture','manual','abierta',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour',actor,10000,'otro','fixture');
  INSERT INTO public.casa_questions(id,polla_id,prompt,input_kind) VALUES(q,p,'Fixture question','opciones');
  INSERT INTO public.casa_options(id,question_id,label) VALUES(o,q,'Fixture option');
  input:=jsonb_build_array(jsonb_build_object('questionId',q,'optionId',o));
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_player_pick_state(%L,%L,%L)',p,player,outsider),'ADMIN_REQUIRED');
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_player_pick_state(%L,%L,%L)',p,outsider,actor),'INVALID_MANAGED_PLAYER');
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_player_pick_state(%L,%L,%L)',p,player,actor),'MANAGED_ENTRY_REQUIRED');
  ASSERT NOT has_function_privilege('authenticated','public.casa_admin_player_pick_state(uuid,uuid,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_admin_save_player_picks(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,integer)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.casa_admin_player_pick_events','SELECT');
  ASSERT NOT has_table_privilege('service_role','public.casa_admin_player_pick_events','UPDATE');
  ASSERT NOT has_table_privilege('service_role','public.casa_admin_player_pick_events','DELETE');
  PERFORM public.casa_set_admin_player(p,player,true,0,actor,2);
  SELECT id INTO e FROM public.casa_entries WHERE polla_id=p AND user_id=player;
  state:=public.casa_admin_player_pick_state(p,player,actor);
  ASSERT state->>'ownerId'=player::text AND state->>'entryId'=e::text AND state->>'revision'='0' AND state->'picks'='{}'::jsonb;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=e), 'Enrollment/view must create no default picks';
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,outsider,'pagada',10000) RETURNING id INTO other_entry;
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_save_player_picks(%L,%L,%L,%L,%L,0,%L,2)',p,player,outsider,e,request,input),'ADMIN_REQUIRED');
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_save_player_picks(%L,%L,%L,%L,%L,0,%L,1)',p,player,actor,e,request,input),'UPDATE_REQUIRED');
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_save_player_picks(%L,%L,%L,%L,%L,0,%L,2)',p,player,actor,other_entry,request,input),'MANAGED_ENTRY_CONFLICT');
  result:=public.casa_admin_save_player_picks(p,player,actor,e,request,0,input,2);
  ASSERT result->>'guardados'='1' AND result->>'revision'='1';
  ASSERT (SELECT user_id=player AND option_id=o FROM public.casa_picks WHERE entry_id=e AND question_id=q);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=other_entry OR user_id=actor);
  ASSERT (SELECT actor_id=actor FROM public.casa_admin_player_pick_events WHERE entry_id=e AND request_id=request);
  ASSERT public.casa_admin_save_player_picks(p,player,actor,e,request,0,input,2)=result;
  ASSERT (SELECT count(*) FROM public.casa_admin_player_pick_events WHERE entry_id=e)=1;
  state:=public.casa_admin_player_pick_state(p,player,actor);
  ASSERT state->>'revision'='1' AND state->'lastResult'=result AND state->'picks'->q::text->>'optionId'=o::text;
  result:=public.casa_admin_save_player_picks(p,player,actor,e,gen_random_uuid(),0,input,2);
  ASSERT result->>'conflict'='true';
  ASSERT (SELECT count(*) FROM public.casa_admin_player_pick_events WHERE entry_id=e)=1;
  PERFORM public.casa_set_admin_player(p,player,false,1,actor,2);
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_save_player_picks(%L,%L,%L,%L,%L,1,%L,2)',p,player,actor,e,gen_random_uuid(),input),'MANAGED_ENTRY_REQUIRED');
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE entry_id=e)=1;
  PERFORM public.casa_set_admin_player(p,player,true,2,actor,2);
  ASSERT public.casa_admin_player_pick_state(p,player,actor)->>'revision'='1';
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,other_player,'pagada',10000);
  PERFORM pg_temp.admin_pick_fails(format('SELECT public.casa_admin_player_pick_state(%L,%L,%L)',p,other_player,actor),'MANAGED_ENTRY_CONFLICT');
  UPDATE public.casa_pollas SET closes_at=clock_timestamp()-interval '1 second' WHERE id=p;
  result:=public.casa_admin_save_player_picks(p,player,actor,e,gen_random_uuid(),1,input,2);
  ASSERT result->>'guardados'='0', 'Admin must not bypass a manual question lock';
  RAISE NOTICE 'PASS admin-only manual picks, empty defaults, owner scope, audit, retry, revisions and question locks';

  m:=public.upsert_match_safe('admin-match-'||p,'premier_2025',1,'league','Admin home '||p,'Admin away '||p,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  mp:=(public.casa_create_polla_v2(jsonb_build_object('name','Admin match fixture','kind','partidos','tournament','premier_2025',
    'scoringMode','marcador','prizeKind','pozo','entryPriceCop',10000,'houseCutPct',30,'closesAt',clock_timestamp()+interval '1 hour',
    'closeMode','auto','publicationMode','ahora','payoutMethod','otro','payoutAccount','fixture','matchIds',jsonb_build_array(m)),
    'admin-match-pool-'||p,actor,2)->>'id')::uuid;
  PERFORM public.casa_set_admin_player(mp,player,true,0,actor,2);
  SELECT id INTO me FROM public.casa_entries WHERE polla_id=mp AND user_id=player;
  input:=jsonb_build_array(jsonb_build_object('matchId',m,'homeScore',2,'awayScore',1));
  result:=public.casa_admin_save_player_picks(mp,player,actor,me,gen_random_uuid(),0,input,2);
  ASSERT result->>'guardados'='1';
  ASSERT (SELECT home_score=2 AND away_score=1 AND user_id=player FROM public.casa_picks WHERE entry_id=me);
  -- This match is a synthetic row created in this transaction, never a live fixture.
  UPDATE public.matches SET status='live',elapsed=1 WHERE id=m;
  input:=jsonb_build_array(jsonb_build_object('matchId',m,'homeScore',3,'awayScore',0));
  result:=public.casa_admin_save_player_picks(mp,player,actor,me,gen_random_uuid(),1,input,2);
  ASSERT result->>'guardados'='0';
  ASSERT (SELECT home_score=2 AND away_score=1 FROM public.casa_picks WHERE entry_id=me);
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions);
  RAISE NOTICE 'PASS admin match picks retain original writer, live lock and historical predictions';
END $$;
ROLLBACK;
