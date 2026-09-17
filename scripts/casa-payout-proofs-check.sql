-- scripts/casa-payout-proofs-check.sql — regresión de la migración 133:
-- premio provisional en la tabla y prueba de pago a los ganadores.
--
--   Get-Content -Raw -Encoding UTF8 scripts/casa-payout-proofs-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
--
-- ⚠️ SOLO contra un Supabase LOCAL. Fixtures propias (uuids con prefijo
-- `f2f2f2f2`, slugs `test-pago-%`, partidos `test-pago:%`, gente con teléfono
-- +5730000002x); termina en ROLLBACK.
--
-- Qué asegura (cada caso falla con ASSERT):
--   A · casa_provisional_prizes_v2: sin puntos no hay filas; con empate arriba
--        divide el pozo exacto entre las participaciones líderes; con un solo
--        líder se lo lleva todo; después de repartir, cero filas
--   B · casa_mark_payout_paid_v2: marca pagado con comprobante y cuenta
--        el avance; volver a subir reemplaza el archivo y conserva paid_at
--   C · rechaza rutas fuera de la carpeta del premio, actores sin admin y
--        pollas archivadas; el premio sigue inmutable para lo demás
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control), 'v2');
SELECT set_config('app.casa_contract', '2', true);

DELETE FROM public.casa_payouts WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-pago-%');
DELETE FROM public.casa_picks   WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-pago-%');
DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-pago-%');
DELETE FROM public.casa_polla_matches WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-pago-%');
DELETE FROM public.casa_pollas   WHERE slug LIKE 'test-pago-%';
DELETE FROM public.matches       WHERE external_id LIKE 'test-pago:%';
DELETE FROM public.users         WHERE whatsapp_number LIKE '+5730000002%';

INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('f2f2f2f2-1111-4111-8111-000000000020', '+573000000020', 'Admin Pago', true),
  ('f2f2f2f2-1111-4111-8111-000000000021', '+573000000021', 'Ana Pago',   false),
  ('f2f2f2f2-1111-4111-8111-000000000022', '+573000000022', 'Bruno Pago', false);

-- Saque en 2 horas: los pronósticos entran antes del bloqueo de 5 minutos.
INSERT INTO public.matches (id, external_id, tournament, home_team, away_team, scheduled_at, status) VALUES
  ('f2f2f2f2-2222-4222-8222-000000000021', 'test-pago:1', 'premier_2025', 'Equipo A1', 'Equipo B1', now() + interval '2 hours', 'scheduled'),
  ('f2f2f2f2-2222-4222-8222-000000000022', 'test-pago:2', 'premier_2025', 'Equipo A2', 'Equipo B2', now() + interval '2 hours', 'scheduled');

INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name)
VALUES ('f2f2f2f2-3333-4333-8333-000000000020', 'test-pago-a', 'Prueba de pago', 'partidos', 'premier_2025', '1x2', 10000, 30, 'abierta', now() + interval '1 hour', 'f2f2f2f2-1111-4111-8111-000000000020', 'Nequi', '3000000000', 'La Casa');
INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index) VALUES
  ('f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-2222-4222-8222-000000000021', 0),
  ('f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-2222-4222-8222-000000000022', 1);
INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop, entry_number) VALUES
  ('f2f2f2f2-4444-4444-8444-000000000201', 'f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-1111-4111-8111-000000000021', 'pagada', 10000, 1),
  ('f2f2f2f2-4444-4444-8444-000000000202', 'f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-1111-4111-8111-000000000022', 'pagada', 10000, 1);
-- Partido 1: los dos ponen L (empatan). Partido 2: Ana L, Bruno V (Ana se despega).
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2) VALUES
  ('f2f2f2f2-4444-4444-8444-000000000201', 'f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-1111-4111-8111-000000000021', 'f2f2f2f2-2222-4222-8222-000000000021', 'L'),
  ('f2f2f2f2-4444-4444-8444-000000000202', 'f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-1111-4111-8111-000000000022', 'f2f2f2f2-2222-4222-8222-000000000021', 'L'),
  ('f2f2f2f2-4444-4444-8444-000000000201', 'f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-1111-4111-8111-000000000021', 'f2f2f2f2-2222-4222-8222-000000000022', 'L'),
  ('f2f2f2f2-4444-4444-8444-000000000202', 'f2f2f2f2-3333-4333-8333-000000000020', 'f2f2f2f2-1111-4111-8111-000000000022', 'f2f2f2f2-2222-4222-8222-000000000022', 'V');

-- ════════════════════════════════════════════════════════════════════════
-- A · Premio provisional
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_n int; v_sum bigint; v_prize bigint; v_min bigint; v_max bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.casa_provisional_prizes_v2('f2f2f2f2-3333-4333-8333-000000000020');
  ASSERT v_n = 0, format('A: sin partidos verificados nadie suma y no hay premio provisional, hay %s filas', v_n);

  -- Se juega el partido 1: 2-0 → los dos suman 3 y empatan arriba.
  UPDATE public.matches SET scheduled_at = now() - interval '3 hours', home_score = 2, away_score = 0, status = 'finished', final_verified_at = now()
   WHERE id = 'f2f2f2f2-2222-4222-8222-000000000021';
  PERFORM public.casa_score_polla('f2f2f2f2-3333-4333-8333-000000000020');
  SELECT prize_cop INTO v_prize FROM public.casa_pot_summaries_v2(ARRAY['f2f2f2f2-3333-4333-8333-000000000020'::uuid]);
  SELECT count(*), sum(amount_cop), min(amount_cop), max(amount_cop) INTO v_n, v_sum, v_min, v_max
    FROM public.casa_provisional_prizes_v2('f2f2f2f2-3333-4333-8333-000000000020');
  ASSERT v_n = 2, format('A: los dos empatados arriba deben tener premio provisional, hay %s', v_n);
  ASSERT v_sum = v_prize, format('A: la suma provisional (%s) debe ser el pozo exacto (%s)', v_sum, v_prize);
  ASSERT v_max - v_min <= 1, format('A: reparto parejo (min %s, max %s)', v_min, v_max);

  -- Se juega el partido 2: 1-0 → Ana 6, Bruno 3: Ana sola arriba se llevaría todo.
  UPDATE public.matches SET scheduled_at = now() - interval '2 hours', home_score = 1, away_score = 0, status = 'finished', final_verified_at = now()
   WHERE id = 'f2f2f2f2-2222-4222-8222-000000000022';
  PERFORM public.casa_score_polla('f2f2f2f2-3333-4333-8333-000000000020');
  SELECT count(*), sum(amount_cop) INTO v_n, v_sum FROM public.casa_provisional_prizes_v2('f2f2f2f2-3333-4333-8333-000000000020');
  ASSERT v_n = 1 AND v_sum = v_prize, format('A: un solo líder se lleva el pozo completo (%s), filas %s suma %s', v_prize, v_n, v_sum);
  ASSERT (SELECT user_id FROM public.casa_provisional_prizes_v2('f2f2f2f2-3333-4333-8333-000000000020')) = 'f2f2f2f2-1111-4111-8111-000000000021', 'A: el líder provisional debe ser Ana';
  RAISE NOTICE 'A OK · premio provisional: 0 sin puntos, pozo % entre líderes, después 1 sola', v_prize;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- B · Repartir y registrar el pago con comprobante
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = 'f2f2f2f2-3333-4333-8333-000000000020';

DO $$
DECLARE r jsonb; v_payout uuid; v_prev text; v_paid_at timestamptz; v_path text; v_n int;
BEGIN
  r := public.casa_settle_polla_v2('f2f2f2f2-3333-4333-8333-000000000020', 2, 'f2f2f2f2-1111-4111-8111-000000000020', NULL);
  ASSERT r->>'outcome' = 'money_awarded', format('B: el reparto debía adjudicar dinero: %s', r);
  SELECT count(*) INTO v_n FROM public.casa_provisional_prizes_v2('f2f2f2f2-3333-4333-8333-000000000020');
  ASSERT v_n = 0, 'B: una polla resuelta no tiene premio provisional (manda casa_payouts)';

  SELECT id INTO v_payout FROM public.casa_payouts WHERE polla_id = 'f2f2f2f2-3333-4333-8333-000000000020' AND user_id = 'f2f2f2f2-1111-4111-8111-000000000021';
  ASSERT v_payout IS NOT NULL, 'B: Ana debe tener su premio';
  v_path := format('casa/%s/%s/primero.jpg', 'f2f2f2f2-3333-4333-8333-000000000020', v_payout);
  r := public.casa_mark_payout_paid_v2(v_payout, 'f2f2f2f2-1111-4111-8111-000000000020', 2, v_path, '  Nequi 16 sep  ');
  ASSERT (r->>'paid_count')::int = 1 AND (r->>'total_count')::int = 1, format('B: avance esperado 1/1: %s', r);
  ASSERT r->>'previous_proof_path' IS NULL, 'B: la primera subida no reemplaza nada';
  SELECT paid_at, proof_path INTO v_paid_at, v_prev FROM public.casa_payouts WHERE id = v_payout;
  ASSERT v_paid_at IS NOT NULL AND v_prev = v_path, 'B: el premio debe quedar pagado con su comprobante';
  ASSERT (SELECT paid_reference FROM public.casa_payouts WHERE id = v_payout) = 'Nequi 16 sep', 'B: la referencia se guarda recortada';
  ASSERT (SELECT paid_by FROM public.casa_payouts WHERE id = v_payout) = 'f2f2f2f2-1111-4111-8111-000000000020', 'B: paid_by es el administrador';

  -- Volver a subir: reemplaza el archivo, conserva paid_at y devuelve el anterior para borrarlo.
  r := public.casa_mark_payout_paid_v2(v_payout, 'f2f2f2f2-1111-4111-8111-000000000020', 2, replace(v_path, 'primero', 'segundo'), NULL);
  ASSERT r->>'previous_proof_path' = v_path, format('B: debía devolver el comprobante anterior: %s', r);
  ASSERT (SELECT paid_at FROM public.casa_payouts WHERE id = v_payout) = v_paid_at, 'B: reemplazar el comprobante no cambia paid_at';
  ASSERT (SELECT paid_reference FROM public.casa_payouts WHERE id = v_payout) IS NULL, 'B: sin referencia nueva, queda vacía';
  RAISE NOTICE 'B OK · pagado con comprobante y reemplazo · %', r;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- C · Lo que se rechaza
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_payout uuid; v_msg text;
BEGIN
  SELECT id INTO v_payout FROM public.casa_payouts WHERE polla_id = 'f2f2f2f2-3333-4333-8333-000000000020';

  BEGIN
    PERFORM public.casa_mark_payout_paid_v2(v_payout, 'f2f2f2f2-1111-4111-8111-000000000020', 2, 'casa/otra-polla/x.jpg', NULL);
    RAISE EXCEPTION 'NO_RAISE';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM; ASSERT v_msg = 'INVALID_PROOF_PATH', format('C: una ruta fuera de la carpeta del premio debe rechazarse (INVALID_PROOF_PATH), llegó %s', v_msg);
  END;

  BEGIN
    PERFORM public.casa_mark_payout_paid_v2(v_payout, 'f2f2f2f2-1111-4111-8111-000000000021', 2,
      format('casa/%s/%s/x.jpg', 'f2f2f2f2-3333-4333-8333-000000000020', v_payout), NULL);
    RAISE EXCEPTION 'NO_RAISE';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM; ASSERT v_msg = 'ADMIN_REQUIRED', format('C: alguien sin admin no puede registrar pagos (ADMIN_REQUIRED), llegó %s', v_msg);
  END;

  BEGIN
    UPDATE public.casa_payouts SET amount_cop = amount_cop + 1 WHERE id = v_payout;
    RAISE EXCEPTION 'NO_RAISE';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM; ASSERT v_msg = 'AWARD_IMMUTABLE', format('C: el importe del premio sigue inmutable (AWARD_IMMUTABLE), llegó %s', v_msg);
  END;

  UPDATE public.casa_pollas SET archived_at = now() WHERE id = 'f2f2f2f2-3333-4333-8333-000000000020';
  BEGIN
    PERFORM public.casa_mark_payout_paid_v2(v_payout, 'f2f2f2f2-1111-4111-8111-000000000020', 2,
      format('casa/%s/%s/y.jpg', 'f2f2f2f2-3333-4333-8333-000000000020', v_payout), NULL);
    RAISE EXCEPTION 'NO_RAISE';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM; ASSERT v_msg = 'PAYOUT_NOT_PAYABLE', format('C: una polla archivada no registra pagos (PAYOUT_NOT_PAYABLE), llegó %s', v_msg);
  END;
  RAISE NOTICE 'C OK · ruta ajena, sin admin, premio inmutable y archivada: rechazados';
END $$;

ROLLBACK;
