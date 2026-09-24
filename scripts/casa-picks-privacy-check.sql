-- LOCAL Docker only. Fresh fixtures are rolled back; never use production.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);

DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e uuid;
  question uuid:=gen_random_uuid(); option_question uuid:=gen_random_uuid(); option_id uuid:=gen_random_uuid();
  mid uuid; d jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1651'||substr(replace(u::text,'-',''),1,10),'Privacy fixture',true);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop)
    VALUES(p,'privacy-'||p,'Privacy fixture','manual','abierta',clock_timestamp()+interval '1 hour',u,0);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',0) RETURNING id INTO e;
  INSERT INTO public.casa_questions(id,polla_id,prompt,input_kind)
    VALUES(question,p,'Private free text','texto'),(option_question,p,'Private option','opciones');
  INSERT INTO public.casa_options(id,question_id,label) VALUES(option_id,option_question,'Option fixture');
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,question_id,free_text)
    VALUES(p,e,u,question,'Secret answer before lock');
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,question_id,option_id)
    VALUES(p,e,u,option_question,option_id);
  d:=public.casa_pick_distribution(p);
  ASSERT d->'preguntas'='{}'::jsonb, 'Editable question picks leaked from distribution RPC';
  RAISE NOTICE 'PASS manual option counts and free text stay private while editable';

  UPDATE public.casa_questions SET resolved_text='Secret answer before lock',resolved_at=clock_timestamp() WHERE id=question;
  d:=public.casa_pick_distribution(p);
  ASSERT d->'preguntas' ? question::text, 'Resolved question must be visible';
  ASSERT NOT (d->'preguntas' ? option_question::text), 'Unresolved editable question leaked beside a resolved one';
  UPDATE public.casa_pollas SET closes_at=clock_timestamp() WHERE id=p;
  d:=public.casa_pick_distribution(p);
  ASSERT (d->'preguntas'->option_question::text->'conteo'->>option_id::text)::integer=1,
    'Manual picks must become available exactly at the close';
  RAISE NOTICE 'PASS per-question resolution and pool deadline both enforce the lock';

  p:=gen_random_uuid();
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop)
    VALUES(p,'privacy-match-'||p,'Privacy match fixture','partidos','local_privacy','marcador','abierta',clock_timestamp()+interval '1 hour',u,0);
  mid:=public.upsert_match_safe('privacy-match-'||p,'local_privacy',1,'league','Home '||p,'Away '||p,
    NULL,NULL,clock_timestamp()+interval '1 hour',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',0) RETURNING id INTO e;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,mid,3,0);
  d:=public.casa_pick_distribution(p);
  ASSERT d->'marcador'='{}'::jsonb, 'Future match picks leaked';
  UPDATE public.matches SET scheduled_at=clock_timestamp()+interval '5 minutes' WHERE id=mid;
  d:=public.casa_pick_distribution(p);
  ASSERT d->'marcador'='{}'::jsonb, 'The five-minute lock must not publish before real kickoff';
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '5 minutes' WHERE id=mid;
  d:=public.casa_pick_distribution(p);
  ASSERT d->'marcador'='{}'::jsonb, 'Delayed scheduled match picks leaked';
  UPDATE public.matches SET status='live',live_status_detail='STATUS_SUSPENDED',elapsed=0 WHERE id=mid;
  d:=public.casa_pick_distribution(p);
  ASSERT d->'marcador'='{}'::jsonb, 'Suspended before kickoff picks leaked';
  UPDATE public.matches SET live_status_detail='STATUS_FIRST_HALF',elapsed=1 WHERE id=mid;
  d:=public.casa_pick_distribution(p);
  ASSERT (d->'marcador'->mid::text->'conteo'->>'3-0')::integer=1, 'Started match picks missing';
  ASSERT NOT has_function_privilege('anon','public.casa_pick_distribution(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_pick_distribution(uuid)','EXECUTE');
  RAISE NOTICE 'PASS match real-start privacy preserved and RPC inaccessible to browser roles';
END $$;
ROLLBACK;
