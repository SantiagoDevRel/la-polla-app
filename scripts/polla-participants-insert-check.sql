-- Synthetic users in a disposable database. No real accounts or data.
-- Proves migrations 181 and 184: a signed-in user cannot insert any
-- polla_participants row directly (privileged shapes since 181, every shape
-- since 184 retired participants_insert_self), not even for someone else,
-- while the service role, the only legitimate writer, still can.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE owner uuid:=gen_random_uuid(); attacker uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
BEGIN
  PERFORM set_config('test.owner',owner::text,true);
  PERFORM set_config('test.attacker',attacker::text,true);
  PERFORM set_config('test.polla',p::text,true);
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (owner,'+1995'||substr(replace(owner::text,'-',''),1,10),'Insert check owner',false),
    (attacker,'+1995'||substr(replace(attacker::text,'-',''),1,10),'Insert check attacker',false);
  INSERT INTO public.pollas(id,slug,name,created_by,tournament,scope)
    VALUES(p,'ins-'||substr(replace(p::text,'-',''),1,12),'Insert check fixture',owner,'worldcup_2026','full');
  ASSERT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='polla_participants'
    AND policyname='participants_insert_restrict_safe_shape' AND permissive='RESTRICTIVE'), 'Restrictive policy missing';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.attacker'),'role','authenticated')::text,true);
DO $$
DECLARE
  shapes text[][]:=ARRAY[
    ['admin','pending','false','pending'],
    ['player','approved','false','pending'],
    ['player','pending','true','pending'],
    ['admin','approved','true','pending']];
  i int; refused boolean;
BEGIN
  ASSERT auth.uid()=current_setting('test.attacker')::uuid, 'JWT did not propagate';
  FOR i IN 1..array_length(shapes,1) LOOP
    refused:=false;
    BEGIN
      INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid)
        VALUES(current_setting('test.polla')::uuid,auth.uid(),shapes[i][1],shapes[i][2],shapes[i][3]::boolean);
    EXCEPTION WHEN insufficient_privilege THEN refused:=true;
    END;
    ASSERT refused, format('Privileged self-insert %s was accepted', shapes[i]);
  END LOOP;
  -- payment_status other than pending is refused too.
  refused:=false;
  BEGIN
    INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid,payment_status)
      VALUES(current_setting('test.polla')::uuid,auth.uid(),'player','pending',false,'approved');
  EXCEPTION WHEN insufficient_privilege THEN refused:=true;
  END;
  ASSERT refused, 'Self-insert with a non-pending payment_status was accepted';
  -- A safe-shape row for another user stays refused by participants_insert_self.
  refused:=false;
  BEGIN
    INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid,payment_status)
      VALUES(current_setting('test.polla')::uuid,current_setting('test.owner')::uuid,'player','pending',false,'pending');
  EXCEPTION WHEN insufficient_privilege THEN refused:=true;
  END;
  ASSERT refused, 'Insert for another user was accepted';
  -- Since 184 the plain join shape is refused by RLS too; joins go through
  -- the service role (createAdminClient) in the server routes.
  refused:=false;
  BEGIN
    INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid,payment_status)
      VALUES(current_setting('test.polla')::uuid,auth.uid(),'player','pending',false,'pending');
  EXCEPTION WHEN insufficient_privilege THEN refused:=true;
  END;
  ASSERT refused, 'A direct self-join was accepted; participants_insert_self is still active';
END $$;
RESET ROLE;
-- anon cannot insert either.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$
DECLARE refused boolean:=false;
BEGIN
  BEGIN
    INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid,payment_status)
      VALUES(current_setting('test.polla')::uuid,current_setting('test.attacker')::uuid,'player','pending',false,'pending');
  EXCEPTION WHEN insufficient_privilege THEN refused:=true;
  END;
  ASSERT refused, 'An anon insert was accepted';
END $$;
RESET ROLE;
-- The server join path: service_role bypasses RLS and stores the approved row.
SET LOCAL ROLE service_role;
INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid,payment_status)
  VALUES(current_setting('test.polla')::uuid,current_setting('test.attacker')::uuid,'player','approved',false,'pending');
RESET ROLE;
DO $$
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='polla_participants'
    AND cmd IN ('INSERT','ALL') AND permissive='PERMISSIVE'), 'A permissive INSERT policy remains';
  ASSERT (SELECT count(*) FROM public.polla_participants
    WHERE polla_id=current_setting('test.polla')::uuid)=1, 'Only the service-role join row may exist';
  ASSERT (SELECT status FROM public.polla_participants
    WHERE polla_id=current_setting('test.polla')::uuid
      AND user_id=current_setting('test.attacker')::uuid)='approved', 'The service-role join row is missing';
END $$;
ROLLBACK;
