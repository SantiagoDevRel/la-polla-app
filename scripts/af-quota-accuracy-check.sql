-- LOCAL ONLY. Regresión de la migración 123 (contador de API-Football fiel a
-- /status y conteo de intentos de verificación). Todo corre dentro de
-- BEGIN...ROLLBACK: nada sobrevive. Nunca contra producción.
--
-- Uso (Supabase local; si le faltan, la 116 y la 123 van encadenadas en la misma transacción):
--   (echo 'BEGIN;'; cat supabase/migrations/116_api_football_calendar_reservation.sql \
--      supabase/migrations/123_api_football_quota_accuracy.sql; \
--    sed '1,/^BEGIN;$/d' scripts/af-quota-accuracy-check.sql) \
--   | docker exec -i supabase_db_la-polla psql -U postgres -d postgres -v ON_ERROR_STOP=1
BEGIN;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.record_api_football_account(text,timestamptz,integer,integer,timestamptz)', 'EXECUTE'), 'anon can record';
  ASSERT NOT has_function_privilege('authenticated', 'public.record_api_football_account(text,timestamptz,integer,integer,timestamptz)', 'EXECUTE'), 'authenticated can record';
  ASSERT has_function_privilege('service_role', 'public.record_api_football_account(text,timestamptz,integer,integer,timestamptz)', 'EXECUTE'), 'service_role cannot record';
  ASSERT NOT has_function_privilege('anon', 'public.note_api_football_verify_attempts(uuid[],uuid[],integer)', 'EXECUTE'), 'anon can note';
  ASSERT NOT has_function_privilege('authenticated', 'public.note_api_football_verify_attempts(uuid[],uuid[],integer)', 'EXECUTE'), 'authenticated can note';
  ASSERT has_function_privilege('service_role', 'public.note_api_football_verify_attempts(uuid[],uuid[],integer)', 'EXECUTE'), 'service_role cannot note';
  ASSERT NOT has_table_privilege('anon', 'public.api_football_verify_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has table access';
  ASSERT NOT has_table_privilege('authenticated', 'public.api_football_verify_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has table access';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_football_verify_attempts'::regclass), 'RLS disabled';
  ASSERT (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc
    WHERE oid IN ('public.record_api_football_account(text,timestamptz,integer,integer,timestamptz)'::regprocedure,
                  'public.note_api_football_verify_attempts(uuid[],uuid[],integer)'::regprocedure)), 'not SECURITY DEFINER with fixed search_path';
  -- La firma vieja sigue existiendo para el código ya desplegado.
  ASSERT to_regprocedure('public.record_api_football_account(text,timestamptz,integer,integer)') IS NOT NULL, 'old signature removed';
END $$;

DO $$
DECLARE
  today date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  b public.api_football_budget%ROWTYPE;
  read_at timestamptz;
  m uuid;
  r record;
BEGIN
  DELETE FROM public.api_football_cache;
  DELETE FROM public.api_football_details;
  DELETE FROM public.api_football_teams;
  DELETE FROM public.api_football_calendar_reservations;
  INSERT INTO public.api_football_budget(singleton, request_day, last_attempt_at)
  VALUES (true, today, '-infinity') ON CONFLICT DO NOTHING;

  -- 1) Lectura fresca: el contador inflado baja al valor del proveedor (sin GREATEST).
  UPDATE public.api_football_budget SET request_day = today, requests_used = 1996,
    provider_read_at = NULL, provider_requests_used = NULL WHERE singleton;
  PERFORM public.record_api_football_account('Pro', clock_timestamp() + interval '20 days', 863, 7500, clock_timestamp() - interval '2 seconds');
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 863 AND b.provider_requests_used = 863 AND b.plan = 'Pro', format('fresh read: %s', b.requests_used);

  -- 2) Día nuevo: arranca en el valor del proveedor, no en el conteo de ayer.
  UPDATE public.api_football_budget SET request_day = today - 1, requests_used = 4200, provider_read_at = NULL WHERE singleton;
  PERFORM public.record_api_football_account('Pro', clock_timestamp() + interval '20 days', 12, 7500, clock_timestamp() - interval '1 second');
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.request_day = today AND b.requests_used = 12, format('day reset: %s %s', b.request_day, b.requests_used);

  -- 3) Reservas hechas DESPUÉS de la lectura se suman: cache +1, detalle +1, equipo +4, calendario +1.
  UPDATE public.api_football_budget SET provider_read_at = clock_timestamp() - interval '30 seconds' WHERE singleton;
  read_at := clock_timestamp() - interval '5 seconds';
  INSERT INTO public.api_football_cache(fixture_date, last_attempt_at) VALUES (today, clock_timestamp());
  INSERT INTO public.api_football_cache(fixture_date, last_attempt_at) VALUES (today - 1, read_at - interval '1 minute'); -- anterior: no suma
  INSERT INTO public.api_football_details(fixture_id, last_attempt_at) VALUES (1, clock_timestamp());
  INSERT INTO public.api_football_teams(team_id, last_attempt_at) VALUES (2, clock_timestamp());
  INSERT INTO public.api_football_calendar_reservations(league_id, kind, reserved_at) VALUES (239, 'fixtures', clock_timestamp());
  PERFORM public.record_api_football_account('Pro', clock_timestamp() + interval '20 days', 100, 7500, read_at);
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 107 AND b.provider_requests_used = 100, format('later reservations: %s', b.requests_used);

  -- 4) Lectura vieja (más de 50 s) no infla ni baja el contador; el plan sí se registra.
  PERFORM public.record_api_football_account('Pro', clock_timestamp() + interval '20 days', 5000, 7500, clock_timestamp() - interval '10 minutes');
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 107 AND b.plan_checked_at >= clock_timestamp() - interval '5 seconds', format('stale read changed counter: %s', b.requests_used);

  -- 5) Lectura fuera de orden (anterior a la registrada) tampoco.
  PERFORM public.record_api_football_account('Pro', clock_timestamp() + interval '20 days', 9999, 7500, read_at - interval '1 second');
  SELECT * INTO b FROM public.api_football_budget WHERE singleton;
  ASSERT b.requests_used = 107, format('out-of-order read changed counter: %s', b.requests_used);

  -- 6) Plan vencido o límite Free: queda Free.
  PERFORM public.record_api_football_account('Pro', clock_timestamp() - interval '1 minute', 50, 7500, clock_timestamp());
  ASSERT (SELECT plan FROM public.api_football_budget WHERE singleton) = 'Free', 'expired plan kept Pro';

  -- 7) Lecturas inválidas.
  BEGIN
    PERFORM public.record_api_football_account('Pro', clock_timestamp(), 1, 7500, clock_timestamp() + interval '5 minutes');
    ASSERT false, 'future read accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.record_api_football_account('Pro', clock_timestamp(), -1, 7500, clock_timestamp());
    ASSERT false, 'negative usage accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- 8) Intentos de verificación: suma por tick, aviso una sola vez y solo a los alertables.
  SELECT id INTO m FROM public.matches LIMIT 1;
  IF m IS NOT NULL THEN
    DELETE FROM public.api_football_verify_attempts WHERE match_id = m;
    FOR i IN 1..4 LOOP
      SELECT * INTO r FROM public.note_api_football_verify_attempts(ARRAY[m], ARRAY[m], 5);
      ASSERT r.attempts = i AND NOT r.alert, format('attempt %s: %s %s', i, r.attempts, r.alert);
    END LOOP;
    SELECT * INTO r FROM public.note_api_football_verify_attempts(ARRAY[m, gen_random_uuid()], ARRAY[m], 5);
    ASSERT r.attempts = 5 AND r.alert, 'alert not claimed at threshold';
    ASSERT (SELECT count(*) FROM public.note_api_football_verify_attempts(ARRAY[m], ARRAY[m], 5) x WHERE x.alert) = 0, 'alert claimed twice';
    ASSERT (SELECT count(*) FROM public.api_football_verify_attempts WHERE match_id NOT IN (SELECT id FROM public.matches)) = 0, 'unknown match stored';
    DELETE FROM public.api_football_verify_attempts WHERE match_id = m;
    FOR i IN 1..6 LOOP
      SELECT * INTO r FROM public.note_api_football_verify_attempts(ARRAY[m], '{}'::uuid[], 5);
      ASSERT NOT r.alert, 'non-alertable match alerted';
    END LOOP;
  ELSE
    RAISE NOTICE 'Sin partidos locales: se omite la prueba de intentos.';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.record_api_football_account('Pro', clock_timestamp(), 1, 7500, clock_timestamp());
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'authenticated recorded an account read';
END $$;
RESET ROLE;

SELECT 'af-quota-accuracy-check OK' AS result;
ROLLBACK;
