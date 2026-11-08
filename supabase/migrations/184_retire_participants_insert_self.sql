-- 184_retire_participants_insert_self.sql
-- Security follow-up (seguridad4 lane, 2026-11-08) to finding S1 of the
-- 2026-11-07 audit. Drops ONE policy: participants_insert_self, created by
-- 001_initial_schema.sql and unchanged since (permissive INSERT, roles public,
-- WITH CHECK user_id = auth.uid()). No other policy, grant, table or row changes.
--
-- Why it is safe: no app path inserts into polla_participants as the signed-in
-- user. Every insert runs on the service role, which bypasses RLS:
--   app/api/pollas/route.ts (creator auto-join), app/api/pollas/[slug]/join,
--   app/api/pollas/join-by-code via lib/pollas/join.ts, and
--   app/(app)/invites/[token]/page.tsx, all on createAdminClient().
-- No SQL function inserts into this table. Casa pools never use it: entries,
-- proofs and approvals live in casa_entries and the casa_* RPCs.
-- Since migration 181 the only rows this policy still admitted were
-- player/pending/unpaid self-joins; with it gone, RLS refuses every direct
-- authenticated or anon insert. The 181 RESTRICTIVE policy stays as a second
-- fence in case a permissive INSERT policy is ever added again.
--
-- Reverse: supabase/reversa/184_retire_participants_insert_self_REVERSA.sql
-- (recreates the 001 policy). Reverse 184 before 181: the 181 reversal expects
-- the two original policies.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
set local idle_in_transaction_session_timeout = '3s';

do $guard$
begin
  if not exists (
    select 1 from pg_class where oid = 'public.polla_participants'::regclass and relrowsecurity
  ) then
    raise exception '184: RLS is not enabled on public.polla_participants; stop';
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='polla_participants') <> 3 then
    raise exception '184: unexpected policy set; stop. Found: %', (select json_agg(row_to_json(x)) from (select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public' and tablename='polla_participants' order by policyname) x);
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_insert_self' and cmd='INSERT' and permissive='PERMISSIVE'
       and roles = array['public']::name[]
       and qual is null and with_check = '(user_id = auth.uid())'
  ) then
    raise exception '184: participants_insert_self is not the 001 policy; stop';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_insert_restrict_safe_shape' and cmd='INSERT'
       and permissive='RESTRICTIVE' and roles = array['authenticated']::name[]
  ) or not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_select' and cmd='SELECT' and permissive='PERMISSIVE'
       and qual = '((user_id = auth.uid()) OR private.is_approved_participant(polla_id))'
  ) then
    raise exception '184: the 181 restrictive policy or participants_select drifted; stop';
  end if;
end;
$guard$;

drop policy participants_insert_self on public.polla_participants;

do $post$
begin
  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and cmd in ('INSERT','ALL') and permissive='PERMISSIVE'
  ) then
    raise exception '184: a permissive INSERT policy remains';
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='polla_participants') <> 2 then
    raise exception '184: unexpected policy count after apply';
  end if;
end;
$post$;

commit;
