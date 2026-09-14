-- 124_security_hardening.sql — endurecimiento previo al lanzamiento (2026-09-14).
--
-- Dos cambios independientes:
--
-- 1) is_approved_participant fuera de la Data API
-- ─────────────────────────────────────────────────
-- public.is_approved_participant(uuid) es SECURITY DEFINER y el advisor la
-- marca porque anon y authenticated la pueden llamar por /rest/v1/rpc. No se le
-- puede quitar EXECUTE a authenticated sin más: la política participants_select
-- de polla_participants la evalúa CON EL ROL DE QUIEN CONSULTA, y esa tabla la
-- leen por subconsulta las políticas pollas_select_active, pollas_update_admin y
-- predictions_select. Revocar a secas rompería esas lecturas con 42501.
--
-- Lo que se hace (patrón recomendado por Supabase para funciones de RLS):
--   · Copia idéntica en el esquema `private`, que PostgREST NO expone
--     (db_schema = public,graphql_public): la política la usa, nadie la llama
--     por RPC. authenticated conserva USAGE + EXECUTE para evaluar la política.
--   · participants_select pasa de TO public a TO authenticated. Para anon el
--     resultado no cambia: auth.uid() es NULL, ninguna de las dos ramas era
--     verdadera y seguía viendo cero filas; ahora las ve sin evaluar la función.
--   · La función de public se CONSERVA (no se borra nada) pero sin EXECUTE para
--     PUBLIC/anon/authenticated; solo service_role. Ningún código ni función la
--     llama (git grep y pg_proc.prosrc, 2026-09-14).
-- La función solo responde sobre auth.uid(): nunca revela participaciones de
-- otras personas. La semántica de las cuatro políticas queda idéntica.
--
-- 2) Disparador fiable de /api/cron/backup-freshness
-- ────────────────────────────────────────────────────
-- Los schedules de GitHub Actions llegan 3–4 h tarde, y la alerta de backup
-- atrasado solo sirve si corre a tiempo. pg_cron llama cada hora (minuto 25) a
-- la ruta con el mismo patrón de trigger_sync_live()/trigger_discover_tournaments():
-- URL en app_config.app_base_url y secreto en vault 'app.cron_secret' (el mismo
-- valor que CRON_SECRET en Vercel). La ruta exige Authorization: Bearer
-- (requireCronSecret), no x-cron-secret. El workflow de GitHub queda como
-- segundo disparador. Ningún secreto se escribe en esta migración.

-- ─────────────────────────────────────────────────────────────────────
-- 1. private.is_approved_participant + política
-- ─────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_approved_participant(p_polla_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.polla_participants
    WHERE polla_id = p_polla_id
      AND user_id = auth.uid()
      AND status = 'approved'
  )
$$;

COMMENT ON FUNCTION private.is_approved_participant(uuid) IS
  'RLS de polla_participants (participants_select). Solo responde sobre auth.uid(). Fuera de la Data API a propósito (migración 124).';

REVOKE ALL ON FUNCTION private.is_approved_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_approved_participant(uuid) TO authenticated, service_role;

ALTER POLICY participants_select ON public.polla_participants
  TO authenticated
  USING (
    user_id = auth.uid()
    OR private.is_approved_participant(polla_id)
  );

REVOKE EXECUTE ON FUNCTION public.is_approved_participant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_participant(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. trigger_backup_freshness + cron horario
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_backup_freshness()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'app_base_url';
  IF v_url IS NULL THEN
    RAISE NOTICE 'trigger_backup_freshness: app_base_url no configurado, abort';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'app.cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE NOTICE 'trigger_backup_freshness: app.cron_secret no en vault, abort';
    RETURN;
  END IF;

  v_request_id := net.http_post(
    url := v_url || '/api/cron/backup-freshness',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  PERFORM v_request_id;
END;
$$;

COMMENT ON FUNCTION public.trigger_backup_freshness() IS
  'pg_cron (minuto 25 de cada hora) → POST /api/cron/backup-freshness. Secreto en vault app.cron_secret. Migración 124.';

REVOKE ALL ON FUNCTION public.trigger_backup_freshness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_backup_freshness() TO postgres, service_role;

-- Idempotente: si el job existe se desprograma y se vuelve a crear.
-- Sin pg_cron (stack local) se avisa y se sigue: prod sí lo tiene.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '124: pg_cron no está instalado; no se programa backup-freshness-hourly';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backup-freshness-hourly') THEN
    PERFORM cron.unschedule('backup-freshness-hourly');
  END IF;
  PERFORM cron.schedule(
    'backup-freshness-hourly',
    '25 * * * *',
    $cron$ SELECT public.trigger_backup_freshness() $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
