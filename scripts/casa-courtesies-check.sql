-- scripts/casa-courtesies-check.sql — regresión de las cortesías (migración 136).
--
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-courtesies-check.sql
--
-- ⚠️ SOLO contra un Supabase LOCAL. Arma su propia polla de prueba (slug
-- `test-cortesia-%`) y su propia gente (teléfonos 5731000000x) y al empezar
-- borra ESO y nada más. Contra producción no se corre.
--
-- Qué asegura (cada caso falla con ASSERT si la regla cambia):
--   A · solo el administrador da cortesías; una rifa nunca las admite
--   B · la persona nueva redime y queda con un cupo PAGADO de $0 — el pozo no
--        crece y el enlace se quema
--   C · el mismo enlace no sirve dos veces
--   D · quien ya redimió una cortesía no puede redimir otra, ni en otra polla
--   E · una cuenta vieja (creada antes de la cortesía) no es persona nueva
--   F · nadie redime su propia cortesía
--   G · con la polla cerrada la cortesía vence
--   H · el administrador retira una sin usar, pero nunca una ya redimida
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.casa_contract = '2';

-- ── limpieza de corridas anteriores de ESTE harness ──────────────────────
DELETE FROM public.casa_courtesies WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-cortesia-%');
DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-cortesia-%');
DELETE FROM public.casa_pollas WHERE slug LIKE 'test-cortesia-%';
DELETE FROM public.casa_courtesies WHERE holder_user_id IN (SELECT id FROM public.users WHERE whatsapp_number LIKE '5731000000%');
DELETE FROM public.users WHERE whatsapp_number LIKE '5731000000%';
DELETE FROM auth.users WHERE id IN (
  '55555555-5555-4555-8555-000000000000','55555555-5555-4555-8555-000000000001',
  '55555555-5555-4555-8555-000000000002','55555555-5555-4555-8555-000000000003',
  '55555555-5555-4555-8555-000000000004');

-- ── gente ────────────────────────────────────────────────────────────────
-- La fecha de la cuenta de acceso es la que decide quién es "persona nueva":
-- Vieja se creó ayer, las demás dentro de un rato (después de la cortesía).
-- El trigger handle_new_auth_user crea la fila de public.users: acá solo se le
-- pone nombre y el acceso de administrador.
INSERT INTO auth.users (id, phone, created_at) VALUES
  ('55555555-5555-4555-8555-000000000000', '573100000000', now() - interval '30 days'),  -- Admin
  ('55555555-5555-4555-8555-000000000001', '573100000001', now() - interval '10 days'),  -- Carlos (reparte)
  ('55555555-5555-4555-8555-000000000002', '573100000002', now() + interval '1 minute'), -- Nueva 1
  ('55555555-5555-4555-8555-000000000003', '573100000003', now() + interval '1 minute'), -- Nueva 2
  ('55555555-5555-4555-8555-000000000004', '573100000004', now() - interval '1 day');    -- Vieja
INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('55555555-5555-4555-8555-000000000000', '573100000000', 'Admin Cortesías', true),
  ('55555555-5555-4555-8555-000000000001', '573100000001', 'Carlos', false),
  ('55555555-5555-4555-8555-000000000002', '573100000002', 'Nueva Uno', false),
  ('55555555-5555-4555-8555-000000000003', '573100000003', 'Nueva Dos', false),
  ('55555555-5555-4555-8555-000000000004', '573100000004', 'Cuenta Vieja', false)
ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, is_admin=EXCLUDED.is_admin;

-- ── pollas de prueba ─────────────────────────────────────────────────────
INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, opens_at, closes_at, created_by, payout_method, payout_account, payout_account_name, ticket_count, draw_method)
VALUES
  ('66666666-6666-4666-8666-00000000000a', 'test-cortesia-a', 'A · cortesías', 'partidos', 'premier_2025', '1x2', 20000, 30, 'abierta', now() - interval '1 hour', now() + interval '2 days', '55555555-5555-4555-8555-000000000000', 'Nequi', '3100000000', 'La Casa', NULL, NULL),
  ('66666666-6666-4666-8666-00000000000b', 'test-cortesia-b', 'B · otra polla', 'partidos', 'premier_2025', '1x2', 20000, 30, 'abierta', now() - interval '1 hour', now() + interval '2 days', '55555555-5555-4555-8555-000000000000', 'Nequi', '3100000000', 'La Casa', NULL, NULL),
  ('66666666-6666-4666-8666-00000000000c', 'test-cortesia-rifa', 'R · rifa', 'rifa', NULL, NULL, 20000, 30, 'abierta', now() - interval '1 hour', now() + interval '2 days', '55555555-5555-4555-8555-000000000000', 'Nequi', '3100000000', 'La Casa', 50, 'Lotería de Bogotá');

-- ════════════════════════════════════════════════════════════════════════
-- A · solo el administrador; la rifa nunca
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  BEGIN
    PERFORM public.casa_grant_courtesies_v1('66666666-6666-4666-8666-00000000000a',
      '55555555-5555-4555-8555-000000000002', 2, '55555555-5555-4555-8555-000000000001', 2);
    RAISE EXCEPTION 'A1: alguien que no es administrador pudo dar cortesías';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  BEGIN
    PERFORM public.casa_grant_courtesies_v1('66666666-6666-4666-8666-00000000000c',
      '55555555-5555-4555-8555-000000000001', 1, '55555555-5555-4555-8555-000000000000', 2);
    RAISE EXCEPTION 'A2: una rifa aceptó cortesías';
  EXCEPTION WHEN sqlstate '55000' THEN NULL; END;
END $$;

-- El administrador le da 2 a Carlos en A y 1 en B.
SELECT public.casa_grant_courtesies_v1('66666666-6666-4666-8666-00000000000a',
  '55555555-5555-4555-8555-000000000001', 2, '55555555-5555-4555-8555-000000000000', 2) AS dadas_a \gset
SELECT public.casa_grant_courtesies_v1('66666666-6666-4666-8666-00000000000b',
  '55555555-5555-4555-8555-000000000001', 1, '55555555-5555-4555-8555-000000000000', 2) AS dadas_b \gset

DO $$ DECLARE v_total integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.casa_courtesies
    WHERE holder_user_id='55555555-5555-4555-8555-000000000001';
  ASSERT v_total = 3, format('A3: se esperaban 3 cortesías, hay %s', v_total);
  ASSERT (SELECT count(DISTINCT code) FROM public.casa_courtesies
    WHERE holder_user_id='55555555-5555-4555-8555-000000000001') = 3, 'A4: los códigos se repitieron';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- B · la persona nueva redime: cupo pagado de $0 y el pozo no se mueve
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_code text; v_result jsonb; v_pozo_antes bigint; v_pozo_despues bigint; e public.casa_entries;
BEGIN
  SELECT gross_cop INTO v_pozo_antes FROM public.casa_pot_summaries_v2(ARRAY['66666666-6666-4666-8666-00000000000a'::uuid]);
  SELECT code INTO v_code FROM public.casa_courtesies
    WHERE polla_id='66666666-6666-4666-8666-00000000000a' AND status='disponible' ORDER BY code LIMIT 1;

  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000002', 2);
  ASSERT (v_result->>'ok')::boolean, format('B1: no se pudo redimir: %s', v_result);

  SELECT * INTO e FROM public.casa_entries WHERE id=(v_result->>'entry_id')::uuid;
  ASSERT e.status='pagada', 'B2: el cupo de cortesía no quedó pagado';
  ASSERT e.amount_cop=0, 'B3: el cupo de cortesía no vale $0';
  ASSERT e.proof_path IS NULL, 'B4: un cupo de cortesía no lleva comprobante';
  ASSERT e.entry_number IS NOT NULL, 'B5: el cupo quedó sin número de participación';

  SELECT gross_cop INTO v_pozo_despues FROM public.casa_pot_summaries_v2(ARRAY['66666666-6666-4666-8666-00000000000a'::uuid]);
  ASSERT v_pozo_antes = v_pozo_despues, 'B6: una cortesía infló el dinero recaudado';

  ASSERT (SELECT status FROM public.casa_courtesies WHERE code=v_code)='redimida', 'B7: la cortesía no se marcó redimida';
  ASSERT (SELECT redeemed_by FROM public.casa_courtesies WHERE code=v_code)='55555555-5555-4555-8555-000000000002', 'B8: quedó redimida por otra persona';

  -- C · el mismo enlace no sirve dos veces
  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000003', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_USED',
    format('C1: el enlace usado volvió a servir: %s', v_result);
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- D · una cortesía por persona, y no vale para otra polla
-- ════════════════════════════════════════════════════════════════════════
DO $$ DECLARE v_code text; v_result jsonb;
BEGIN
  SELECT code INTO v_code FROM public.casa_courtesies
    WHERE polla_id='66666666-6666-4666-8666-00000000000b' AND status='disponible' LIMIT 1;
  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000002', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_ALREADY_REDEEMED',
    format('D1: quien ya redimió pudo redimir en otra polla: %s', v_result);
  ASSERT (SELECT count(*) FROM public.casa_entries
    WHERE polla_id='66666666-6666-4666-8666-00000000000b')=0, 'D2: se creó un cupo igual';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- E · una cuenta vieja no es persona nueva · F · nadie redime la suya
-- ════════════════════════════════════════════════════════════════════════
DO $$ DECLARE v_code text; v_result jsonb;
BEGIN
  SELECT code INTO v_code FROM public.casa_courtesies
    WHERE polla_id='66666666-6666-4666-8666-00000000000a' AND status='disponible' LIMIT 1;
  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000004', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='NOT_NEW_USER',
    format('E1: una cuenta anterior a la cortesía pudo redimirla: %s', v_result);

  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000001', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_SELF',
    format('F1: quien reparte pudo quedarse con su propia cortesía: %s', v_result);

  -- Un administrador tampoco: las cortesías son para jugadores nuevos.
  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000000', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='NOT_NEW_USER',
    format('F2: un administrador pudo redimir una cortesía: %s', v_result);
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- G · vence con la polla
-- ════════════════════════════════════════════════════════════════════════
DO $$ DECLARE v_code text; v_result jsonb;
BEGIN
  SELECT code INTO v_code FROM public.casa_courtesies
    WHERE polla_id='66666666-6666-4666-8666-00000000000a' AND status='disponible' LIMIT 1;
  UPDATE public.casa_pollas SET status='cerrada' WHERE id='66666666-6666-4666-8666-00000000000a';
  v_result := public.casa_redeem_courtesy_v1(v_code, '55555555-5555-4555-8555-000000000003', 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_EXPIRED',
    format('G1: una polla cerrada aceptó una cortesía: %s', v_result);

  -- Y ya no se pueden dar más cortesías en esa polla.
  BEGIN
    PERFORM public.casa_grant_courtesies_v1('66666666-6666-4666-8666-00000000000a',
      '55555555-5555-4555-8555-000000000001', 1, '55555555-5555-4555-8555-000000000000', 2);
    RAISE EXCEPTION 'G2: se dieron cortesías en una polla cerrada';
  EXCEPTION WHEN sqlstate '55000' THEN NULL; END;
  UPDATE public.casa_pollas SET status='abierta' WHERE id='66666666-6666-4666-8666-00000000000a';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- H · retirar una sin usar, jamás una redimida
-- ════════════════════════════════════════════════════════════════════════
DO $$ DECLARE v_id uuid; v_usada uuid; v_entry uuid; v_persona uuid; v_libre text; v_result jsonb;
BEGIN
  SELECT id INTO v_id FROM public.casa_courtesies
    WHERE polla_id='66666666-6666-4666-8666-00000000000a' AND status='disponible' LIMIT 1;
  v_result := public.casa_revoke_courtesy_v1(v_id, '55555555-5555-4555-8555-000000000000', 2);
  ASSERT (v_result->>'ok')::boolean AND (v_result->>'changed')::boolean, 'H1: no se pudo retirar una cortesía sin usar';
  ASSERT (SELECT status FROM public.casa_courtesies WHERE id=v_id)='revocada', 'H2: no quedó retirada';

  -- Idempotente: retirar otra vez no rompe ni cambia nada.
  v_result := public.casa_revoke_courtesy_v1(v_id, '55555555-5555-4555-8555-000000000000', 2);
  ASSERT (v_result->>'ok')::boolean AND NOT (v_result->>'changed')::boolean, 'H3: retirar dos veces no es idempotente';

  -- Una cortesía YA USADA también se retira (migración 137): el cupo gratis
  -- queda anulado, la cortesía guarda a quién se la dio y esa cuenta tampoco
  -- puede ir a buscar otra.
  SELECT id, entry_id, redeemed_by INTO v_usada, v_entry, v_persona
    FROM public.casa_courtesies WHERE status='redimida'
    AND polla_id='66666666-6666-4666-8666-00000000000a' LIMIT 1;
  v_result := public.casa_revoke_courtesy_v1(v_usada, '55555555-5555-4555-8555-000000000000', 2);
  ASSERT (v_result->>'ok')::boolean AND v_result->>'status'='retirada',
    format('H4: no se pudo quitar un cupo de cortesía ya usado: %s', v_result);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=v_entry)='anulada',
    'H4b: el cupo gratis siguió en pie después de retirar la cortesía';
  ASSERT (SELECT redeemed_by FROM public.casa_courtesies WHERE id=v_usada)=v_persona,
    'H4c: se perdió el rastro de quién había usado la cortesía';

  SELECT code INTO v_libre FROM public.casa_courtesies
    WHERE polla_id='66666666-6666-4666-8666-00000000000b' AND status='disponible' LIMIT 1;
  v_result := public.casa_redeem_courtesy_v1(v_libre, v_persona, 2);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'error'='COURTESY_ALREADY_REDEEMED',
    format('H4d: a quien le quitaron el cupo pudo tomar otra cortesía: %s', v_result);

  -- Y un jugador no puede retirar nada.
  BEGIN
    PERFORM public.casa_revoke_courtesy_v1(v_id, '55555555-5555-4555-8555-000000000001', 2);
    RAISE EXCEPTION 'H5: un jugador pudo retirar una cortesía';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- ── lecturas de pantalla ─────────────────────────────────────────────────
DO $$ DECLARE v_preview jsonb; v_code text;
BEGIN
  -- La que alguien usó (y que el administrador ya retiró en H) no se ofrece.
  SELECT code INTO v_code FROM public.casa_courtesies WHERE status IN ('redimida','retirada')
    AND polla_id='66666666-6666-4666-8666-00000000000a' LIMIT 1;
  v_preview := public.casa_courtesy_preview_v1(v_code, '55555555-5555-4555-8555-000000000003');
  ASSERT NOT (v_preview->>'redeemable')::boolean, 'I1: se ofrece activar una cortesía ya usada';
  ASSERT NOT (v_preview->>'usable')::boolean, 'I1b: una cortesía usada sigue marcada como disponible';
  ASSERT v_preview->>'slug'='test-cortesia-a', 'I2: la vista previa apunta a otra polla';

  -- A Carlos le dieron 3: una la usaron y el administrador la quitó (H), otra la
  -- retiró sin usar, así que en su lista queda la de la polla B.
  ASSERT (SELECT count(*) FROM public.casa_my_courtesies_v1('55555555-5555-4555-8555-000000000001'))=1,
    'I3: la lista de quien reparte no coincide (una retirada no debe aparecer)';
  ASSERT (SELECT count(*) FROM public.casa_courtesies_admin_v1('55555555-5555-4555-8555-000000000000',
    '66666666-6666-4666-8666-00000000000a', NULL))=2, 'I4: el panel no lista las cortesías de la polla';
END $$;

-- ── limpieza: esto es un harness, no deja basura ─────────────────────────
DELETE FROM public.casa_courtesies WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-cortesia-%');
DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-cortesia-%');
DELETE FROM public.casa_pollas WHERE slug LIKE 'test-cortesia-%';
DELETE FROM public.users WHERE whatsapp_number LIKE '5731000000%';
DELETE FROM auth.users WHERE id IN (
  '55555555-5555-4555-8555-000000000000','55555555-5555-4555-8555-000000000001',
  '55555555-5555-4555-8555-000000000002','55555555-5555-4555-8555-000000000003',
  '55555555-5555-4555-8555-000000000004');

SELECT 'cortesías: todas las reglas se cumplen' AS resultado;
COMMIT;
