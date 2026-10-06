-- Fresh disposable PostgreSQL fixtures; no provider messages.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); answer jsonb; replay jsonb;
  phone text:='573001234567'; salt text:=repeat('a',32); hash_a text:=repeat('a',128); hash_b text:=repeat('b',128);
BEGIN
  INSERT INTO auth.users(id,phone,phone_confirmed_at) VALUES(u,phone,clock_timestamp());
  INSERT INTO public.phone_password_credentials(user_id,phone_number,salt,password_hash) VALUES(u,phone,salt,hash_a);
  ASSERT (SELECT credential_revision=1 AND last_request_id IS NULL FROM public.phone_password_credentials WHERE user_id=u);
  UPDATE public.phone_password_credentials SET password_hash=hash_b WHERE user_id=u;
  ASSERT (SELECT credential_revision=2 FROM public.phone_password_credentials WHERE user_id=u);
  answer:=public.phone_password_save_v1(u,phone,req,1,salt,hash_a);
  ASSERT answer->>'conflict'='true', 'Old deployment writes must invalidate new stale requests';
  answer:=public.phone_password_save_v1(u,phone,req,2,salt,hash_a);
  ASSERT answer->>'revision'='3' AND answer->>'ok'='true';
  replay:=public.phone_password_save_v1(u,phone,req,2,salt,hash_a);
  ASSERT replay=answer, 'An accepted request must replay without changing its revision';
  BEGIN
    PERFORM public.phone_password_save_v1(u,phone,req,2,salt,hash_b);
    RAISE EXCEPTION 'Changed payload reused request ID';
  EXCEPTION WHEN invalid_parameter_value THEN
    ASSERT SQLERRM='PASSWORD_REQUEST_REUSED';
  END;
  BEGIN
    UPDATE public.phone_password_credentials SET password_hash=hash_b WHERE user_id=u;
    RAISE EXCEPTION 'Late unversioned deployment overwrote a fenced credential';
  EXCEPTION WHEN invalid_parameter_value THEN
    ASSERT SQLERRM='PASSWORD_VERSION_REQUIRED';
  END;
  answer:=public.phone_password_save_v1(u,phone,gen_random_uuid(),3,salt,hash_b);
  ASSERT answer->>'revision'='4';
  answer:=public.phone_password_save_v1(u,phone,req,2,salt,hash_a);
  ASSERT answer->>'conflict'='true';
  ASSERT (SELECT credential_revision=4 AND password_hash=hash_b FROM public.phone_password_credentials WHERE user_id=u);
  BEGIN
    PERFORM public.phone_password_save_v1(u,'573001234568',gen_random_uuid(),4,salt,hash_a);
    RAISE EXCEPTION 'Wrong verified phone accepted';
  EXCEPTION WHEN invalid_parameter_value THEN ASSERT SQLERRM='PASSWORD_OWNER_CHANGED'; END;
  ASSERT NOT has_function_privilege('authenticated','public.phone_password_save_v1(uuid,text,uuid,bigint,text,text)','execute');
  ASSERT NOT has_function_privilege('anon','public.phone_password_save_v1(uuid,text,uuid,bigint,text,text)','execute');
  ASSERT has_function_privilege('service_role','public.phone_password_save_v1(uuid,text,uuid,bigint,text,text)','execute');
END $$;
ROLLBACK;
