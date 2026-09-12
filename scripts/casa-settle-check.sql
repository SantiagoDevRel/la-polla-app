-- scripts/casa-settle-check.sql — regresión del reparto del pozo.
--
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-settle-check.sql
--
-- ⚠️ SOLO contra un Supabase LOCAL. Arma sus propias pollas de prueba (slugs
-- `test-settle-%`, partidos `test-settle:%`, gente con teléfono +5730000000x)
-- y al empezar borra ESO y nada más — nunca datos de personas reales. Contra
-- producción no se corre: ahí hay plata y pronósticos de verdad.
--
-- Qué asegura (cada caso falla con ASSERT si el reparto cambia de regla):
--   A · el pozo COMPLETO va al puntaje más alto, y quien no pagó ni aparece
--   B · empate arriba: partes iguales y el sobrante del redondeo también va
--        a los ganadores (la suma es exactamente el pozo)
--   C · nadie sumó puntos: no se reparte nada, se frena
--   D · rifa: boleta no vendida se frena; boleta vendida se lleva todo
--   E · una polla repartida no se vuelve a repartir
\set ON_ERROR_STOP on
BEGIN;

-- ── limpieza de corridas anteriores de ESTE harness ──────────────────────
DELETE FROM public.casa_payouts WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-settle-%');
DELETE FROM public.casa_picks   WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-settle-%');
DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-settle-%');
DELETE FROM public.casa_polla_matches WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-settle-%');
DELETE FROM public.casa_pollas   WHERE slug LIKE 'test-settle-%';
DELETE FROM public.matches       WHERE external_id LIKE 'test-settle:%';
DELETE FROM public.users         WHERE whatsapp_number LIKE '+5730000000%';

-- ── gente ────────────────────────────────────────────────────────────────
INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('11111111-1111-4111-8111-000000000000', '+573000000000', 'Admin Prueba', true),
  ('11111111-1111-4111-8111-000000000001', '+573000000001', 'Ana',   false),
  ('11111111-1111-4111-8111-000000000002', '+573000000002', 'Bruno', false),
  ('11111111-1111-4111-8111-000000000003', '+573000000003', 'Caro',  false),
  ('11111111-1111-4111-8111-000000000004', '+573000000004', 'Dani',  false);

-- ── partidos (aún sin verificar) ─────────────────────────────────────────
INSERT INTO public.matches (id, external_id, tournament, home_team, away_team, scheduled_at, status) VALUES
  ('22222222-2222-4222-8222-000000000001', 'test-settle:1', 'premier_2025', 'Equipo A1', 'Equipo B1', now() - interval '3 hours', 'scheduled'),
  ('22222222-2222-4222-8222-000000000002', 'test-settle:2', 'premier_2025', 'Equipo A2', 'Equipo B2', now() - interval '3 hours', 'scheduled'),
  ('22222222-2222-4222-8222-000000000003', 'test-settle:3', 'premier_2025', 'Equipo A3', 'Equipo B3', now() - interval '3 hours', 'scheduled'),
  ('22222222-2222-4222-8222-000000000004', 'test-settle:4', 'premier_2025', 'Equipo A4', 'Equipo B4', now() - interval '3 hours', 'scheduled');

-- ════════════════════════════════════════════════════════════════════════
-- A · Un solo ganador · el que NO pagó no entra al reparto ni a la tabla
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name)
VALUES ('33333333-3333-4333-8333-00000000000a', 'test-settle-a', 'A · ganador único', 'partidos', 'premier_2025', '1x2', 10000, 30, 'abierta', now() + interval '1 hour', '11111111-1111-4111-8111-000000000000', 'Nequi', '3000000000', 'La Casa');

INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index) VALUES
  ('33333333-3333-4333-8333-00000000000a', '22222222-2222-4222-8222-000000000001', 0),
  ('33333333-3333-4333-8333-00000000000a', '22222222-2222-4222-8222-000000000002', 1),
  ('33333333-3333-4333-8333-00000000000a', '22222222-2222-4222-8222-000000000003', 2);

INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop) VALUES
  ('44444444-4444-4444-8444-00000000a001', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000001', 'pagada',    10000),
  ('44444444-4444-4444-8444-00000000a002', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000002', 'pagada',    10000),
  ('44444444-4444-4444-8444-00000000a003', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000003', 'pendiente', 10000);

-- Ana acierta 3 (9 pts). Bruno acierta 1 (3 pts). Caro acierta 3 pero NO pagó.
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2) VALUES
  ('44444444-4444-4444-8444-00000000a001', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001', 'L'),
  ('44444444-4444-4444-8444-00000000a001', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000002', 'E'),
  ('44444444-4444-4444-8444-00000000a001', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000003', 'V'),
  ('44444444-4444-4444-8444-00000000a002', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000001', 'L'),
  ('44444444-4444-4444-8444-00000000a002', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000002', 'L'),
  ('44444444-4444-4444-8444-00000000a002', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000003', 'L'),
  ('44444444-4444-4444-8444-00000000a003', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000001', 'L'),
  ('44444444-4444-4444-8444-00000000a003', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000002', 'E'),
  ('44444444-4444-4444-8444-00000000a003', '33333333-3333-4333-8333-00000000000a', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000003', 'V');

-- Verificación de los 90': 2-0 (L), 1-1 (E), 0-2 (V).
UPDATE public.matches SET home_score = 2, away_score = 0, status = 'finished', final_verified_at = now() WHERE id = '22222222-2222-4222-8222-000000000001';
UPDATE public.matches SET home_score = 1, away_score = 1, status = 'finished', final_verified_at = now() WHERE id = '22222222-2222-4222-8222-000000000002';
UPDATE public.matches SET home_score = 0, away_score = 2, status = 'finished', final_verified_at = now() WHERE id = '22222222-2222-4222-8222-000000000003';

DO $$
DECLARE v_lb_rows int; v_caro int;
BEGIN
  SELECT COUNT(*) INTO v_lb_rows FROM public.casa_leaderboard('33333333-3333-4333-8333-00000000000a');
  ASSERT v_lb_rows = 2, format('A: la tabla debe tener solo los 2 pagados, tiene %s', v_lb_rows);
  SELECT COUNT(*) INTO v_caro FROM public.casa_leaderboard('33333333-3333-4333-8333-00000000000a') WHERE user_id = '11111111-1111-4111-8111-000000000003';
  ASSERT v_caro = 0, 'A: quien no pagó no puede aparecer en la tabla';
END $$;

UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = '33333333-3333-4333-8333-00000000000a';

DO $$
DECLARE r jsonb; v_n int; v_monto bigint; v_user uuid; v_prize bigint;
BEGIN
  r := public.casa_settle_polla('33333333-3333-4333-8333-00000000000a');
  SELECT prize_cop INTO v_prize FROM public.casa_polla_pot('33333333-3333-4333-8333-00000000000a');
  ASSERT v_prize = 14000, format('A: pozo esperado 14000, real %s', v_prize);
  SELECT COUNT(*), SUM(amount_cop), MIN(user_id::text)::uuid INTO v_n, v_monto, v_user
    FROM public.casa_payouts WHERE polla_id = '33333333-3333-4333-8333-00000000000a';
  ASSERT v_n = 1, format('A: debe pagar a UNA sola persona, pagó a %s', v_n);
  ASSERT v_user = '11111111-1111-4111-8111-000000000001', 'A: el ganador tiene que ser Ana (9 pts)';
  ASSERT v_monto = v_prize, format('A: el ganador se lleva el pozo completo (%s), recibió %s', v_prize, v_monto);
  RAISE NOTICE 'A OK · ganador único se lleva % · %', v_monto, r;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- B · Empate a 3 · el pozo se divide y el sobrante del redondeo NO se pierde
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name)
VALUES ('33333333-3333-4333-8333-00000000000b', 'test-settle-b', 'B · empate', 'partidos', 'premier_2025', '1x2', 3334, 30, 'abierta', now() + interval '1 hour', '11111111-1111-4111-8111-000000000000', 'Nequi', '3000000000', 'La Casa');

INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index)
VALUES ('33333333-3333-4333-8333-00000000000b', '22222222-2222-4222-8222-000000000004', 0);

INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop) VALUES
  ('44444444-4444-4444-8444-00000000b001', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000001', 'pagada', 3334),
  ('44444444-4444-4444-8444-00000000b002', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000002', 'pagada', 3334),
  ('44444444-4444-4444-8444-00000000b003', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000003', 'pagada', 3334),
  ('44444444-4444-4444-8444-00000000b004', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000004', 'pagada', 3334);

-- Tres aciertan (empate), Dani falla.
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2) VALUES
  ('44444444-4444-4444-8444-00000000b001', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000004', 'L'),
  ('44444444-4444-4444-8444-00000000b002', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000004', 'L'),
  ('44444444-4444-4444-8444-00000000b003', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000004', 'L'),
  ('44444444-4444-4444-8444-00000000b004', '33333333-3333-4333-8333-00000000000b', '11111111-1111-4111-8111-000000000004', '22222222-2222-4222-8222-000000000004', 'V');

UPDATE public.matches SET home_score = 3, away_score = 1, status = 'finished', final_verified_at = now() WHERE id = '22222222-2222-4222-8222-000000000004';
UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = '33333333-3333-4333-8333-00000000000b';

DO $$
DECLARE r jsonb; v_n int; v_suma bigint; v_prize bigint; v_min bigint; v_max bigint; v_perdedor int;
BEGIN
  r := public.casa_settle_polla('33333333-3333-4333-8333-00000000000b');
  SELECT prize_cop INTO v_prize FROM public.casa_polla_pot('33333333-3333-4333-8333-00000000000b');
  SELECT COUNT(*), SUM(amount_cop), MIN(amount_cop), MAX(amount_cop) INTO v_n, v_suma, v_min, v_max
    FROM public.casa_payouts WHERE polla_id = '33333333-3333-4333-8333-00000000000b';
  ASSERT v_n = 3, format('B: deben cobrar los 3 empatados, cobraron %s', v_n);
  ASSERT v_suma = v_prize, format('B: la suma repartida (%s) tiene que ser el pozo exacto (%s)', v_suma, v_prize);
  ASSERT v_max - v_min <= 1, format('B: el reparto debe ser parejo (min %s, max %s)', v_min, v_max);
  SELECT COUNT(*) INTO v_perdedor FROM public.casa_payouts
    WHERE polla_id = '33333333-3333-4333-8333-00000000000b' AND user_id = '11111111-1111-4111-8111-000000000004';
  ASSERT v_perdedor = 0, 'B: quien no empató arriba no puede cobrar';
  RAISE NOTICE 'B OK · pozo % repartido entre 3 (min % / max %) · %', v_prize, v_min, v_max, r;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- C · Nadie sumó puntos · no se reparte: se frena y decide una persona
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name)
VALUES ('33333333-3333-4333-8333-00000000000c', 'test-settle-c', 'C · nadie acertó', 'partidos', 'premier_2025', '1x2', 10000, 30, 'abierta', now() + interval '1 hour', '11111111-1111-4111-8111-000000000000', 'Nequi', '3000000000', 'La Casa');

INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index)
VALUES ('33333333-3333-4333-8333-00000000000c', '22222222-2222-4222-8222-000000000004', 0);

INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop) VALUES
  ('44444444-4444-4444-8444-00000000c001', '33333333-3333-4333-8333-00000000000c', '11111111-1111-4111-8111-000000000001', 'pagada', 10000),
  ('44444444-4444-4444-8444-00000000c002', '33333333-3333-4333-8333-00000000000c', '11111111-1111-4111-8111-000000000002', 'pagada', 10000);

-- El partido ya terminó 3-1 (L): los dos marcan V, y uno ni siquiera pronostica.
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2) VALUES
  ('44444444-4444-4444-8444-00000000c001', '33333333-3333-4333-8333-00000000000c', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000004', 'V');

UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = '33333333-3333-4333-8333-00000000000c';

DO $$
DECLARE v_n int;
BEGIN
  BEGIN
    PERFORM public.casa_settle_polla('33333333-3333-4333-8333-00000000000c');
    RAISE EXCEPTION 'C: repartió una polla sin ganador — no debería';
  EXCEPTION WHEN sqlstate '55000' THEN
    RAISE NOTICE 'C OK · se frenó: %', SQLERRM;
  END;
  SELECT COUNT(*) INTO v_n FROM public.casa_payouts WHERE polla_id = '33333333-3333-4333-8333-00000000000c';
  ASSERT v_n = 0, 'C: no puede quedar ningún payout escrito';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- D · Rifa · boleta no vendida se frena; boleta vendida se lleva TODO
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.casa_pollas (id, slug, name, kind, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name, ticket_count, draw_method, drawn_number)
VALUES ('33333333-3333-4333-8333-00000000000d', 'test-settle-d', 'D · rifa', 'rifa', 5000, 30, 'abierta', now() + interval '1 hour', '11111111-1111-4111-8111-000000000000', 'Nequi', '3000000000', 'La Casa', 100, 'Lotería de Medellín', 77);

INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop, ticket_number) VALUES
  ('44444444-4444-4444-8444-00000000d001', '33333333-3333-4333-8333-00000000000d', '11111111-1111-4111-8111-000000000001', 'pagada', 5000, 11),
  ('44444444-4444-4444-8444-00000000d002', '33333333-3333-4333-8333-00000000000d', '11111111-1111-4111-8111-000000000002', 'pagada', 5000, 22);

UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = '33333333-3333-4333-8333-00000000000d';

DO $$
DECLARE v_n int; v_prize bigint; v_monto bigint; v_user uuid;
BEGIN
  BEGIN
    PERFORM public.casa_settle_polla('33333333-3333-4333-8333-00000000000d');
    RAISE EXCEPTION 'D: repartió una rifa cuya boleta no se vendió — no debería';
  EXCEPTION WHEN sqlstate '55000' THEN
    RAISE NOTICE 'D1 OK · se frenó: %', SQLERRM;
  END;
  SELECT COUNT(*) INTO v_n FROM public.casa_payouts WHERE polla_id = '33333333-3333-4333-8333-00000000000d';
  ASSERT v_n = 0, 'D1: no puede quedar ningún payout escrito';

  -- La casa corrige el número por uno vendido y ahí sí reparte.
  UPDATE public.casa_pollas SET drawn_number = 22 WHERE id = '33333333-3333-4333-8333-00000000000d';
  PERFORM public.casa_settle_polla('33333333-3333-4333-8333-00000000000d');
  SELECT prize_cop INTO v_prize FROM public.casa_polla_pot('33333333-3333-4333-8333-00000000000d');
  SELECT COUNT(*), SUM(amount_cop), MIN(user_id::text)::uuid INTO v_n, v_monto, v_user
    FROM public.casa_payouts WHERE polla_id = '33333333-3333-4333-8333-00000000000d';
  ASSERT v_n = 1, format('D2: una rifa tiene un solo ganador, hubo %s', v_n);
  ASSERT v_user = '11111111-1111-4111-8111-000000000002', 'D2: gana quien tenía la boleta 22';
  ASSERT v_monto = v_prize, format('D2: se lleva el pozo completo (%s), recibió %s', v_prize, v_monto);
  RAISE NOTICE 'D2 OK · boleta 22 se lleva %', v_monto;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- E · No se reparte dos veces
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    PERFORM public.casa_settle_polla('33333333-3333-4333-8333-00000000000a');
    RAISE EXCEPTION 'E: repartió dos veces la misma polla';
  EXCEPTION WHEN sqlstate '55000' THEN
    RAISE NOTICE 'E OK · segundo reparto rechazado: %', SQLERRM;
  END;
END $$;

COMMIT;
