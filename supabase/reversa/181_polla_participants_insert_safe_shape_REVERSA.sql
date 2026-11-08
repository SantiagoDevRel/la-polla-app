-- REVERSA of 181_polla_participants_insert_safe_shape.sql
-- Drops ONLY the policy that migration created. It touches nothing else:
-- no other policy, no grant, no row. Refuses unless the policy is exactly the
-- one that migration added (restrictive INSERT, authenticated, the safe-shape
-- check), so it cannot drop a different same-named policy created later.
begin;
-- Same pinned path as the migration so pg_policies text compares identically.
set local search_path = pg_catalog, public;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
set local idle_in_transaction_session_timeout = '3s';

do $guard$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_insert_restrict_safe_shape'
       and cmd='INSERT' and permissive='RESTRICTIVE'
       and roles = array['authenticated']::name[]
       and qual is null
       and with_check = '(((role)::text = ''player''::text) AND ((status)::text = ''pending''::text) AND (COALESCE(paid, false) = false) AND ((payment_status)::text = ''pending''::text))'
  ) then
    raise exception 'participants_insert_restrict_safe_shape is not in the expected state; stop';
  end if;
end;
$guard$;

drop policy participants_insert_restrict_safe_shape on public.polla_participants;

do $post$
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='polla_participants'
      and policyname='participants_insert_restrict_safe_shape'
  ) then
    raise exception 'Reversal did not remove the policy';
  end if;
  -- The two original policies remain untouched.
  if (select count(*) from pg_policies where schemaname='public' and tablename='polla_participants') <> 2 then
    raise exception 'Unexpected policy count after reversal';
  end if;
end;
$post$;

commit;
