-- scripts/casa-settlement-readiness-check.sql — regresión de la migración 134:
-- cuándo una polla queda lista para repartir y el reparto provisional por persona.
--
--   Get-Content -Raw -Encoding UTF8 scripts/casa-settlement-readiness-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
--
-- ⚠️ SOLO contra un Supabase LOCAL. Fixtures propias (uuids con prefijo
-- `a3a3a3a3`, slugs `test-listo-%`, partidos `test-listo:%`, gente con
-- teléfono +5730000003x); termina en ROLLBACK.
--
-- Qué asegura (cada caso falla con ASSERT):
--   A · con partidos sin verificar, la polla no está lista y cuenta cuántos faltan
--   B · un comprobante por revisar bloquea; una inscripción abierta también
--   C · todo verificado y cerrada: lista; el reparto provisional agrupa por
--       persona (dos cupos ganadores de Ana suman) y coincide peso a peso con
--       lo que después escribe casa_settle_polla_v2
--   D · una polla resuelta ya no aparece
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control), 'v2');
SELECT set_config('app.casa_contract', '2', true);

DELETE FROM public.casa_payouts WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-listo-%');
DELETE FROM public.casa_picks   WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-listo-%');
DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-listo-%');
DELETE FROM public.casa_polla_matches WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-listo-%');
DELETE FROM public.casa_pollas   WHERE slug LIKE 'test-listo-%';
DELETE FROM public.matches       WHERE external_id LIKE 'test-listo:%';
DELETE FROM public.users         WHERE whatsapp_number LIKE '+5730000003%';

INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('a3a3a3a3-1111-4111-8111-000000000030', '+573000000030', 'Admin Listo', true),
  ('a3a3a3a3-1111-4111-8111-000000000031', '+573000000031', 'Ana Listo',   false),
  ('a3a3a3a3-1111-4111-8111-000000000032', '+573000000032', 'Beto Listo',  false),
  ('a3a3a3a3-1111-4111-8111-000000000033', '+573000000033', 'Caro Listo',  false);

INSERT INTO public.matches (id, external_id, tournament, home_team, away_team, scheduled_at, status) VALUES
  ('a3a3a3a3-2222-4222-8222-000000000031', 'test-listo:1', 'premier_2025', 'Equipo A1', 'Equipo B1', now() + interval '2 hours', 'scheduled'),
  ('a3a3a3a3-2222-4222-8222-000000000032', 'test-listo:2', 'premier_2025', 'Equipo A2', 'Equipo B2', now() + interval '2 hours', 'scheduled');

-- Pozo 3 × 10.001 × 70 % = 21.002 (no divisible entre 3 participaciones ganadoras: sobra 2).
INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name, points_exact, points_one_team, points_result)
VALUES ('a3a3a3a3-3333-4333-8333-000000000030', 'test-listo-a', 'Lista para repartir', 'partidos', 'premier_2025', 'marcador', 10001, 30, 'abierta', now() + interval '1 hour', 'a3a3a3a3-1111-4111-8111-000000000030', 'Nequi', '3000000000', 'La Casa', 3, 0, 3);
INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index) VALUES
  ('a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-2222-4222-8222-000000000031', 0),
  ('a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-2222-4222-8222-000000000032', 1);
-- Ana tiene dos cupos; Beto uno. Todos aciertan un exacto distinto: empate a 3.
INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop, entry_number, proof_path) VALUES
  ('a3a3a3a3-4444-4444-8444-000000000301', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000031', 'pagada', 10001, 1, NULL),
  ('a3a3a3a3-4444-4444-8444-000000000302', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000031', 'pagada', 10001, 2, NULL),
  ('a3a3a3a3-4444-4444-8444-000000000303', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000032', 'pagada', 10001, 1, NULL);
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, home_score, away_score) VALUES
  ('a3a3a3a3-4444-4444-8444-000000000301', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000031', 'a3a3a3a3-2222-4222-8222-000000000031', 1, 0),
  ('a3a3a3a3-4444-4444-8444-000000000302', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000031', 'a3a3a3a3-2222-4222-8222-000000000032', 2, 2),
  ('a3a3a3a3-4444-4444-8444-000000000303', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000032', 'a3a3a3a3-2222-4222-8222-000000000031', 1, 0);

-- ════════════════════════════════════════════════════════════════════════
-- A · faltan partidos
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.matches SET scheduled_at = now() - interval '3 hours', status = 'finished', home_score = 1, away_score = 0, final_verified_at = now()
 WHERE id = 'a3a3a3a3-2222-4222-8222-000000000031';
UPDATE public.casa_pollas SET closes_at = now() - interval '4 hours' WHERE id = 'a3a3a3a3-3333-4333-8333-000000000030';

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.casa_settlement_readiness_v2(ARRAY['a3a3a3a3-3333-4333-8333-000000000030'::uuid]);
  ASSERT FOUND, 'A: la polla de pozo debía aparecer';
  ASSERT r.total_items = 2 AND r.done_items = 1, format('A: esperaba 1 de 2 verificados, llegó %s de %s', r.done_items, r.total_items);
  ASSERT r.inscriptions_closed, 'A: con closes_at vencido las inscripciones ya cerraron';
  ASSERT NOT r.ready, 'A: con un partido sin verificar no puede estar lista';
  RAISE NOTICE 'A OK · 1 de 2 verificados, no lista';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- B · comprobante por revisar y polla abierta bloquean
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.matches SET scheduled_at = now() - interval '2 hours', status = 'finished', home_score = 2, away_score = 2, final_verified_at = now()
 WHERE id = 'a3a3a3a3-2222-4222-8222-000000000032';
INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop, entry_number, proof_path) VALUES
  ('a3a3a3a3-4444-4444-8444-000000000304', 'a3a3a3a3-3333-4333-8333-000000000030', 'a3a3a3a3-1111-4111-8111-000000000033', 'pendiente', 10001, 1, 'casa/prueba/comprobante.jpg');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.casa_settlement_readiness_v2(ARRAY['a3a3a3a3-3333-4333-8333-000000000030'::uuid]);
  ASSERT r.done_items = 2 AND r.pending_proofs = 1 AND NOT r.ready, format('B: comprobante pendiente debía bloquear: %s', to_jsonb(r));
END $$;
UPDATE public.casa_entries SET status = 'rechazada', reject_reason = 'Prueba' WHERE id = 'a3a3a3a3-4444-4444-8444-000000000304';
UPDATE public.casa_pollas SET closes_at = now() + interval '1 hour' WHERE id = 'a3a3a3a3-3333-4333-8333-000000000030';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.casa_settlement_readiness_v2(ARRAY['a3a3a3a3-3333-4333-8333-000000000030'::uuid]);
  ASSERT r.pending_proofs = 0 AND NOT r.inscriptions_closed AND NOT r.ready, format('B: con inscripciones abiertas no está lista: %s', to_jsonb(r));
  RAISE NOTICE 'B OK · comprobante por revisar y polla abierta bloquean';
END $$;
UPDATE public.casa_pollas SET closes_at = now() - interval '4 hours' WHERE id = 'a3a3a3a3-3333-4333-8333-000000000030';

-- ════════════════════════════════════════════════════════════════════════
-- C · lista: provisional por persona = reparto real
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record; v_prize bigint; v_sum bigint; v_ana bigint; v_beto bigint; v_ana_entries int; v_settle jsonb;
BEGIN
  SELECT * INTO r FROM public.casa_settlement_readiness_v2(ARRAY['a3a3a3a3-3333-4333-8333-000000000030'::uuid]);
  ASSERT r.ready, format('C: todo verificado, sin pendientes y cerrada: debía estar lista: %s', to_jsonb(r));
  SELECT prize_cop INTO v_prize FROM public.casa_pot_summaries_v2(ARRAY['a3a3a3a3-3333-4333-8333-000000000030'::uuid]);
  SELECT sum(amount_cop) INTO v_sum FROM public.casa_provisional_payouts_v2('a3a3a3a3-3333-4333-8333-000000000030');
  ASSERT v_sum = v_prize, format('C: la suma por persona (%s) debe ser el pozo (%s)', v_sum, v_prize);
  SELECT amount_cop, winning_entries INTO v_ana, v_ana_entries FROM public.casa_provisional_payouts_v2('a3a3a3a3-3333-4333-8333-000000000030') WHERE user_id = 'a3a3a3a3-1111-4111-8111-000000000031';
  SELECT amount_cop INTO v_beto FROM public.casa_provisional_payouts_v2('a3a3a3a3-3333-4333-8333-000000000030') WHERE user_id = 'a3a3a3a3-1111-4111-8111-000000000032';
  ASSERT v_ana_entries = 2, format('C: Ana tiene dos cupos ganadores, llegaron %s', v_ana_entries);

  UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = 'a3a3a3a3-3333-4333-8333-000000000030';
  v_settle := public.casa_settle_polla_v2('a3a3a3a3-3333-4333-8333-000000000030', 2, 'a3a3a3a3-1111-4111-8111-000000000030', NULL);
  ASSERT v_settle->>'outcome' = 'money_awarded', format('C: el reparto debía adjudicar dinero: %s', v_settle);
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id = 'a3a3a3a3-3333-4333-8333-000000000030' AND user_id = 'a3a3a3a3-1111-4111-8111-000000000031') = v_ana,
    'C: lo que se mostró para Ana debe ser exactamente lo que se le adjudicó';
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id = 'a3a3a3a3-3333-4333-8333-000000000030' AND user_id = 'a3a3a3a3-1111-4111-8111-000000000032') = v_beto,
    'C: lo que se mostró para Beto debe ser exactamente lo que se le adjudicó';
  RAISE NOTICE 'C OK · pozo % · Ana % (2 cupos) · Beto % · igual al reparto', v_prize, v_ana, v_beto;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- D · resuelta: fuera
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.casa_settlement_readiness_v2(ARRAY['a3a3a3a3-3333-4333-8333-000000000030'::uuid]);
  ASSERT v_n = 0, 'D: una polla resuelta ya no está «por repartir»';
  SELECT count(*) INTO v_n FROM public.casa_provisional_payouts_v2('a3a3a3a3-3333-4333-8333-000000000030');
  ASSERT v_n = 0, 'D: una polla resuelta no tiene reparto provisional';
  RAISE NOTICE 'D OK · resuelta fuera';
END $$;

ROLLBACK;
