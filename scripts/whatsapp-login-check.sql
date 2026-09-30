-- No persistent writes: assertions use only synthetic tokens and a transaction rollback.
BEGIN;
DO $$
DECLARE p text := '991' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
        h text; i integer;
BEGIN
  FOR i IN 1..5 LOOP
    h := 'wa2:' || encode(sha256((p || i)::bytea),'hex');
    ASSERT public.wa_issue_login_link(h,p,now()+interval '10 minutes') = 'issued';
    ASSERT public.wa_issue_login_link(h,p,now()+interval '10 minutes') = 'retry';
  END LOOP;
  ASSERT public.wa_issue_login_link('wa2:' || encode(sha256((p || '6')::bytea),'hex'),p,now()+interval '10 minutes') = 'limited';
  UPDATE public.wa_magic_tokens SET consumed_at=now() WHERE token=h;
  ASSERT public.wa_issue_login_link(h,p,now()+interval '10 minutes') = 'ignored';
  ASSERT public.wa_issue_login_link('rawtoken',p,now()+interval '10 minutes') = 'ignored';
  ASSERT public.wa_issue_login_link(h,p,now()-interval '1 minute') = 'ignored';
  ASSERT NOT has_function_privilege('anon','public.wa_issue_login_link(text,text,timestamptz)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.wa_issue_login_link(text,text,timestamptz)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.wa_issue_login_link(text,text,timestamptz)','EXECUTE');
END $$;
ROLLBACK;
