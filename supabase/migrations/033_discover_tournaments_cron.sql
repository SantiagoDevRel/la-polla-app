-- 033_discover_tournaments_cron — Cron 6h que descubre fixtures
-- nuevos vía ESPN para tournaments con TBD placeholders sin promover
-- o pollas activas con scope dinámico.
--
-- Gate de free-tier: solo dispara HTTP a Vercel cuando hay trabajo
-- real. Si todos los matches del torneo ya están sync-eados (no hay
-- home_team='TBD' rows con external_id placeholder) AND no hay pollas
-- scope!='custom' activas, el SQL gate retorna y NO hay invocación a
-- Vercel — cero costo.

CREATE OR REPLACE FUNCTION public.trigger_discover_tournaments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url      text;
  v_secret   text;
  v_request_id bigint;
  v_tournaments_pending int;
BEGIN
  SELECT COUNT(DISTINCT m.tournament) INTO v_tournaments_pending
    FROM public.matches m
   WHERE m.home_team = 'TBD'
     AND m.external_id LIKE 'placeholder:%';

  IF v_tournaments_pending = 0 THEN
    DECLARE
      v_dynamic int;
    BEGIN
      SELECT COUNT(*) INTO v_dynamic
        FROM public.pollas
       WHERE status = 'active' AND scope != 'custom';
      IF v_dynamic = 0 THEN
        RETURN;
      END IF;
    END;
  END IF;

  SELECT value INTO v_url FROM public.app_config WHERE key = 'app_base_url';
  IF v_url IS NULL THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'app.cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  v_request_id := net.http_post(
    url := v_url || '/api/matches/discover',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  PERFORM v_request_id;
END;
$$;

COMMENT ON FUNCTION public.trigger_discover_tournaments IS
  'Cron 6h: discover fixtures nuevos via ESPN para tournaments con placeholders TBD o pollas scope dinámico activas. En reposo (todo sync) NO hace HTTP — gate sql in-process.';

REVOKE ALL ON FUNCTION public.trigger_discover_tournaments FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_discover_tournaments TO postgres;

DO $$
BEGIN
  PERFORM cron.unschedule('discover-tournaments')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'discover-tournaments');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'discover-tournaments',
  '0 */6 * * *',
  $job$ SELECT public.trigger_discover_tournaments() $job$
);
