-- Synthetic fixtures in disposable PostgreSQL only; all rows roll back.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
DO $$
DECLARE u uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); p uuid; m uuid; closed uuid; e uuid;
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); cfg jsonb;
  manual uuid:=gen_random_uuid(); me uuid; qt uuid:=gen_random_uuid(); qo uuid:=gen_random_uuid();
  foreign_q uuid:=gen_random_uuid(); own_opt uuid:=gen_random_uuid(); foreign_opt uuid:=gen_random_uuid();
  pa jsonb; pb jsonb; reply jsonb; first jsonb; latest jsonb; r bigint;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (u,'+1999'||substr(replace(u::text,'-',''),1,10),'Pick save fixture',true),
    (other,'+1998'||substr(replace(other::text,'-',''),1,10),'Other pick save fixture',false);
  m:=public.upsert_match_safe('save-'||u,'premier_2025',1,'league','Save home '||u,'Save away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  closed:=public.upsert_match_safe('closed-'||u,'premier_2025',2,'league','Closed home '||u,'Closed away '||u,
    NULL,NULL,clock_timestamp()+interval '3 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  cfg:=jsonb_build_object('name','Pick save fixture','kind','partidos','tournament','premier_2025',
    'scoringMode','marcador','prizeKind','pozo','entryPriceCop',10000,'houseCutPct',30,
    'closesAt',clock_timestamp()+interval '1 hour','closeMode','auto','publicationMode','ahora',
    'payoutMethod','otro','payoutAccount','synthetic','matchIds',jsonb_build_array(m,closed));
  p:=(public.casa_create_polla_v2(cfg,'save-fixture-'||u,u,2)->>'id')::uuid;
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  pa:=jsonb_build_array(jsonb_build_object('matchId',m,'homeScore',2,'awayScore',1));
  pb:=jsonb_build_array(jsonb_build_object('matchId',m,'homeScore',3,'awayScore',0));
  first:=public.casa_save_picks_v1(p,u,e,a,0,pa);
  ASSERT first->>'guardados'='1' AND first->>'revision'='1';
  ASSERT first->'results'->0->'values'->>'homeScore'='2';
  latest:=public.casa_save_picks_v1(p,u,e,b,1,pb);
  ASSERT latest->>'revision'='2';
  reply:=public.casa_save_picks_v1(p,u,e,a,0,pa);
  ASSERT reply->>'conflict'='true', 'A delayed old write must not overwrite B';
  ASSERT (SELECT home_score=3 AND away_score=0 FROM public.casa_picks WHERE entry_id=e AND match_id=m);
  ASSERT public.casa_pick_save_state_v1(p,other,e) IS NULL, 'An unrelated owner cannot read confirmations';
  BEGIN
    PERFORM public.casa_save_picks_v1(p,other,e,c,2,pa);
    RAISE EXCEPTION 'An unrelated owner saved';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.casa_save_picks_v1(p,u,e,b,2,pa);
    RAISE EXCEPTION 'A reused identity changed its body';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE public.matches SET status='live',elapsed=1 WHERE id=closed;
  reply:=public.casa_save_picks_v1(p,u,e,c,2,pa||jsonb_build_array(jsonb_build_object('matchId',closed,'homeScore',1,'awayScore',1)));
  ASSERT reply->>'guardados'='1' AND jsonb_array_length(reply->'results')=2;
  ASSERT reply->'results'->1->>'status'='rejected', 'Closed target must be explicitly rejected';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=e AND match_id=closed);
  ASSERT (SELECT count(*)=1 FROM public.casa_pick_save_state WHERE entry_id=e), 'Storage must remain one row per entry';
  r:=(reply->>'revision')::bigint;
  UPDATE public.matches SET status='live',elapsed=1 WHERE id=m;
  ASSERT public.casa_save_picks_v1(p,u,e,c,2,pa||jsonb_build_array(jsonb_build_object('matchId',closed,'homeScore',1,'awayScore',1)))=reply,
    'Response-loss replay must remain identical after target closure';
  UPDATE public.matches SET status='scheduled',elapsed=0 WHERE id=m;
  reply:=public.casa_save_picks_v1(p,u,e,gen_random_uuid(),r,jsonb_build_array(jsonb_build_object('matchId',m,'homeScore',NULL,'awayScore',1)));
  ASSERT reply->>'guardados'='0' AND reply->'results'->0->>'status'='rejected', 'Incomplete score must never count saved';
  r:=(reply->>'revision')::bigint;
  UPDATE public.casa_picks SET home_score=4 WHERE entry_id=e AND match_id=m;
  ASSERT (public.casa_pick_save_state_v1(p,u,e)->>'revision')::bigint=r+1, 'A direct value update invalidates old versions';
  ASSERT public.casa_pick_save_state_v1(p,u,e)->'lastResult'='null'::jsonb;
  UPDATE public.casa_picks SET updated_at=clock_timestamp() WHERE entry_id=e;
  ASSERT (public.casa_pick_save_state_v1(p,u,e)->>'revision')::bigint=r+1, 'Timestamp-only update must not change revision';
  ASSERT NOT has_function_privilege('authenticated','public.casa_save_picks_v1(uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_pick_save_state_v1(uuid,uuid,uuid)','EXECUTE');
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop)
    VALUES(manual,'manual-save-'||manual,'Manual save fixture','manual','abierta',clock_timestamp()+interval '1 hour',u,0);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(manual,u,'pagada',0) RETURNING id INTO me;
  INSERT INTO public.casa_questions(id,polla_id,prompt,input_kind)
    VALUES(qt,manual,'Free answer','texto'),(qo,manual,'Own option','opciones'),(foreign_q,manual,'Other option','opciones');
  INSERT INTO public.casa_options(id,question_id,label) VALUES(own_opt,qo,'Own option'),(foreign_opt,foreign_q,'Foreign option');
  reply:=public.casa_save_picks_v1(manual,u,me,gen_random_uuid(),0,jsonb_build_array(
    jsonb_build_object('questionId',qt,'freeText','  Confirmed answer  '),jsonb_build_object('questionId',qo,'optionId',foreign_opt)));
  ASSERT reply->>'guardados'='1' AND reply->'results'->1->>'status'='rejected', 'A foreign option must be explicitly rejected';
  ASSERT reply->'results'->0->'values'->>'freeText'='Confirmed answer';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=me AND question_id=qo);
  UPDATE public.casa_questions SET resolved_text='Confirmed answer',resolved_at=clock_timestamp() WHERE id=qt;
  reply:=public.casa_save_picks_v1(manual,u,me,gen_random_uuid(),1,jsonb_build_array(
    jsonb_build_object('questionId',qt,'freeText','Late answer'),jsonb_build_object('questionId',qo,'optionId',own_opt)));
  ASSERT reply->>'guardados'='1' AND reply->'results'->0->>'status'='rejected', 'A resolved question cannot be changed';
  ASSERT (SELECT free_text='Confirmed answer' FROM public.casa_picks WHERE entry_id=me AND question_id=qt);
  ASSERT (SELECT option_id=own_opt FROM public.casa_picks WHERE entry_id=me AND question_id=qo);
  UPDATE public.casa_pollas SET opens_at=clock_timestamp()+interval '30 minutes' WHERE id=manual;
  BEGIN
    PERFORM public.casa_save_picks_v1(manual,u,me,gen_random_uuid(),2,jsonb_build_array(jsonb_build_object('questionId',qo,'optionId',own_opt)));
    RAISE EXCEPTION 'A scheduled pool accepted a new write before publication';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions WHERE match_id IN (m,closed));
  RAISE NOTICE 'PASS versioned A/B, replay after closure, partial and incomplete saves, manual option ownership, resolved questions, owner isolation, bounded state and direct-write invalidation';
END $$;
ROLLBACK;
