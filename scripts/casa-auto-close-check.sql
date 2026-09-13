-- LOCAL ONLY. Regresión de la migración 118: el cierre automático de Casa sigue
-- al calendario. Todo corre dentro de BEGIN...ROLLBACK: partidos, pollas y
-- modos que se tocan acá no sobreviven. Nunca contra producción.
--
-- Uso con la 118 todavía sin aplicar (migración y regresión en la misma transacción):
--   ( echo 'BEGIN;'; cat supabase/migrations/118_casa_auto_close_follows_calendar.sql; \
--     sed '/^BEGIN;$/d;/^ROLLBACK;$/d' scripts/casa-auto-close-check.sql; echo 'ROLLBACK;' ) \
--     | docker exec -i supabase_db_la-polla psql -U postgres -d postgres -v ON_ERROR_STOP=1
BEGIN;
DO $$
DECLARE
  base timestamptz := date_trunc('hour', now()) + interval '3 days';
  v_admin uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid;
  v_auto uuid; v_manual uuid; v_closed uuid;
  t timestamptz; res jsonb; day3 timestamptz;
BEGIN
  -- Permisos: nada de esto se ejecuta desde el cliente.
  ASSERT NOT has_function_privilege('anon', 'public.casa_recompute_auto_close(uuid)', 'EXECUTE'), 'anon executes recompute';
  ASSERT NOT has_function_privilege('authenticated', 'public.casa_recompute_auto_close(uuid)', 'EXECUTE'), 'authenticated executes recompute';
  ASSERT has_function_privilege('service_role', 'public.casa_recompute_auto_close(uuid)', 'EXECUTE'), 'service_role cannot recompute';
  ASSERT NOT has_function_privilege('authenticated', 'public.casa_auto_close_after_schedule_change()', 'EXECUTE'), 'authenticated executes schedule trigger';

  SELECT id INTO v_admin FROM public.users WHERE is_admin LIMIT 1;
  ASSERT v_admin IS NOT NULL, 'The local database needs one admin user';

  m2 := public.upsert_match_safe('auto-close-118:2', 'auto_close_118', 1, 'regular_season',
    'Cierre Local A', 'Cierre Visitante A', null, null, base + interval '2 days', null, null, null, 'scheduled', null, null, null, true);
  day3 := date_trunc('day', base + interval '1 day', 'UTC');
  -- Hora por confirmar: solo la fecha (medianoche UTC, migración 103).
  m3 := public.upsert_match_safe('auto-close-118:3', 'auto_close_118', 1, 'regular_season',
    'Cierre Local B', 'Cierre Visitante B', null, null, day3, null, null, null, 'scheduled', null, null, null, false);

  res := public.casa_create_polla_v2(jsonb_build_object(
    'kind', 'partidos', 'name', 'Cierre automático 118', 'entryPriceCop', 0, 'houseCutPct', 0,
    'closesAt', to_char(base + interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'closeMode', 'auto',
    'prizeKind', 'pozo', 'potMode', 'proporcional', 'publicationMode', 'oculta',
    'tournament', 'premier_2025', 'scoringMode', '1x2', 'matchIds', jsonb_build_array(m2, m3)
  ), 'cierre-automatico-118', v_admin, 2);
  v_auto := (res->>'id')::uuid;
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto) = day3 - interval '5 minutes',
    'Creation with a provisional match must close on its provisional kickoff';

  -- El calendario confirma la hora del provisional: el cierre la sigue.
  PERFORM public.upsert_match_safe('auto-close-118:3', 'auto_close_118', 1, 'regular_season',
    'Cierre Local B', 'Cierre Visitante B', null, null, day3 + interval '20 hours', null, null, null, 'scheduled', null, null, null, true);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto) = day3 + interval '20 hours' - interval '5 minutes',
    'Confirmed kickoff did not move the automatic close';

  -- Ese partido se reprograma después del otro: manda el siguiente primer partido.
  PERFORM public.upsert_match_safe('auto-close-118:3', 'auto_close_118', 1, 'regular_season',
    'Cierre Local B', 'Cierre Visitante B', null, null, base + interval '6 days', null, null, null, 'scheduled', null, null, null, true);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto) = base + interval '2 days' - interval '5 minutes',
    'Rescheduled first match did not hand the close to the next one';

  -- Vincular un partido más temprano adelanta el cierre.
  m4 := public.upsert_match_safe('auto-close-118:4', 'auto_close_118', 1, 'regular_season',
    'Cierre Local C', 'Cierre Visitante C', null, null, base + interval '12 hours', null, null, null, 'scheduled', null, null, null, true);
  PERFORM set_config('app.casa_contract', '2', true);
  INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index) VALUES (v_auto, m4, 2);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto) = base + interval '12 hours' - interval '5 minutes',
    'Linking an earlier match did not move the close';

  -- Un adelanto confirmado del proveedor también adelanta el cierre.
  PERFORM public.upsert_match_safe('auto-close-118:4', 'auto_close_118', 1, 'regular_season',
    'Cierre Local C', 'Cierre Visitante C', null, null, base + interval '10 hours', null, null, null, 'scheduled', null, null, null, true);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto) = base + interval '10 hours' - interval '5 minutes',
    'An earlier confirmed kickoff did not move the close earlier';

  -- Cierre manual: nunca se toca.
  res := public.casa_create_polla_v2(jsonb_build_object(
    'kind', 'partidos', 'name', 'Cierre manual 118', 'entryPriceCop', 0, 'houseCutPct', 0,
    'closesAt', to_char(base + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'closeMode', 'manual',
    'prizeKind', 'pozo', 'potMode', 'proporcional', 'publicationMode', 'oculta',
    'tournament', 'premier_2025', 'scoringMode', '1x2', 'matchIds', jsonb_build_array(m2)
  ), 'cierre-manual-118', v_admin, 2);
  v_manual := (res->>'id')::uuid;
  PERFORM public.upsert_match_safe('auto-close-118:2', 'auto_close_118', 1, 'regular_season',
    'Cierre Local A', 'Cierre Visitante A', null, null, base + interval '3 days', null, null, null, 'scheduled', null, null, null, true);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_manual) = base + interval '1 hour', 'Manual close was recomputed';

  -- Una polla cuyo cierre ya pasó no se reabre.
  m5 := public.upsert_match_safe('auto-close-118:5', 'auto_close_118', 1, 'regular_season',
    'Cierre Local D', 'Cierre Visitante D', null, null, base + interval '1 day', null, null, null, 'scheduled', null, null, null, true);
  res := public.casa_create_polla_v2(jsonb_build_object(
    'kind', 'partidos', 'name', 'Cierre pasado 118', 'entryPriceCop', 0, 'houseCutPct', 0,
    'closesAt', to_char(base + interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'closeMode', 'auto',
    'prizeKind', 'pozo', 'potMode', 'proporcional', 'publicationMode', 'oculta',
    'tournament', 'premier_2025', 'scoringMode', '1x2', 'matchIds', jsonb_build_array(m5)
  ), 'cierre-pasado-118', v_admin, 2);
  v_closed := (res->>'id')::uuid;
  UPDATE public.casa_pollas SET closes_at = now() - interval '1 minute' WHERE id = v_closed;
  PERFORM public.upsert_match_safe('auto-close-118:5', 'auto_close_118', 1, 'regular_season',
    'Cierre Local D', 'Cierre Visitante D', null, null, base + interval '4 days', null, null, null, 'scheduled', null, null, null, true);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_closed) = now() - interval '1 minute', 'A closed pool was reopened';

  -- Con Casa en pausa el calendario sigue escribiendo; el cierre queda igual.
  t := (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto);
  UPDATE public.casa_operation_control SET mode = 'paused' WHERE singleton;
  PERFORM public.upsert_match_safe('auto-close-118:4', 'auto_close_118', 1, 'regular_season',
    'Cierre Local C', 'Cierre Visitante C', null, null, base + interval '8 hours', null, null, null, 'scheduled', null, null, null, true);
  ASSERT (SELECT scheduled_at FROM public.matches WHERE id = m4) = base + interval '8 hours', 'Casa pause blocked a calendar write';
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_auto) = t, 'Paused Casa still changed a close';

  RAISE NOTICE 'Migration 118: auto close follows provisional, confirmed and rescheduled kickoffs; manual close, no reopen and pause isolation passed';
END $$;
ROLLBACK;
