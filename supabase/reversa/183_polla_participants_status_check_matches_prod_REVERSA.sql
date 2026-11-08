-- REVERSA of 183_polla_participants_status_check_matches_prod.sql
-- Puts back the 010 text ('approved','rejected') only where 183 changed the
-- constraint (it left the comment marker). Where 183 was a no-op (production),
-- this is a no-op too: production allowed 'pending' before 183 and still does.
-- Refuses if a pending row exists, because the 010 text would reject it; no row
-- is deleted or changed.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
set local idle_in_transaction_session_timeout = '3s';

do $r$
declare
  c_oid oid;
  def text;
  marker text;
begin
  select c.oid, pg_get_constraintdef(c.oid) into c_oid, def
    from pg_constraint c
   where c.conrelid = 'public.polla_participants'::regclass
     and c.conname = 'polla_participants_status_check'
     and c.contype = 'c';
  marker := obj_description(c_oid, 'pg_constraint');

  if marker is distinct from '183 widened this from the 010 text to the production text' then
    raise notice 'REVERSA 183: 183 did not change this database; nothing to reverse';
    return;
  end if;
  if def is distinct from 'CHECK (((status)::text = ANY ((ARRAY[''pending''::character varying, ''approved''::character varying, ''rejected''::character varying])::text[])))' then
    raise exception 'REVERSA 183: unexpected definition %; stop', def;
  end if;
  if exists (select 1 from public.polla_participants where status = 'pending') then
    raise exception 'REVERSA 183: pending rows exist and the 010 check would reject them; stop';
  end if;

  alter table public.polla_participants drop constraint polla_participants_status_check;
  alter table public.polla_participants
    add constraint polla_participants_status_check
    check (status in ('approved', 'rejected'));
end;
$r$;

commit;
