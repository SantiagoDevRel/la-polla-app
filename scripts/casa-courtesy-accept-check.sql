-- scripts/casa-courtesy-accept-check.sql — regresión de aceptar cortesías (migración 173).
--
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-courtesy-accept-check.sql
--
-- ⚠️ SOLO contra un Supabase LOCAL con la 173 aplicada. Todo corre en una
-- transacción que termina en ROLLBACK: no deja nada.
--
-- Qué asegura (cada caso falla con ASSERT si la regla cambia):
--   A · quien recibe cortesías las ve como pendientes, agrupadas por polla
--   B · al aceptar queda con un cupo PAGADO de $0 por cortesía; el pozo no crece
--   C · aceptar dos veces no crea cupos de más y el aviso desaparece
--   D · los enlaces siguen igual: una cuenta nueva canjea, el dueño no canjea
--        su propio enlace
--   E · con la polla cerrada la cortesía vence: no se ofrece ni se acepta
--   F · el administrador puede retirar un cupo aceptado
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.casa_contract = '2';

INSERT INTO auth.users (id, phone, created_at) VALUES
  ('57575757-5757-4757-8757-000000000000', '573109000000', now() - interval '30 days'),  -- Admin
  ('57575757-5757-4757-8757-000000000001', '573109000001', now() - interval '10 days'),  -- Ana (recibe)
  ('57575757-5757-4757-8757-000000000002', '573109000002', now() + interval '1 minute'); -- Nueva
INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('57575757-5757-4757-8757-000000000000', '573109000000', 'Admin Acepta', true),
  ('57575757-5757-4757-8757-000000000001', '573109000001', 'Ana', false),
  ('57575757-5757-4757-8757-000000000002', '573109000002', 'Nueva', false)
ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, is_admin=EXCLUDED.is_admin;

INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, opens_at, closes_at, created_by, payout_method, payout_account, payout_account_name)
VALUES
  ('67676767-6767-4767-8767-00000000000a', 'test-acepta-a', 'A · acepta', 'partidos', 'premier_2025', '1x2', 20000, 30, 'abierta', now() - interval '1 hour', now() + interval '2 days', '57575757-5757-4757-8757-000000000000', 'Nequi', '3100000000', 'La Casa'),
  ('67676767-6767-4767-8767-00000000000b', 'test-acepta-b', 'B · vence', 'partidos', 'premier_2025', '1x2', 20000, 30, 'abierta', now() - interval '1 hour', clock_timestamp() + interval '2 seconds', '57575757-5757-4757-8757-000000000000', 'Nequi', '3100000000', 'La Casa');

SELECT public.casa_grant_courtesies_v1('67676767-6767-4767-8767-00000000000a',
  '57575757-5757-4757-8757-000000000001', 2, '57575757-5757-4757-8757-000000000000', 2) IS NOT NULL AS dadas_a;
SELECT public.casa_grant_courtesies_v1('67676767-6767-4767-8767-00000000000b',
  '57575757-5757-4757-8757-000000000001', 1, '57575757-5757-4757-8757-000000000000', 2) IS NOT NULL AS dadas_b;

-- A · pendientes por polla
DO $$ BEGIN
  ASSERT (SELECT pending FROM public.casa_pending_courtesies_v1('57575757-5757-4757-8757-000000000001')
    WHERE slug='test-acepta-a')=2, 'A1: no aparecen las 2 cortesías de A como pendientes';
  ASSERT (SELECT count(*) FROM public.casa_pending_courtesies_v1('57575757-5757-4757-8757-000000000002'))=0,
    'A2: alguien sin cortesías tiene pendientes';
END $$;

-- B · aceptar
DO $$ DECLARE v_result jsonb; v_antes bigint; v_despues bigint;
BEGIN
  SELECT gross_cop INTO v_antes FROM public.casa_pot_summaries_v2(ARRAY['67676767-6767-4767-8767-00000000000a'::uuid]);
  v_result := public.casa_accept_courtesies_v1('67676767-6767-4767-8767-00000000000a',
    '57575757-5757-4757-8757-000000000001', 2);
  ASSERT (v_result->>'ok')::boolean, format('B1: no se pudo aceptar: %s', v_result);
  ASSERT (v_result->>'accepted')::integer=2, format('B2: se esperaban 2 cupos: %s', v_result);
  ASSERT v_result->'entry_numbers'='[1,2]'::jsonb, format('B3: numeración inesperada: %s', v_result);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id='67676767-6767-4767-8767-00000000000a'
    AND user_id='57575757-5757-4757-8757-000000000001' AND status='pagada' AND amount_cop=0 AND proof_path IS NULL)=2,
    'B4: los cupos no quedaron pagados de $0 sin comprobante';
  SELECT gross_cop INTO v_despues FROM public.casa_pot_summaries_v2(ARRAY['67676767-6767-4767-8767-00000000000a'::uuid]);
  ASSERT v_antes=v_despues, 'B5: aceptar cortesías infló el recaudo';
  ASSERT (SELECT count(*) FROM public.casa_courtesies WHERE polla_id='67676767-6767-4767-8767-00000000000a'
    AND status='redimida' AND redeemed_by=holder_user_id AND entry_id IS NOT NULL)=2, 'B6: las cortesías no quedaron redimidas por su dueña';

  -- C · otra vez: nada nuevo
  v_result := public.casa_accept_courtesies_v1('67676767-6767-4767-8767-00000000000a',
    '57575757-5757-4757-8757-000000000001', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_NOT_FOUND', format('C1: %s', v_result);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id='67676767-6767-4767-8767-00000000000a')=2, 'C2: se crearon cupos de más';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pending_courtesies_v1('57575757-5757-4757-8757-000000000001')
    WHERE slug='test-acepta-a'), 'C3: el aviso sigue después de aceptar';
END $$;

-- D · los enlaces siguen funcionando como antes
SELECT public.casa_grant_courtesies_v1('67676767-6767-4767-8767-00000000000a',
  '57575757-5757-4757-8757-000000000001', 2, '57575757-5757-4757-8757-000000000000', 2) IS NOT NULL AS dadas_d;
DO $$ DECLARE v_codes text[]; v_result jsonb;
BEGIN
  SELECT array_agg(code ORDER BY code) INTO v_codes FROM public.casa_courtesies
    WHERE polla_id='67676767-6767-4767-8767-00000000000a' AND status='disponible';
  v_result := public.casa_redeem_courtesy_v1(v_codes[1], '57575757-5757-4757-8757-000000000001', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_SELF', format('D1: %s', v_result);
  v_result := public.casa_redeem_courtesy_v1(v_codes[1], '57575757-5757-4757-8757-000000000002', 2);
  ASSERT (v_result->>'ok')::boolean, format('D2: la cuenta nueva no pudo canjear el enlace: %s', v_result);
  v_result := public.casa_redeem_courtesy_v1(v_codes[2], '57575757-5757-4757-8757-000000000002', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_ALREADY_REDEEMED', format('D3: %s', v_result);
  -- La que queda la acepta su dueña: un cupo más (el 3).
  v_result := public.casa_accept_courtesies_v1('67676767-6767-4767-8767-00000000000a',
    '57575757-5757-4757-8757-000000000001', 2);
  ASSERT (v_result->>'entry_number')::integer=3, format('D4: %s', v_result);
END $$;

-- E · polla cerrada
SELECT pg_sleep(2.5);
DO $$ DECLARE v_result jsonb;
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pending_courtesies_v1('57575757-5757-4757-8757-000000000001')
    WHERE slug='test-acepta-b'), 'E1: se ofrece una cortesía de una polla cerrada';
  v_result := public.casa_accept_courtesies_v1('67676767-6767-4767-8767-00000000000b',
    '57575757-5757-4757-8757-000000000001', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_EXPIRED', format('E2: %s', v_result);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id='67676767-6767-4767-8767-00000000000b')=0, 'E3: se creó un cupo';
END $$;

-- F · el administrador retira un cupo aceptado
DO $$ DECLARE v_id uuid; v_entry uuid; v_result jsonb;
BEGIN
  SELECT id, entry_id INTO v_id, v_entry FROM public.casa_courtesies
    WHERE polla_id='67676767-6767-4767-8767-00000000000a' AND redeemed_by=holder_user_id ORDER BY redeemed_at LIMIT 1;
  v_result := public.casa_revoke_courtesy_v1(v_id, '57575757-5757-4757-8757-000000000000', 2);
  ASSERT (v_result->>'ok')::boolean AND v_result->>'status'='retirada', format('F1: %s', v_result);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=v_entry)='anulada', 'F2: el cupo siguió en pie';
END $$;

SELECT 'aceptar cortesías: todas las reglas se cumplen' AS resultado;
ROLLBACK;
