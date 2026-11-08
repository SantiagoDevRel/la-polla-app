-- 183_polla_participants_status_check_matches_prod.sql
-- Repo/production drift fix (seguridad4 lane, 2026-11-08). Records in the repo
-- chain the polla_participants_status_check that production already has.
--
-- Migration 010 narrowed the check to ('approved','rejected'). Production then
-- received an unrecorded fix (version 20260418220550,
-- fix_polla_participants_status_constraint) that allows 'pending' again:
--   CHECK (status IN ('pending','approved','rejected'))
-- A fresh database built from this repo therefore refused a pending row that
-- production accepts. This file makes a fresh database match production.
--
-- Production: a no-op. When the constraint already has the production text,
-- this file changes nothing (no DDL, no comment, no row). It changes the
-- constraint only when it finds exactly the 010 text, and stops on any other
-- definition. No row is read or written beyond the constraint validation.
-- Reverse: supabase/reversa/183_polla_participants_status_check_matches_prod_REVERSA.sql
begin;
-- pg_get_constraintdef output does not depend on search_path for this check,
-- but pin it like 181 so the guard compares the same text on every runner.
set local search_path = pg_catalog, public;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
set local idle_in_transaction_session_timeout = '3s';

do $m$
declare
  def text;
  prod_def constant text := 'CHECK (((status)::text = ANY ((ARRAY[''pending''::character varying, ''approved''::character varying, ''rejected''::character varying])::text[])))';
  repo_010_def constant text := 'CHECK (((status)::text = ANY ((ARRAY[''approved''::character varying, ''rejected''::character varying])::text[])))';
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.polla_participants'::regclass
     and c.conname = 'polla_participants_status_check'
     and c.contype = 'c';

  if def = prod_def then
    raise notice '183: polla_participants_status_check already matches production; nothing changed';
    return;
  end if;
  if def is distinct from repo_010_def then
    raise exception '183: unexpected polla_participants_status_check definition %; stop', coalesce(def, '<missing>');
  end if;

  alter table public.polla_participants drop constraint polla_participants_status_check;
  alter table public.polla_participants
    add constraint polla_participants_status_check
    check (status in ('pending', 'approved', 'rejected'));
  -- Marker for the reversal: only a database this file actually changed is
  -- put back to the 010 text. Production never gets this comment.
  comment on constraint polla_participants_status_check on public.polla_participants is
    '183 widened this from the 010 text to the production text';
end;
$m$;

do $post$
begin
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.polla_participants'::regclass
         and c.conname = 'polla_participants_status_check')
     is distinct from 'CHECK (((status)::text = ANY ((ARRAY[''pending''::character varying, ''approved''::character varying, ''rejected''::character varying])::text[])))' then
    raise exception '183: post-state does not match production';
  end if;
end;
$post$;

commit;
