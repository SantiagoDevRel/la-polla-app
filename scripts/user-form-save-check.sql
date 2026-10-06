-- Disposable local fixtures only. No notifications or historical data writes.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
DO $$
DECLARE u uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); pool uuid:='85b88f91-7680-4241-9bf5-b37614cb520b';
  request_a uuid:=gen_random_uuid(); request_b uuid:=gen_random_uuid(); report_id uuid:=gen_random_uuid();
  answer jsonb; replay jsonb; affected integer; r bigint;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (u,'+1995'||substr(replace(u::text,'-',''),1,10),'Initial profile',true),
    (other,'+1994'||substr(replace(other::text,'-',''),1,10),'Other profile',false);
  ASSERT (SELECT profile_revision=0 FROM public.users WHERE id=u);
  UPDATE public.users SET display_name='Profile A' WHERE id=u AND profile_revision=0;
  ASSERT (SELECT profile_revision=1 FROM public.users WHERE id=u);
  UPDATE public.users SET display_name='Profile B' WHERE id=u AND profile_revision=1;
  UPDATE public.users SET display_name='Profile A' WHERE id=u AND profile_revision=0;
  GET DIAGNOSTICS affected=ROW_COUNT;
  ASSERT affected=0, 'A late profile PATCH must fail its version fence';
  ASSERT (SELECT display_name='Profile B' AND profile_revision=2 FROM public.users WHERE id=u);
  UPDATE public.users SET display_name='Profile B',profile_revision=1000 WHERE id=u;
  ASSERT (SELECT profile_revision=2 FROM public.users WHERE id=u), 'Clients cannot reset or inflate the revision';
  UPDATE public.users SET avatar_url='millos' WHERE id=u;
  ASSERT (SELECT profile_revision=3 FROM public.users WHERE id=u), 'All actual editable profile writes advance revision';

  INSERT INTO public.casa_pollas(id,slug,name,kind,entry_price_cop,house_cut_pct,prize_kind,prize_object,
    status,opens_at,closes_at,created_by)
    VALUES(pool,'contact-fixture-'||u,'Quentro contact fixture','manual',0,100,'objeto','Synthetic ticket',
      'abierta',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',u);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(pool,u,'pagada',0);
  PERFORM public.casa_save_prize_contact(pool,u,'a@example.test');
  ASSERT (SELECT save_revision=1 AND last_request_id IS NULL FROM public.casa_prize_contacts WHERE polla_id=pool AND user_id=u);
  -- A repeats the already stored email but arrives after B. It still cannot overwrite B.
  answer:=public.casa_save_prize_contact_v2(pool,u,'b@example.test',request_b,1);
  ASSERT answer->>'email'='b@example.test' AND answer->>'revision'='2' AND answer->>'request_id'=request_b::text;
  replay:=public.casa_save_prize_contact_v2(pool,u,'a@example.test',request_a,1);
  ASSERT replay->>'conflict'='true';
  ASSERT (SELECT email='b@example.test' AND save_revision=2 FROM public.casa_prize_contacts WHERE polla_id=pool AND user_id=u);
  ASSERT public.casa_save_prize_contact_v2(pool,u,'b@example.test',request_b,1)=answer, 'Same operation replay must not write again';
  BEGIN
    PERFORM public.casa_save_prize_contact_v2(pool,u,'c@example.test',request_b,1);
    RAISE EXCEPTION 'A request ID was reused for a different email';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.casa_save_prize_contact_v2(pool,other,'other@example.test',gen_random_uuid(),0);
    RAISE EXCEPTION 'A nonparticipant changed contact';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.casa_pollas SET status='resuelta' WHERE id=pool;
  replay:=public.casa_save_prize_contact_v2(pool,u,'b@example.test',request_b,1);
  ASSERT replay->>'email'='b@example.test' AND replay->>'editable'='false', 'Replay after closure confirms email but cannot reopen editing';
  ASSERT NOT has_function_privilege('authenticated','public.casa_save_prize_contact_v2(uuid,uuid,text,uuid,bigint)','EXECUTE');

  INSERT INTO public.feedback(user_id,message,page_url,request_id) VALUES(u,'Synthetic report','/polla/fixture',report_id);
  BEGIN
    INSERT INTO public.feedback(user_id,message,page_url,request_id) VALUES(u,'Synthetic report','/polla/fixture',report_id);
    RAISE EXCEPTION 'A report retry created a duplicate';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO public.feedback(user_id,message,page_url,request_id) VALUES(other,'Another account report','/perfil',report_id);
  INSERT INTO public.feedback(user_id,message,page_url) VALUES(u,'Legacy report 1','/perfil'),(u,'Legacy report 2','/perfil');
  ASSERT (SELECT count(*)=1 FROM public.feedback WHERE user_id=u AND request_id=report_id);
  ASSERT (SELECT count(*)=2 FROM public.feedback WHERE user_id=u AND request_id IS NULL);
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions);
  RAISE NOTICE 'PASS profile CAS, unchanged-value race, prize request replay/closure/authorization, feedback uniqueness and legacy compatibility';
END $$;
ROLLBACK;
