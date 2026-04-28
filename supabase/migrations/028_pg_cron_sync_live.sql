-- 028_pg_cron_sync_live.sql — Schedule del sync in-play via pg_cron.
--
-- Objetivo: que el sync-live corra cada 1 min sin depender de que un
-- usuario abra la app. Free-tier en Supabase incluye pg_cron + pg_net.
--
-- Componentes:
--   1. pg_net habilitado para hacer HTTP POST desde la DB.
--   2. Vault para guardar el CRON_SECRET cifrado (no committed en
--      texto plano).
--   3. Una función `public.trigger_sync_live()` que lee el secret y la
--      URL, y dispara el POST. Devuelve void; los errores se ignoran
--      (next minute reintenta).
--   4. cron.schedule cada 1 min llamando a la función.
--
-- Idempotente: re-ejecutable sin efectos secundarios. La magic está en
-- los `IF NOT EXISTS`/`OR REPLACE`/`unschedule` antes de re-schedule.
--
-- ⚠ Antes de aplicar esta migration: ejecutar UNA VEZ (por separado,
-- no en el repo) el SQL para guardar el CRON_SECRET en vault:
--
--   SELECT vault.create_secret(
--     '<CRON_SECRET_VALUE>'::text,
--     'app.cron_secret'::text,
--     'CRON_SECRET para llamar a /api/matches/sync-live desde pg_cron'
--   );
--
-- Si el secret ya existe (recreado en otra ocasión), update así:
--
--   UPDATE vault.secrets
--      SET secret = '<NUEVO_VALOR>'::text
--    WHERE name = 'app.cron_secret';

-- ─────────────────────────────────────────────────────────────────────
-- 1. Extensiones
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────
-- 2. App config para la URL del endpoint (no es secreto)
-- ─────────────────────────────────────────────────────────────────────
--
-- Mantenemos un único row con la base URL para que cambiar de dominio
-- (ej. lapollacolombiana.com → futuro custom) sea un UPDATE de 1 línea.

CREATE TABLE IF NOT EXISTS public.app_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_config (key, value)
VALUES ('app_base_url', 'https://lapollacolombiana.com')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Función que dispara el sync
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_sync_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url      text;
  v_secret   text;
  v_request_id bigint;
BEGIN
  -- Base URL desde app_config.
  SELECT value INTO v_url FROM public.app_config WHERE key = 'app_base_url';
  IF v_url IS NULL THEN
    RAISE NOTICE 'trigger_sync_live: app_base_url no configurado, abort';
    RETURN;
  END IF;

  -- Secret desde vault (cifrado en disco).
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'app.cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE NOTICE 'trigger_sync_live: app.cron_secret no en vault, abort';
    RETURN;
  END IF;

  -- Fire-and-forget POST. pg_net es asíncrono — el cron job termina
  -- inmediatamente; si la request falla o tarda, pg_net no bloquea.
  -- Tampoco importa el response: el endpoint responde 200 con JSON
  -- pero acá lo descartamos.
  v_request_id := net.http_post(
    url := v_url || '/api/matches/sync-live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  -- request_id se descarta pero queda en net._http_response para
  -- debugging si hace falta.
  PERFORM v_request_id;
END;
$$;

COMMENT ON FUNCTION public.trigger_sync_live IS
  'Disparado por pg_cron cada minuto. Hace HTTP POST a /api/matches/sync-live con el CRON_SECRET de vault. Fire-and-forget — la respuesta no se chequea acá.';

REVOKE ALL ON FUNCTION public.trigger_sync_live FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_sync_live TO postgres;

-- ─────────────────────────────────────────────────────────────────────
-- 4. cron.schedule
-- ─────────────────────────────────────────────────────────────────────
--
-- Si ya existe un job con este nombre, lo desprogramamos y lo
-- reprogramamos. Eso permite re-ejecutar la migration y cambiar la
-- frecuencia sin acumular jobs duplicados.

DO $$
BEGIN
  PERFORM cron.unschedule('sync-live-espn')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-espn');
EXCEPTION WHEN OTHERS THEN
  -- unschedule lanza si el job no existe; lo ignoramos.
  NULL;
END $$;

SELECT cron.schedule(
  'sync-live-espn',
  '* * * * *',  -- cada 1 minuto
  $$ SELECT public.trigger_sync_live() $$
);

COMMENT ON EXTENSION pg_net IS 'HTTP client desde Postgres. Usado por trigger_sync_live().';
