-- 117_backup_runs.sql — bitácora de corridas del backup del DGX.
--
-- ops/backup/run-backup.sh y verify-snapshots.sh insertan UNA fila al terminar
-- (bien o mal) vía PostgREST con la secret key del backup. El cron
-- /api/cron/backup-freshness (GitHub Actions, cada hora) lee la última corrida
-- buena y le escribe al admin si el backup o la verificación se atrasaron.
--
-- Por qué en la DB y no solo en status/*.json del DGX: si el DGX se apaga o
-- pierde la red, nadie lee ese archivo. Aquí la ausencia de filas nuevas ES la
-- alerta (dead man's switch): no depende de que el DGX esté vivo para avisar.
--
-- Sin datos personales: solo conteos, nombre del snapshot, commit del runner
-- y un texto de error que arma el propio script (fases y cifras, nunca filas).
-- Los CHECK de formato limitan lo que puede entrar aunque el script cambie.
--
-- Acceso: SOLO service_role, y solo SELECT + INSERT (nadie edita ni borra la
-- bitácora desde la Data API). anon/authenticated: sin GRANT y con RLS
-- deny-all explícito, por si un GRANT futuro se colara.
-- Crecimiento: ~5 filas/día (4 backups + 1 verificación) ≈ 1.800/año.

CREATE TABLE IF NOT EXISTS public.backup_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL CHECK (kind IN ('backup', 'verify', 'drill')),
  status          text        NOT NULL CHECK (status IN ('ok', 'failed')),
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz NOT NULL,
  snapshot_name   text        CHECK (snapshot_name ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}\.tar\.zst\.gpg$'),
  bytes           bigint      CHECK (bytes >= 0),
  tables          integer     CHECK (tables >= 0),
  rows            bigint      CHECK (rows >= 0),
  auth_users      integer     CHECK (auth_users >= 0),
  storage_objects integer     CHECK (storage_objects >= 0),
  runner_commit   text        CHECK (runner_commit ~ '^([0-9a-f]{7,40}|unknown)$'),
  error           text        CHECK (char_length(error) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Mismo reloj (el del DGX) para las dos marcas; un margen de 5 min cubre un
  -- ajuste de NTP a mitad de corrida.
  CONSTRAINT backup_runs_finished_after_started CHECK (finished_at >= started_at - interval '5 minutes'),
  CONSTRAINT backup_runs_ok_has_no_error CHECK (status = 'failed' OR error IS NULL)
);

COMMENT ON TABLE public.backup_runs IS
  'Corridas del backup cifrado del DGX (ops/backup). Sin PII. Solo service_role. La lee /api/cron/backup-freshness.';

CREATE INDEX IF NOT EXISTS backup_runs_kind_finished_idx
  ON public.backup_runs (kind, finished_at DESC);

-- RLS primero (regla #1), con deny-all explícito para los roles cliente.
-- service_role bypassa RLS y es el único con GRANT.
ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backup_runs_no_client_access ON public.backup_runs;
CREATE POLICY backup_runs_no_client_access ON public.backup_runs
  AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Supabase auto-otorga ALL a anon/authenticated/service_role en tablas nuevas
-- de public (default privileges): se revoca todo y se da lo mínimo.
REVOKE ALL ON TABLE public.backup_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.backup_runs FROM anon;
REVOKE ALL ON TABLE public.backup_runs FROM authenticated;
REVOKE ALL ON TABLE public.backup_runs FROM service_role;
GRANT SELECT, INSERT ON TABLE public.backup_runs TO service_role;

NOTIFY pgrst, 'reload schema';
