-- 181_polla_participants_insert_safe_shape.sql
-- Prepared by the seguridad2 lane for Supervision (la-polla security audit,
-- 2026-11-07, finding S1). Additive only: this file CREATEs one RESTRICTIVE
-- INSERT policy and changes nothing that already exists. No DROP, no ALTER,
-- no GRANT/REVOKE, no data change. Reverse: drop only the new policy.
--
-- Why: public.polla_participants has RLS on with one permissive INSERT policy,
-- participants_insert_self, whose WITH CHECK is only (user_id = auth.uid()).
-- authenticated holds the INSERT grant, so a signed-in user can POST to
-- /rest/v1/polla_participants with their own user_id but any role, status and
-- paid for a polla_id they merely know (the id is returned by the public
-- /api/pollas/preview for a slug). A self-inserted role='admin' row makes the
-- live P2P routes treat the caller as the pool admin (they read the role from
-- this table), and a status='approved' row satisfies participants_select /
-- private.is_approved_participant so the caller can read every participant's
-- payout_account. Demonstrated in an isolated PostgreSQL 17 fixture on
-- 2026-11-07 against the live policy and grant set (read-only catalog copy).
-- Every legitimate insert into this table in the app code goes through the
-- service role (createAdminClient), which bypasses RLS, so constraining the
-- authenticated role breaks no legitimate flow (verified 2026-11-07: the only
-- inserts are app/api/pollas/route.ts creator auto-join, app/api/pollas/[slug]/
-- join/route.ts, lib/pollas/join.ts and app/(app)/invites/[token]/page.tsx, all
-- on the admin client).
--
-- Rule: a direct authenticated self-insert is allowed only in the harmless
-- shape a brand-new join would take: role 'player', status 'pending', not paid,
-- payment_status 'pending'. The existing permissive policy still requires
-- user_id = auth.uid(); this restrictive policy ANDs the safe shape on top.
-- An admin/approved/paid self-insert is refused. The service role is unaffected
-- (it bypasses RLS). anon cannot produce a useful row (auth.uid() is null, so
-- participants_insert_self already rejects it).
--
-- polla_invites is deliberately NOT touched: its live policy set has no INSERT
-- policy at all, so with RLS enabled every direct authenticated/anon insert is
-- already denied by default. Adding a policy there is unnecessary.
--
-- The DELETE route and payout-summary server-side authorization are a separate
-- code change (PROPUESTA, no la-polla deploy tonight).
--
-- Production: applied 2026-11-07 as version 20261107200349. On 2026-11-08 the
-- seguridad3 lane added only the search_path pin and the "Found: %" detail in
-- the drift errors so the guard gives the same verdict in a fresh replay; the
-- created policy, its comment and every guard condition are unchanged. Do not
-- re-apply in production.
begin;
-- pg_policies deparses expressions against the current search_path: a session
-- whose path includes auth prints auth.uid() as uid(). Pin the path so the
-- drift guard below compares the same text on every runner (production SQL
-- editor, migration tools, the isolated CI replay). No object is created in
-- or resolved from this path; every name below is schema-qualified.
set local search_path = pg_catalog, public;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
set local idle_in_transaction_session_timeout = '3s';

do $guard$
declare
  n_pp int;
  n_new int;
begin
  -- Table and RLS must be exactly as audited.
  if to_regclass('public.polla_participants') is null then
    raise exception 'public.polla_participants is required; no changes applied';
  end if;
  if not exists (
    select 1 from pg_class where oid = 'public.polla_participants'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.polla_participants; stop';
  end if;

  -- Known-good current policy set (drift guard): exactly the two audited
  -- policies, with their exact command, permissiveness, roles and expressions.
  select count(*) into n_pp from pg_policies
   where schemaname = 'public' and tablename = 'polla_participants';
  if n_pp <> 2 then
    raise exception 'Unexpected policy count % on public.polla_participants; stop', n_pp;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_insert_self' and cmd='INSERT' and permissive='PERMISSIVE'
       and roles = array['public']::name[]
       and qual is null and with_check = '(user_id = auth.uid())'
  ) then
    raise exception 'participants_insert_self drift; stop. Found: %', (select json_agg(row_to_json(x)) from (select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public' and tablename='polla_participants' order by policyname) x);
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_select' and cmd='SELECT' and permissive='PERMISSIVE'
       and roles = array['authenticated']::name[]
       and with_check is null
       and qual = '((user_id = auth.uid()) OR private.is_approved_participant(polla_id))'
  ) then
    raise exception 'participants_select drift; stop. Found: %', (select json_agg(row_to_json(x)) from (select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public' and tablename='polla_participants' order by policyname) x);
  end if;

  -- The restrictive policy is meaningful only while authenticated can insert.
  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='polla_participants'
       and grantee='authenticated' and privilege_type='INSERT'
  ) then
    raise exception 'authenticated has no INSERT grant on polla_participants; nothing to restrict, stop';
  end if;

  -- Never create a second copy.
  select count(*) into n_new from pg_policies
   where schemaname='public' and tablename='polla_participants'
     and policyname='participants_insert_restrict_safe_shape';
  if n_new <> 0 then
    raise exception 'participants_insert_restrict_safe_shape already exists; stop';
  end if;
end;
$guard$;

create policy participants_insert_restrict_safe_shape
  on public.polla_participants
  as restrictive
  for insert
  to authenticated
  with check (
    (role)::text = 'player'
    and (status)::text = 'pending'
    and coalesce(paid, false) = false
    and (payment_status)::text = 'pending'
  );

comment on policy participants_insert_restrict_safe_shape on public.polla_participants is
  'Additive mitigation (security audit 2026-11-07, S1). A direct authenticated self-insert is restricted to the harmless join shape (player/pending/unpaid); admin/approved/paid self-inserts are refused. Legitimate inserts use the service role and bypass RLS. Reverse: supabase/reversa/20261108_0000_polla_participants_insert_safe_shape_REVERSA.sql.';

do $post$
begin
  -- The new policy is present, restrictive, INSERT, authenticated, with the exact check.
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_insert_restrict_safe_shape'
       and cmd='INSERT' and permissive='RESTRICTIVE'
       and roles = array['authenticated']::name[]
       and qual is null
       and with_check = '(((role)::text = ''player''::text) AND ((status)::text = ''pending''::text) AND (COALESCE(paid, false) = false) AND ((payment_status)::text = ''pending''::text))'
  ) then
    raise exception 'Unexpected post-state for participants_insert_restrict_safe_shape';
  end if;
  -- The two pre-existing policies are still exactly as before; nothing else was added.
  if (select count(*) from pg_policies where schemaname='public' and tablename='polla_participants') <> 3 then
    raise exception 'Unexpected policy count on public.polla_participants after apply';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='polla_participants'
      and policyname='participants_insert_self' and with_check='(user_id = auth.uid())' and permissive='PERMISSIVE'
  ) or not exists (
    select 1 from pg_policies where schemaname='public' and tablename='polla_participants'
      and policyname='participants_select'
      and qual='((user_id = auth.uid()) OR private.is_approved_participant(polla_id))' and permissive='PERMISSIVE'
  ) then
    raise exception 'A pre-existing policy changed; stop';
  end if;
end;
$post$;

commit;
