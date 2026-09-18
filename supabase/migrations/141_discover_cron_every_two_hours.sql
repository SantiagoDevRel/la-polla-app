-- 141 — El cron de calendario pasa de cada 6 h a cada 2 h.
--
-- Por qué: `refreshAfSchedules` recorre las ligas EN SERIE y no arranca una
-- liga nueva pasados 35 s, porque la función de Vercel se corta a los 60 s. Las
-- que no alcanzan quedan 'not_started' y la corrida siguiente las toma primero
-- (el orden sale de `schedule_<t>.updated_at`). Con diez ligas una corrida las
-- cubría todas; desde el 2026-09-18 son veintiuna y ya no entran en una sola
-- pasada, así que una liga podía pasar más de medio día sin refrescarse.
--
-- Tres corridas por cada una de antes devuelven a cada liga la frescura que
-- tenía. No cuesta plata (pg_cron) ni cuota del proveedor: son 21 solicitudes
-- de calendario por vuelta completa contra un techo propio de 7.000 al día, y
-- `reserve_tournament_schedule_sync` sigue dejando UN refresco por liga cada
-- 15 minutos, así que acercar las corridas no multiplica el trabajo.
--
-- Solo cambia la programación: `trigger_discover_tournaments()` queda igual.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '141: pg_cron no está instalado; no se reprograma discover-tournaments';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'discover-tournaments') THEN
    PERFORM cron.unschedule('discover-tournaments');
  END IF;
  PERFORM cron.schedule(
    'discover-tournaments',
    '0 */2 * * *',
    $cron$ SELECT public.trigger_discover_tournaments() $cron$
  );
END $$;

COMMENT ON FUNCTION public.trigger_discover_tournaments IS
  'Cron cada 2 h: pide /api/matches/discover, que refresca el calendario de API-Football liga por liga con la reserva compartida de 15 minutos. Cada 2 h y no cada 6 porque las 21 ligas no entran en una sola corrida de 60 s.';
