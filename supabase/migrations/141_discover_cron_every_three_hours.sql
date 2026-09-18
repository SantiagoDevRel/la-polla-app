-- 141 — El cron de calendario pasa de cada 6 h a cada 3 h.
--
-- Por qué: `refreshAfSchedules` recorre las ligas EN SERIE y no arranca una
-- liga nueva pasados 35 s, porque la función de Vercel se corta a los 60 s. Las
-- que no alcanzan quedan 'not_started' y la corrida siguiente las toma primero
-- (el orden sale de `schedule_<t>.updated_at`). Con diez ligas una corrida las
-- cubría todas; desde el 2026-09-18 son veintiuna y ya no entran en una sola
-- pasada, así que una liga podía pasar más de medio día sin refrescarse.
--
-- El doble de corridas devuelve a cada liga la frescura que tenía. Por qué 3 h
-- y no 2: el sub-tope de CALENDARIO son 300 solicitudes por día UTC
-- (migración 116) y cada corrida gasta una por liga. Con veintiuna ligas:
--   cada 6 h →  4 corridas → hasta  84/día (28 % del sub-tope)
--   cada 3 h →  8 corridas → hasta 168/día (56 %)
--   cada 2 h → 12 corridas → hasta 252/día (84 %)  ← sin aire para nada más
-- A 2 h un día con reintentos o un refresco manual desde el panel puede tocar
-- el techo y dejar una liga sin actualizar, que es justo lo que se quería
-- evitar. 3 h mejora la frescura y deja casi la mitad del sub-tope libre.
--
-- No cuesta plata: pg_cron es de Supabase y el endpoint es una función de
-- Vercel más por corrida (de 4 a 8 invocaciones al día).
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
    '0 */3 * * *',
    $cron$ SELECT public.trigger_discover_tournaments() $cron$
  );
END $$;

COMMENT ON FUNCTION public.trigger_discover_tournaments IS
  'Cron cada 3 h: pide /api/matches/discover, que refresca el calendario de API-Football liga por liga con la reserva compartida de 15 minutos. Cada 3 h y no cada 6 porque las 21 ligas no entran en una sola corrida de 60 s; no menos, porque el sub-tope de calendario son 300 solicitudes por día UTC.';
