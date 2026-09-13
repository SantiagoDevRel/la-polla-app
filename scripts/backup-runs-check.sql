-- scripts/backup-runs-check.sql — regresión de acceso de public.backup_runs (migración 117).
--
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < supabase/migrations/117_backup_runs.sql
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/backup-runs-check.sql
--
-- ⚠️ SOLO contra un Supabase LOCAL. Todo corre dentro de una transacción que
-- termina en ROLLBACK: no deja filas ni GRANTs.
--
-- Qué asegura (cada caso falla con ASSERT/RAISE si cambia):
--   A · RLS habilitado y la política deny-all existe
--   B · anon y authenticated no pueden leer ni insertar (sin GRANT)
--   C · aunque alguien les diera GRANT por error, RLS sigue negando todo
--   D · service_role inserta y lee, pero no edita, no borra ni trunca
--   E · los CHECK rechazan kind/status/snapshot/commit/error fuera de formato
\set ON_ERROR_STOP on
BEGIN;

-- ── A · RLS + política ───────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.backup_runs'::regclass),
    'A: RLS no está habilitado en backup_runs';
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'backup_runs'
      AND policyname = 'backup_runs_no_client_access'
      AND qual = 'false' AND with_check = 'false'
  ), 'A: falta la política deny-all';
  ASSERT NOT has_table_privilege('anon', 'public.backup_runs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
    'A: anon tiene algún privilegio sobre backup_runs';
  ASSERT NOT has_table_privilege('authenticated', 'public.backup_runs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
    'A: authenticated tiene algún privilegio sobre backup_runs';
  ASSERT has_table_privilege('service_role', 'public.backup_runs', 'SELECT')
     AND has_table_privilege('service_role', 'public.backup_runs', 'INSERT'),
    'A: service_role no puede leer/insertar';
  ASSERT NOT has_table_privilege('service_role', 'public.backup_runs', 'UPDATE,DELETE,TRUNCATE'),
    'A: service_role puede editar/borrar la bitácora';
  RAISE NOTICE 'A ok';
END $$;

-- Fila de referencia (como postgres).
INSERT INTO public.backup_runs (kind, status, started_at, finished_at, snapshot_name, bytes, tables, rows, auth_users, storage_objects, runner_commit)
VALUES ('backup', 'ok', now() - interval '10 minutes', now(), '2026-09-13-17-10.tar.zst.gpg', 15000000, 58, 40452, 297, 119, 'e88580a1b2c3');

-- ── B · anon / authenticated sin GRANT ───────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    BEGIN
      PERFORM 1 FROM public.backup_runs;
      RAISE EXCEPTION 'B: % pudo leer backup_runs', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.backup_runs (kind, status, started_at, finished_at) VALUES ('backup', 'ok', now(), now());
      RAISE EXCEPTION 'B: % pudo insertar en backup_runs', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'B ok';
END $$;

-- ── C · GRANT accidental: RLS sigue negando ──────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_runs TO anon, authenticated;
DO $$
DECLARE r text; n int;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    SELECT count(*) INTO n FROM public.backup_runs;
    ASSERT n = 0, format('C: %s ve %s fila(s) con un GRANT accidental', r, n);
    BEGIN
      INSERT INTO public.backup_runs (kind, status, started_at, finished_at) VALUES ('backup', 'ok', now(), now());
      RAISE EXCEPTION 'C: % insertó pese a RLS', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- 42501: new row violates row-level security policy
    END;
    UPDATE public.backup_runs SET error = 'x';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, format('C: %s editó %s fila(s)', r, n);
    DELETE FROM public.backup_runs;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, format('C: %s borró %s fila(s)', r, n);
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'C ok';
END $$;
REVOKE ALL ON public.backup_runs FROM anon, authenticated;

-- ── D · service_role ─────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.backup_runs (kind, status, started_at, finished_at, runner_commit, error)
  VALUES ('verify', 'failed', now() - interval '1 minute', now(), 'unknown', 'falló en la fase: sha256');
  SELECT count(*) INTO n FROM public.backup_runs;
  ASSERT n >= 2, 'D: service_role no ve las filas';
  BEGIN
    UPDATE public.backup_runs SET error = NULL;
    RAISE EXCEPTION 'D: service_role pudo editar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.backup_runs;
    RAISE EXCEPTION 'D: service_role pudo borrar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'D ok';
END $$;

-- ── E · CHECK de formato ─────────────────────────────────────────────────
DO $$
DECLARE
  bad text[] := ARRAY[
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at) VALUES ('restore', 'ok', now(), now())$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at) VALUES ('backup', 'degraded', now(), now())$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at, snapshot_name) VALUES ('backup', 'ok', now(), now(), '+573001234567.json')$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at, runner_commit) VALUES ('backup', 'ok', now(), now(), 'Juan Pérez')$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at, error) VALUES ('backup', 'failed', now(), now(), repeat('x', 501))$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at, error) VALUES ('backup', 'ok', now(), now(), 'no debería tener error')$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at, rows) VALUES ('backup', 'ok', now(), now(), -1)$q$,
    $q$INSERT INTO public.backup_runs (kind, status, started_at, finished_at) VALUES ('backup', 'ok', now(), now() - interval '1 hour')$q$
  ];
  q text;
BEGIN
  FOREACH q IN ARRAY bad LOOP
    BEGIN
      EXECUTE q;
      RAISE EXCEPTION 'E: se aceptó un valor inválido: %', q;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'E ok';
END $$;

ROLLBACK;
\echo 'backup-runs-check: todo OK'
