-- scripts/casa-pending-picks-check.sql — regla del dueño (2026-09-15): quien
-- se inscribe (envía el comprobante) ya puede pronosticar; los puntos cuentan en
-- la tabla solo cuando el pago se aprueba, y si se aprueba DESPUÉS de jugarse
-- los partidos, los puntos aparecen retroactivos. Aplica igual a la web y al bot
-- de Telegram (los dos guardan con lib/casa/picks-save.ts).
--
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-pending-picks-check.sql
--
-- ⚠️ SOLO contra un Supabase LOCAL. Todo corre dentro de una transacción que
-- termina en ROLLBACK: no deja pollas, partidos, inscripciones ni picks.
--
-- Qué asegura (ASSERT):
--   A · pago pendiente con comprobante: el pick recibe sus puntos al verificarse
--       el partido, pero la persona NO aparece en casa_leaderboard
--   B · el admin aprueba después del partido: aparece con esos puntos, sin
--       recalcular nada a mano
--   C · un segundo registro de la misma persona en la misma polla es imposible
--       (casa_entries_one_per_user)
--   D · pago rechazado: sigue sin contar en la tabla aunque tenga puntos

BEGIN;
SELECT set_config('app.casa_contract', '2', true);

DO $$
DECLARE
  admin_id uuid := (SELECT id FROM public.users WHERE is_admin LIMIT 1);
  players uuid[] := ARRAY(SELECT id FROM public.users WHERE NOT is_admin ORDER BY created_at LIMIT 2);
  p uuid; m uuid;
  e1 uuid; a1 uuid; e2 uuid; a2 uuid;
  pts integer; n integer; total integer;
BEGIN
  IF admin_id IS NULL OR array_length(players, 1) < 2 THEN
    RAISE EXCEPTION 'Se necesitan un admin y dos usuarios locales para esta prueba';
  END IF;

  INSERT INTO public.casa_pollas (slug, name, kind, scoring_mode, tournament, entry_price_cop, house_cut_pct, points_result,
    status, opens_at, closes_at, created_by, payout_method, payout_account, close_mode)
  VALUES ('test-pending-picks', 'Prueba pendientes', 'partidos', '1x2', 'premier_2025', 10000, 30, 3,
    'abierta', now() - interval '1 hour', now() + interval '2 days', admin_id, 'nequi', '3000000000', 'manual')
  RETURNING id INTO p;

  m := public.upsert_match_safe('test-pending-picks:match'::text, 'premier_2025'::text, NULL::int, 'regular_season'::text,
    'Local Prueba'::text, 'Visitante Prueba'::text, NULL::text, NULL::text, now() + interval '1 day', NULL::text,
    NULL::int, NULL::int, 'scheduled'::text, NULL::int, 'LOC'::text, 'VIS'::text, true);
  INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index) VALUES (p, m, 0);

  -- Dos inscripciones pendientes con comprobante confirmado.
  INSERT INTO public.casa_entries (polla_id, user_id, status, amount_cop) VALUES (p, players[1], 'pendiente', 10000) RETURNING id INTO e1;
  INSERT INTO public.casa_entry_proof_attempts (entry_id, user_id, request_id, state, proof_path, confirmed_at)
    VALUES (e1, players[1], gen_random_uuid(), 'confirmed', 'casa/test/' || e1 || '.jpg', now()) RETURNING id INTO a1;
  UPDATE public.casa_entries SET proof_path = 'casa/test/' || e1 || '.jpg', proof_uploaded_at = now(), current_proof_attempt_id = a1 WHERE id = e1;

  INSERT INTO public.casa_entries (polla_id, user_id, status, amount_cop) VALUES (p, players[2], 'pendiente', 10000) RETURNING id INTO e2;
  INSERT INTO public.casa_entry_proof_attempts (entry_id, user_id, request_id, state, proof_path, confirmed_at)
    VALUES (e2, players[2], gen_random_uuid(), 'confirmed', 'casa/test/' || e2 || '.jpg', now()) RETURNING id INTO a2;
  UPDATE public.casa_entries SET proof_path = 'casa/test/' || e2 || '.jpg', proof_uploaded_at = now(), current_proof_attempt_id = a2 WHERE id = e2;

  -- C · no hay segunda inscripción de la misma persona.
  BEGIN
    INSERT INTO public.casa_entries (polla_id, user_id, status, amount_cop) VALUES (p, players[1], 'pendiente', 10000);
    RAISE EXCEPTION 'C falló: se creó una segunda inscripción';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'C ok: casa_entries_one_per_user impide la doble inscripción';
  END;

  -- Pronostican mientras el pago está en revisión (los dos aciertan).
  INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2) VALUES (e1, p, players[1], m, 'L'), (e2, p, players[2], m, 'L');

  -- El partido termina y se verifica ANTES de revisar los pagos.
  UPDATE public.matches SET scheduled_at = now() - interval '2 hours', status = 'finished', elapsed = 90 WHERE id = m;
  PERFORM public.finalize_match_result(m, 2, 0, 'casa-pending-picks-check');

  -- A
  SELECT points_earned INTO pts FROM public.casa_picks WHERE entry_id = e1 AND match_id = m;
  SELECT count(*) INTO n FROM public.casa_leaderboard(p);
  ASSERT pts = 3, format('A falló: el pick pendiente tiene %s puntos', pts);
  ASSERT n = 0, format('A falló: la tabla muestra %s inscripciones pendientes', n);
  RAISE NOTICE 'A ok: pendiente con 3 puntos calculados y fuera de la tabla';

  -- B
  PERFORM public.casa_review_attempt_v3(a1, (SELECT review_revision FROM public.casa_entry_proof_attempts WHERE id = a1), 'pagada', NULL, 2, admin_id);
  SELECT count(*), coalesce(sum(points), 0) INTO n, total FROM public.casa_leaderboard(p) WHERE entry_id = e1;
  ASSERT n = 1 AND total = 3, format('B falló: aprobada después aparece %s veces con %s puntos', n, total);
  RAISE NOTICE 'B ok: al aprobar después del partido, los 3 puntos aparecen retroactivos';

  -- D
  PERFORM public.casa_review_attempt_v3(a2, (SELECT review_revision FROM public.casa_entry_proof_attempts WHERE id = a2), 'rechazada', 'prueba', 2, admin_id);
  SELECT count(*) INTO n FROM public.casa_leaderboard(p) WHERE entry_id = e2;
  ASSERT n = 0, 'D falló: una inscripción rechazada aparece en la tabla';
  RAISE NOTICE 'D ok: rechazada no cuenta aunque su pick tenga puntos';
END $$;

ROLLBACK;
