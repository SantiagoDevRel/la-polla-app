-- Synthetic users in a disposable database. No real accounts or data.
-- Proves migration 181: a signed-in user cannot self-insert a privileged
-- polla_participants row (admin, approved, paid or a non-pending payment),
-- cannot insert a row for someone else, and the plain player/pending/unpaid
-- shape is not refused by RLS.
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
  -- The plain join shape must pass RLS and the table check. Migration 183 makes
  -- a fresh database allow 'pending' like production, so the row is stored.
  INSERT INTO public.polla_participants(polla_id,user_id,role,status,paid,payment_status)
    VALUES(current_setting('test.polla')::uuid,auth.uid(),'player','pending',false,'pending');
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.polla_participants
    WHERE polla_id=current_setting('test.polla')::uuid
      AND (role<>'player' OR status<>'pending' OR coalesce(paid,false) OR payment_status<>'pending')),
    'A privileged row was stored';
  ASSERT (SELECT count(*) FROM public.polla_participants
    WHERE polla_id=current_setting('test.polla')::uuid
      AND user_id=current_setting('test.attacker')::uuid)=1,
    'The plain pending join row was not stored exactly once';
END $$;
ROLLBACK;
