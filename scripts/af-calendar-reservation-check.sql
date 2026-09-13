-- LOCAL ONLY. Regresión de la migración 116 (reserva de calendario de API-Football).
-- Todo corre dentro de BEGIN...ROLLBACK: el contador, el plan y las reservas
-- que se tocan acá no sobreviven. Nunca contra producción.
--
-- Uso (Supabase local con la 116 ya aplicada, o encadenada en la misma transacción):
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < scripts/af-calendar-reservation-check.sql
BEGIN;

-- Permisos: ni anon ni authenticated ejecutan la función ni leen la tabla.
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.reserve_api_football_calendar(integer,text)', 'EXECUTE'), 'anon can execute';
  ASSERT NOT has_function_privilege('authenticated', 'public.reserve_api_football_calendar(integer,text)', 'EXECUTE'), 'authenticated can execute';
  ASSERT has_function_privilege('service_role', 'public.reserve_api_football_calendar(integer,text)', 'EXECUTE'), 'service_role cannot execute';
  ASSERT NOT has_table_privilege('anon', 'public.api_football_calendar_reservations', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has table access';
  ASSERT NOT has_table_privilege('authenticated', 'public.api_football_calendar_reservations', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has table access';
  -- Con varios privilegios has_table_privilege responde «alguno»: los de service_role van uno por uno.
  ASSERT has_table_privilege('service_role', 'public.api_football_calendar_reservations', 'SELECT')
    AND has_table_privilege('service_role', 'public.api_football_calendar_reservations', 'INSERT')
    AND has_table_privilege('service_role', 'public.api_football_calendar_reservations', 'UPDATE'), 'service_role lacks table access';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_football_calendar_reservations'::regclass), 'RLS disabled';
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'api_football_calendar_reservations' AND policyname = 'service_only'
    AND qual = 'false' AND with_check = 'false'), 'deny-all policy missing';
  ASSERT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc WHERE oid = 'public.reserve_api_football_calendar(integer,text)'::regprocedure), 'not SECURITY DEFINER with fixed search_path';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.reserve_api_football_calendar(140, 'fixtures');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'authenticated reserved a calendar request';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.api_football_calendar_reservations;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'anon read calendar reservations';
END $$;
RESET ROLE;

DO $$
DECLARE
  today date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  b public.api_football_budget%ROWTYPE;
  invalid integer := 0;
  granted integer;
  attempts integer;
  before_used integer;
BEGIN
  -- Estado conocido: plan Pro vigente y verificado, 100 usadas hoy, sin reservas vivas.
  INSERT INTO public.api_football_budget(singleton, request_day, last_attempt_at)
  VALUES (true, today, '-infinity') ON CONFLICT DO NOTHING;
  UPDATE public.api_football_budget SET plan = 'Pro', plan_expires_at = clock_timestamp() + interval '30 days',
    plan_checked_at = clock_timestamp(), request_day = today, requests_used = 100,
    calendar_day = today, calendar_requests_used = 0 WHERE singleton;
  UPDATE public.api_football_calendar_reservations SET reserved_at = '-infinity';

  -- Entradas inválidas lanzan (el llamador lo trata como «sin solicitud»).
  BEGIN PERFORM public.reserve_api_football_calendar(0, 'fixtures'); EXCEPTION WHEN raise_exception THEN invalid := invalid + 1; END;
  BEGIN PERFORM public.reserve_api_football_calendar(NULL, 'fixtures'); EXCEPTION WHEN raise_exception THEN invalid := invalid + 1; END;
  BEGIN PERFORM public.reserve_api_football_calendar(140, 'leagues'); EXCEPTION WHEN raise_exception THEN invalid := invalid + 1; END;
  BEGIN PERFORM public.reserve_api_football_calendar(140, 'teams'); EXCEPTION WHEN raise_exception THEN invalid := invalid + 1; END;
  BEGIN PERFORM public.reserve_api_football_calendar(140, NULL); EXCEPTION WHEN raise_exception THEN invalid := invalid + 1; END;
  ASSERT invalid = 5, format('invalid inputs accepted: %s of 5 raised', invalid);

  -- Candado de plan pagado (mismo predicado de 094). Ninguno incrementa.
  UPDATE public.api_football_budget SET plan = 'Free' WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'Free plan reserved';
  UPDATE public.api_football_budget SET plan = 'Pro', plan_expires_at = clock_timestamp() - interval '1 minute' WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'expired plan reserved';
  UPDATE public.api_football_budget SET plan_expires_at = NULL WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'plan without expiry reserved';
  UPDATE public.api_football_budget SET plan_expires_at = clock_timestamp() + interval '30 days',
    plan_checked_at = clock_timestamp() - interval '61 minutes' WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'stale plan check reserved';
  UPDATE public.api_football_budget SET plan_checked_at = NULL WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'unchecked plan reserved';
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 100 AND b.calendar_requests_used = 0, 'denied reservations incremented counters';
  ASSERT NOT EXISTS (SELECT 1 FROM public.api_football_calendar_reservations WHERE reserved_at > '-infinity'), 'denied reservation recorded';
  UPDATE public.api_football_budget SET plan_checked_at = clock_timestamp() WHERE singleton;

  -- Reserva concedida: +1 global y +1 calendario antes de volver true.
  ASSERT public.reserve_api_football_calendar(140, 'fixtures'), 'first fixtures reservation denied';
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 101 AND b.calendar_requests_used = 1 AND b.calendar_day = today AND b.request_day = today,
    format('counters after grant: %s/%s', b.requests_used, b.calendar_requests_used);
  ASSERT EXISTS (SELECT 1 FROM public.api_football_calendar_reservations
    WHERE league_id = 140 AND kind = 'fixtures' AND reserved_at > clock_timestamp() - interval '1 minute'), 'reservation not recorded';

  -- Intervalo por liga: 10 min para fixtures, 1 h para leagues (una llamada para todas).
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'same league within 10 minutes';
  ASSERT public.reserve_api_football_calendar(239, 'fixtures'), 'another league blocked by the first';
  ASSERT public.reserve_api_football_calendar(0, 'leagues'), 'leagues reservation denied';
  ASSERT NOT public.reserve_api_football_calendar(NULL, 'leagues'), 'second leagues call within the hour';
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 103 AND b.calendar_requests_used = 3, format('interval denials incremented: %s/%s', b.requests_used, b.calendar_requests_used);
  UPDATE public.api_football_calendar_reservations SET reserved_at = clock_timestamp() - interval '9 minutes' WHERE league_id = 140;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'fixtures reserved after 9 minutes';
  UPDATE public.api_football_calendar_reservations SET reserved_at = clock_timestamp() - interval '11 minutes' WHERE league_id = 140;
  ASSERT public.reserve_api_football_calendar(140, 'fixtures'), 'fixtures still blocked after 11 minutes';
  -- El ON CONFLICT debe mover reserved_at: sin eso, tras la primera ventana todo pasaría sin intervalo.
  ASSERT EXISTS (SELECT 1 FROM public.api_football_calendar_reservations
    WHERE league_id = 140 AND kind = 'fixtures' AND reserved_at > clock_timestamp() - interval '1 minute'), 're-reservation did not move reserved_at';
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'fixtures reserved twice after a re-reservation';
  UPDATE public.api_football_calendar_reservations SET reserved_at = clock_timestamp() - interval '59 minutes' WHERE kind = 'leagues';
  ASSERT NOT public.reserve_api_football_calendar(0, 'leagues'), 'leagues reserved after 59 minutes';
  UPDATE public.api_football_calendar_reservations SET reserved_at = clock_timestamp() - interval '61 minutes' WHERE kind = 'leagues';
  ASSERT public.reserve_api_football_calendar(0, 'leagues'), 'leagues still blocked after 61 minutes';

  -- Llamadas seguidas en la MISMA sentencia: una sola concesión y un solo incremento.
  SELECT requests_used INTO before_used FROM public.api_football_budget WHERE singleton;
  -- La referencia a g obliga a evaluar la función una vez por fila.
  SELECT count(*) FILTER (WHERE x.r), count(*) INTO granted, attempts
    FROM generate_series(1, 5) g
    CROSS JOIN LATERAL (SELECT public.reserve_api_football_calendar(78, 'fixtures') AS r WHERE g > 0) x;
  ASSERT attempts = 5 AND granted = 1, format('double call granted %s of %s', granted, attempts);
  ASSERT (SELECT requests_used FROM public.api_football_budget WHERE singleton) = before_used + 1, 'double call incremented twice';

  -- Tope global diario 7.000 (compartido con las otras reservas).
  UPDATE public.api_football_calendar_reservations SET reserved_at = '-infinity';
  UPDATE public.api_football_budget SET requests_used = 7000, calendar_requests_used = 10 WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'global cap exceeded';
  UPDATE public.api_football_budget SET requests_used = 6999 WHERE singleton;
  ASSERT public.reserve_api_football_calendar(140, 'fixtures'), 'request 7,000 denied';
  ASSERT (SELECT requests_used FROM public.api_football_budget WHERE singleton) = 7000, 'global counter not at cap';

  -- Sub-tope diario de calendario: 300.
  UPDATE public.api_football_calendar_reservations SET reserved_at = '-infinity';
  UPDATE public.api_football_budget SET requests_used = 500, calendar_requests_used = 300 WHERE singleton;
  ASSERT NOT public.reserve_api_football_calendar(140, 'fixtures'), 'calendar sub-cap exceeded';
  ASSERT NOT public.reserve_api_football_calendar(0, 'leagues'), 'leagues bypassed the calendar sub-cap';
  UPDATE public.api_football_budget SET calendar_requests_used = 299 WHERE singleton;
  ASSERT public.reserve_api_football_calendar(140, 'fixtures'), 'calendar request 300 denied';
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.calendar_requests_used = 300 AND b.requests_used = 501, 'sub-cap counters wrong';

  -- Día UTC nuevo: los dos contadores arrancan de cero (misma lógica que 094/095).
  UPDATE public.api_football_calendar_reservations SET reserved_at = '-infinity';
  UPDATE public.api_football_budget SET request_day = today - 1, requests_used = 7000,
    calendar_day = today - 1, calendar_requests_used = 300 WHERE singleton;
  ASSERT public.reserve_api_football_calendar(140, 'fixtures'), 'new UTC day kept yesterday caps';
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.request_day = today AND b.requests_used = 1 AND b.calendar_day = today AND b.calendar_requests_used = 1, 'day reset wrong';
  -- Fila anterior a la 116 (calendar_day NULL) cuenta como cero.
  UPDATE public.api_football_calendar_reservations SET reserved_at = '-infinity';
  UPDATE public.api_football_budget SET calendar_day = NULL, calendar_requests_used = 0 WHERE singleton;
  ASSERT public.reserve_api_football_calendar(140, 'fixtures'), 'NULL calendar_day denied';
  ASSERT (SELECT calendar_day = today AND calendar_requests_used = 1 FROM public.api_football_budget WHERE singleton), 'NULL calendar_day not initialized';

  -- Sin fila de presupuesto no hay solicitud (subtransacción descartada).
  BEGIN
    DELETE FROM public.api_football_budget WHERE singleton;
    ASSERT NOT public.reserve_api_football_calendar(61, 'fixtures'), 'reserved without a budget row';
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'discard';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
  ASSERT EXISTS (SELECT 1 FROM public.api_football_budget WHERE singleton), 'budget row not restored';

  RAISE NOTICE 'API-Football calendar reservation: grants, paid gate, caps, interval, counters and double call passed';
END $$;
ROLLBACK;
