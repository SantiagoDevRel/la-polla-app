-- Two synthetic sessions in a disposable database. No real accounts or data.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
DO $$
DECLARE u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); e uuid;
BEGIN
  PERFORM set_config('test.u1',u1::text,true); PERFORM set_config('test.u2',u2::text,true);
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (u1,'+1994'||substr(replace(u1::text,'-',''),1,10),'RLS player one',false),
    (u2,'+1994'||substr(replace(u2::text,'-',''),1,10),'RLS player two',false);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,publication_mode,opens_at)
    VALUES(p,'rls-'||p,'RLS fixture','manual','abierta',clock_timestamp()+interval '1 hour',u1,0,'ahora',clock_timestamp());
  INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind) VALUES(q,p,'Private answer',3,'texto');
  e:=(public.casa_join_free_v1(p,u1,2)->>'entry_id')::uuid;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,question_id,free_text) VALUES(p,e,u1,q,'First private answer');
  e:=(public.casa_join_free_v1(p,u2,2)->>'entry_id')::uuid;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,question_id,free_text) VALUES(p,e,u2,q,'Second private answer');
  ASSERT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.casa_entries'::regclass,'public.casa_picks'::regclass));
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.u1'),'role','authenticated')::text,true);
DO $$
BEGIN
  ASSERT auth.uid()=current_setting('test.u1')::uuid, 'First JWT did not propagate';
  ASSERT (SELECT count(*)=1 FROM public.casa_entries WHERE user_id=auth.uid());
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE user_id=current_setting('test.u2')::uuid), 'Other entries leaked';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE user_id=current_setting('test.u2')::uuid), 'Other predictions leaked before closure';
  ASSERT NOT has_function_privilege(current_user,'public.casa_join_free_v1(uuid,uuid,integer)','EXECUTE');
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.u2'),'role','authenticated')::text,true);
DO $$
BEGIN
  ASSERT auth.uid()=current_setting('test.u2')::uuid, 'Second JWT did not propagate';
  ASSERT (SELECT count(*)=1 FROM public.casa_entries WHERE user_id=auth.uid());
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE user_id=current_setting('test.u1')::uuid), 'First entries leaked';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE user_id=current_setting('test.u1')::uuid), 'First predictions leaked';
END $$;
RESET ROLE;
ROLLBACK;
