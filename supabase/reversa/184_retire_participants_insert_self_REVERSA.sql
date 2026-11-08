-- REVERSA of 184_retire_participants_insert_self.sql
-- Recreates participants_insert_self exactly as 001_initial_schema.sql created
-- it (permissive INSERT, roles public, WITH CHECK user_id = auth.uid()). It
-- touches nothing else. With the 181 RESTRICTIVE policy still present, the
-- restored policy again admits only player/pending/unpaid self-joins.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
set local idle_in_transaction_session_timeout = '3s';

do $guard$
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='polla_participants'
      and policyname='participants_insert_self'
  ) then
    raise exception 'REVERSA 184: participants_insert_self already exists; stop';
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='polla_participants') <> 2 then
    raise exception 'REVERSA 184: unexpected policy set; stop';
  end if;
end;
$guard$;

create policy participants_insert_self on public.polla_participants
  for insert
  with check (user_id = auth.uid());

do $post$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='polla_participants'
       and policyname='participants_insert_self' and cmd='INSERT' and permissive='PERMISSIVE'
       and roles = array['public']::name[]
       and qual is null and with_check = '(user_id = auth.uid())'
  ) then
    raise exception 'REVERSA 184: restored policy differs from 001';
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='polla_participants') <> 3 then
    raise exception 'REVERSA 184: unexpected policy count after reversal';
  end if;
end;
$post$;

commit;
