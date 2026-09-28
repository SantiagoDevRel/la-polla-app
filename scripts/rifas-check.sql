-- scripts/rifas-check.sql — regresión de las rifas de creadores (migración 157).
--
--   psql -h 127.0.0.1 -p 54322 -U postgres -d la_polla_local -f scripts/rifas-check.sql
--   (o, con el Supabase local de Docker:)
--   docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/rifas-check.sql
--
-- ⚠️ SOLO contra una base LOCAL. Todo corre en UNA transacción que termina en
-- ROLLBACK: no deja filas. Contra producción no se corre.
--
-- Qué asegura (cada caso falla con ASSERT o con la excepción equivocada):
--   A · permisos: solo un admin asigna creadores; sin permiso no se crea una
--       rifa ni llamando la RPC; un cliente (anon/authenticated) no puede
--       ejecutar ninguna RPC de rifas; quitar el permiso no apaga la rifa en
--       curso; tope de rifas activas
--   B · Privada: solo creador y administradores la ven (RPC y RLS)
--   C · reservar: cuenta de cobro si el premio es dinero, número tomado con
--       mensaje claro, el creador no compra, rango, tope por comprador
--   D · comprobante: sin archivo no se confirma; confirmado queda en revisión;
--       solo el creador aprueba (ni un admin); aprobado = pagado
--   E · rechazo: exige motivo y libera el número
--   F · vencimiento perezoso de reservas sin comprobante
--   G · venta por fuera: sin cuenta, celular válido, aparece a quien se
--       registre después con ese celular
--   H · visibilidad: de Pública a Privada solo sin números tomados
--   I · revertir aprobación deja auditoría con motivo
--   J · resultado: no antes del sorteo, ganador pendiente, número no vendido
--       (volver a jugar / desierta), ganador pagado
--   K · privacidad: la vista pública nunca trae nombres ni celulares
--   L · ocultar (admin) y reportar
--   M · embudo: atribución de cuentas nuevas
\set ON_ERROR_STOP on
BEGIN;

-- Ayudante: ejecuta y exige que falle con ese código (MESSAGE de rifa_fail o SQLSTATE).
CREATE FUNCTION pg_temp.expect_fail(p_sql text, p_code text, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_detail text; v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL, v_state = RETURNED_SQLSTATE;
    IF v_msg = p_code OR v_state = p_code THEN RETURN v_detail; END IF;
    RAISE EXCEPTION '%: esperaba %, llegó % (%)', p_label, p_code, v_msg, v_state;
  END;
  RAISE EXCEPTION '%: esperaba % y la operación pasó', p_label, p_code;
END $$;

-- ── gente ────────────────────────────────────────────────────────────────
-- a1 admin · c1 creador · c2 otro usuario (luego creador) · b1/b2/b3 compradores
-- n1 cuenta nueva (se registra después de una venta por fuera a su celular)
INSERT INTO auth.users (id, phone, created_at) VALUES
  ('77777777-7777-4777-8777-0000000000a1', '573190000001', now() - interval '60 days'),
  ('77777777-7777-4777-8777-0000000000c1', '573190000002', now() - interval '60 days'),
  ('77777777-7777-4777-8777-0000000000c2', '573190000003', now() - interval '60 days'),
  ('77777777-7777-4777-8777-0000000000b1', '573190000004', now() - interval '60 days'),
  ('77777777-7777-4777-8777-0000000000b2', '573190000005', now() - interval '60 days'),
  ('77777777-7777-4777-8777-0000000000b3', '573190000006', now() - interval '60 days');
INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('77777777-7777-4777-8777-0000000000a1', '573190000001', 'Admin Rifas', true),
  ('77777777-7777-4777-8777-0000000000c1', '573190000002', 'Creadora Uno', false),
  ('77777777-7777-4777-8777-0000000000c2', '573190000003', 'Usuario Dos', false),
  ('77777777-7777-4777-8777-0000000000b1', '573190000004', 'Comprador Uno', false),
  ('77777777-7777-4777-8777-0000000000b2', '573190000005', 'Comprador Dos', false),
  ('77777777-7777-4777-8777-0000000000b3', '573190000006', 'Comprador Tres', false)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, is_admin = EXCLUDED.is_admin,
  whatsapp_number = EXCLUDED.whatsapp_number;

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
INSERT INTO ids VALUES ('a1','77777777-7777-4777-8777-0000000000a1'), ('c1','77777777-7777-4777-8777-0000000000c1'),
  ('c2','77777777-7777-4777-8777-0000000000c2'), ('b1','77777777-7777-4777-8777-0000000000b1'),
  ('b2','77777777-7777-4777-8777-0000000000b2'), ('b3','77777777-7777-4777-8777-0000000000b3');
GRANT SELECT ON ids TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- A · permisos
-- ════════════════════════════════════════════════════════════════════════
SELECT pg_temp.expect_fail($$SELECT public.rifa_grant_creator_v1('77777777-7777-4777-8777-0000000000c2','77777777-7777-4777-8777-0000000000c1')$$,
  'ADMIN_REQUIRED', 'A1 un no-admin asigna creadores');
SELECT pg_temp.expect_fail($$SELECT public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Rifa sin permiso','texto',NULL,'Una camiseta',
  100,5000,'Lotería de Medellín','ultimas_dos',now()+interval '2 days','privada','nequi','3001234567','Creadora Uno')$$,
  'CREATOR_REQUIRED', 'A2 crear sin permiso');
SELECT public.rifa_grant_creator_v1('77777777-7777-4777-8777-0000000000a1', '77777777-7777-4777-8777-0000000000c1');
SELECT public.rifa_grant_creator_v1('77777777-7777-4777-8777-0000000000a1', '77777777-7777-4777-8777-0000000000c1'); -- idempotente
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.rifa_events WHERE kind = 'creador_asignado'
          AND subject_user_id = '77777777-7777-4777-8777-0000000000c1') = 1, 'A3 la asignación queda registrada una vez';
  ASSERT (SELECT granted_by FROM public.rifa_creators WHERE user_id = '77777777-7777-4777-8777-0000000000c1')
          = '77777777-7777-4777-8777-0000000000a1', 'A3 granted_by';
END $$;

-- Rifa principal: premio en dinero, 100 números, Privada por defecto.
CREATE TEMP TABLE r AS SELECT (public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Boleta Sur clásico','dinero',500000,NULL,
  100,6000,'Astro Sol','ultimas_dos',now()+interval '2 days',NULL,'nequi','3001234567','Creadora Uno')->>'id')::uuid AS id;
GRANT SELECT ON r TO authenticated;
DO $$ BEGIN
  ASSERT (SELECT visibility FROM public.rifas WHERE id = (SELECT id FROM r)) = 'privada', 'A3 Privada por defecto';
  ASSERT (SELECT slug FROM public.rifas WHERE id = (SELECT id FROM r)) ~ '^[a-z0-9]{8}$', 'A3 slug';
END $$;

-- A4 · un cliente con la anon key o con sesión NO ejecuta las RPC (la API es el único camino).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-0000000000c1","role":"authenticated"}', true);
SELECT pg_temp.expect_fail($$SELECT public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Rifa por PostgREST','texto',NULL,'Algo',
  100,5000,'Chontico','ultimas_dos',now()+interval '2 days','privada','nequi','3001234567','X')$$, '42501', 'A4 authenticated ejecuta create');
SELECT pg_temp.expect_fail($$SELECT public.rifa_grant_creator_v1('77777777-7777-4777-8777-0000000000c1','77777777-7777-4777-8777-0000000000c2')$$,
  '42501', 'A4 authenticated ejecuta grant');
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b1',ARRAY[1])$$,
  '42501', 'A4 authenticated ejecuta reserve');
SELECT pg_temp.expect_fail($$INSERT INTO public.rifa_creators(user_id, granted_by) VALUES ('77777777-7777-4777-8777-0000000000c2','77777777-7777-4777-8777-0000000000c2')$$,
  '42501', 'A4 authenticated se da permiso por tabla');
SELECT pg_temp.expect_fail($$SELECT count(*) FROM public.rifa_tickets$$, '42501', 'A4 authenticated lee boletas');
-- B (RLS) · ningún cliente lee rifas por tabla, ni su propia rifa ni una Pública:
-- la cuenta de pago solo sale por rifa_public_view_v1 a quien tiene números por pagar.
SELECT pg_temp.expect_fail($$SELECT count(*) FROM public.rifas$$, '42501', 'B1 el creador lee rifas por tabla');
SELECT set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-0000000000a1","role":"authenticated"}', true);
SELECT pg_temp.expect_fail($$SELECT payment_account FROM public.rifas$$, '42501', 'B1 un admin lee cuentas por tabla');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_fail($$SELECT count(*) FROM public.rifas$$, '42501', 'B1 anon lee rifas');
RESET ROLE;

-- B · por la RPC: un comprador no la abre ni por enlace; un admin sí (y puede probarla comprando).
SELECT pg_temp.expect_fail($$SELECT public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)),'77777777-7777-4777-8777-0000000000b1')$$,
  'RIFA_NOT_FOUND', 'B2 comprador abre Privada');
SELECT pg_temp.expect_fail($$SELECT public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)),NULL)$$,
  'RIFA_NOT_FOUND', 'B2 sin sesión abre Privada');
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b1',ARRAY[1])$$,
  'RIFA_NOT_FOUND', 'B2 comprador reserva en Privada');
UPDATE public.users SET default_payout_method = 'nequi', default_payout_account = '3009990001'
 WHERE id = '77777777-7777-4777-8777-0000000000a1';
SELECT public.rifa_reserve_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000a1', ARRAY[99]);
SELECT public.rifa_cancel_reservation_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000a1', ARRAY[99]);

-- H (primera mitad) · de Privada a Pública sin números: permitido.
SELECT public.rifa_set_visibility_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM r), 'publica');
DO $$ BEGIN ASSERT (SELECT visibility FROM public.rifas WHERE id=(SELECT id FROM r)) = 'publica', 'H1 pasa a Pública'; END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_visibility_v1('77777777-7777-4777-8777-0000000000b1',(SELECT id FROM r),'privada')$$,
  'CREATOR_ONLY', 'H1 otro cambia la visibilidad');

-- ════════════════════════════════════════════════════════════════════════
-- C · reservar
-- ════════════════════════════════════════════════════════════════════════
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b1',ARRAY[7,8])$$,
  'PAYOUT_ACCOUNT_REQUIRED', 'C1 premio en dinero sin cuenta de cobro');
UPDATE public.users SET default_payout_method = 'nequi', default_payout_account = '3009990004'
 WHERE id IN ('77777777-7777-4777-8777-0000000000b1','77777777-7777-4777-8777-0000000000b2','77777777-7777-4777-8777-0000000000b3');
DO $$
DECLARE j jsonb;
BEGIN
  j := public.rifa_reserve_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b1', ARRAY[8,7,7]);
  ASSERT j->'numbers' = '[7,8]'::jsonb, 'C2 reserva deduplicada y ordenada';
  ASSERT (j->>'amount_cop')::int = 12000, 'C2 valor a transferir calculado en SQL';
  ASSERT (j->>'expires_at')::timestamptz BETWEEN now() + interval '29 minutes' AND now() + interval '31 minutes', 'C2 vence a los 30 min';
END $$;
DO $$
DECLARE d text;
BEGIN
  d := pg_temp.expect_fail($q$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b2',ARRAY[7])$q$,
    'NUMBER_TAKEN', 'C3 número tomado');
  ASSERT d = 'El 07 ya lo tomó otra persona. Elige otro número.', 'C3 mensaje claro: ' || d;
END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000c1',ARRAY[30])$$,
  'CREATOR_CANNOT_BUY', 'C4 el creador compra en la app');
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b2',ARRAY[100])$$,
  'INVALID_NUMBER', 'C5 número fuera de rango');
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b2',ARRAY[40,41,42,43,44,45,46,47,48,49,50])$$,
  'MAX_PENDING_NUMBERS', 'C6 tope de números sin pagar por comprador');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.rifa_tickets WHERE rifa_id = (SELECT id FROM r) AND buyer_id = '77777777-7777-4777-8777-0000000000b2') = 0,
    'C6 una reserva rechazada no deja números a medias';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- D · comprobante y aprobación
-- ════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE pf AS SELECT public.rifa_begin_proof_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b1',
  '88888888-8888-4888-8888-000000000001', repeat('a', 64), 'image/jpeg', 1000) AS j;
DO $$
DECLARE j jsonb := (SELECT j FROM pf);
BEGIN
  ASSERT j->'numbers' = '[7,8]'::jsonb AND (j->>'amount_cop')::int = 12000, 'D1 un comprobante cubre los dos números';
  ASSERT j->>'path' = format('rifas/%s/%s.jpg', (SELECT id FROM r), j->>'proof_id'), 'D1 ruta fijada por SQL';
  ASSERT (public.rifa_begin_proof_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b1',
          '88888888-8888-4888-8888-000000000001', repeat('a', 64), 'image/jpeg', 1000)->>'proof_id') = j->>'proof_id',
    'D1 doble toque devuelve el mismo intento';
END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_begin_proof_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b1',
  '88888888-8888-4888-8888-000000000001', repeat('b',64),'image/jpeg',1000)$$, 'REQUEST_CONFLICT', 'D1 mismo intento con otro archivo');
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_confirm_proof_v1(%L,'77777777-7777-4777-8777-0000000000b1')$$, (SELECT j->>'proof_id' FROM pf)),
  'PROOF_NOT_UPLOADED', 'D2 confirmar sin archivo');
INSERT INTO storage.objects (bucket_id, name) SELECT 'rifa-proofs', j->>'path' FROM pf;
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_confirm_proof_v1(%L,'77777777-7777-4777-8777-0000000000b2')$$, (SELECT j->>'proof_id' FROM pf)),
  'ATTEMPT_NOT_FOUND', 'D2 otro confirma mi comprobante');
SELECT public.rifa_confirm_proof_v1((SELECT (j->>'proof_id')::uuid FROM pf), '77777777-7777-4777-8777-0000000000b1');
DO $$
DECLARE v jsonb := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), '77777777-7777-4777-8777-0000000000b2');
BEGIN
  ASSERT (SELECT state FROM public.rifa_tickets WHERE rifa_id=(SELECT id FROM r) AND number=7 AND state<>'liberado') = 'en_revision', 'D3 en revisión';
  ASSERT (SELECT expires_at FROM public.rifa_tickets WHERE rifa_id=(SELECT id FROM r) AND number=7 AND state<>'liberado') IS NULL, 'D3 en revisión no vence';
  ASSERT v->'board'->7->>'s' = 'reservado' AND (v->'board'->7->>'m')::boolean = false, 'D3 el tablero muestra «reservado» a otros';
  ASSERT v->'payment' = 'null'::jsonb, 'D3 la cuenta del creador solo se entrega a quien tiene números por pagar';
END $$;
-- Solo el creador aprueba: ni un comprador, ni otro usuario, ni un administrador.
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000b2',%L,'aprobar',NULL)$$, (SELECT j->>'proof_id' FROM pf)),
  'CREATOR_ONLY', 'D4 un no-creador aprueba');
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000a1',%L,'aprobar',NULL)$$, (SELECT j->>'proof_id' FROM pf)),
  'CREATOR_ONLY', 'D4 un admin aprueba');
SELECT pg_temp.expect_fail($$SELECT public.rifa_creator_view_v1('77777777-7777-4777-8777-0000000000a1',(SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)))$$,
  'CREATOR_ONLY', 'D4 un admin abre el panel con nombres y celulares');
SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000c1', (SELECT (j->>'proof_id')::uuid FROM pf), 'aprobar', NULL);
DO $$
DECLARE v jsonb := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), '77777777-7777-4777-8777-0000000000b1');
BEGIN
  ASSERT v->'board'->7->>'s' = 'pagado' AND v->'board'->8->>'s' = 'pagado', 'D5 aprobado = pagado';
  ASSERT (v->'board'->7->>'m')::boolean, 'D5 el comprador los ve como suyos';
  ASSERT v->'payment'->>'account' = '3001234567', 'D5 el comprador con números ve la cuenta del creador';
END $$;
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000c1',%L,'rechazar','tarde')$$, (SELECT j->>'proof_id' FROM pf)),
  'ALREADY_REVIEWED', 'D6 revisar dos veces');

-- ════════════════════════════════════════════════════════════════════════
-- E · rechazo con motivo
-- ════════════════════════════════════════════════════════════════════════
SELECT public.rifa_reserve_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b2', ARRAY[9]);
CREATE TEMP TABLE pf2 AS SELECT public.rifa_begin_proof_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b2',
  '88888888-8888-4888-8888-000000000002', repeat('c', 64), 'image/png', 900) AS j;
INSERT INTO storage.objects (bucket_id, name) SELECT 'rifa-proofs', j->>'path' FROM pf2;
SELECT public.rifa_confirm_proof_v1((SELECT (j->>'proof_id')::uuid FROM pf2), '77777777-7777-4777-8777-0000000000b2');
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000c1',%L,'rechazar',NULL)$$, (SELECT j->>'proof_id' FROM pf2)),
  'REASON_REQUIRED', 'E1 rechazar sin motivo');
SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000c1', (SELECT (j->>'proof_id')::uuid FROM pf2), 'rechazar', 'El valor no coincide');
DO $$
DECLARE v jsonb := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), '77777777-7777-4777-8777-0000000000b2');
BEGIN
  ASSERT v->'board'->9->>'s' = 'libre', 'E2 rechazado vuelve a libre';
  ASSERT v->'viewer'->'proofs'->0->>'reject_reason' = 'El valor no coincide', 'E2 el comprador ve el motivo';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- F · vencimiento perezoso
-- ════════════════════════════════════════════════════════════════════════
SELECT public.rifa_reserve_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b3', ARRAY[10]);
UPDATE public.rifa_tickets SET reserved_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute'
 WHERE rifa_id = (SELECT id FROM r) AND number = 10 AND state = 'reservado';
DO $$
DECLARE v jsonb := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), NULL);
BEGIN
  ASSERT v->'board'->10->>'s' = 'libre', 'F1 la lectura trata la reserva vencida como libre';
END $$;
SELECT public.rifa_reserve_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b2', ARRAY[10]);
DO $$ BEGIN
  ASSERT (SELECT buyer_id FROM public.rifa_tickets WHERE rifa_id=(SELECT id FROM r) AND number=10 AND state<>'liberado')
    = '77777777-7777-4777-8777-0000000000b2', 'F2 otro reserva el número vencido';
  ASSERT EXISTS (SELECT 1 FROM public.rifa_tickets WHERE rifa_id=(SELECT id FROM r) AND number=10 AND release_reason='vencida'),
    'F2 la reserva vencida queda en el historial';
  ASSERT EXISTS (SELECT 1 FROM public.rifa_events WHERE rifa_id=(SELECT id FROM r) AND kind='reservas_vencidas'), 'F2 auditoría';
END $$;
-- F3 · reintentar la carga no retiene el número para siempre.
UPDATE public.rifa_tickets SET reserved_at = now() - interval '44 minutes 30 seconds', expires_at = now() + interval '5 minutes'
 WHERE rifa_id = (SELECT id FROM r) AND number = 10 AND state = 'reservado';
SELECT pg_temp.expect_fail($$SELECT public.rifa_begin_proof_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b2',
  '88888888-8888-4888-8888-000000000003', repeat('d',64),'image/jpeg',500)$$, 'RESERVATION_EXPIRING', 'F3 carga al límite del tope');

-- ════════════════════════════════════════════════════════════════════════
-- G · venta por fuera
-- ════════════════════════════════════════════════════════════════════════
SELECT pg_temp.expect_fail($$SELECT public.rifa_offline_sale_v1('77777777-7777-4777-8777-0000000000b1',(SELECT id FROM r),20,'Don Pedro','+573190000099',true)$$,
  'CREATOR_ONLY', 'G1 un comprador vende por fuera');
SELECT pg_temp.expect_fail($$SELECT public.rifa_offline_sale_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),20,'Don Pedro','3190000099',true)$$,
  'INVALID_PHONE', 'G1 celular sin formato');
SELECT public.rifa_offline_sale_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM r), 20, 'Don Pedro', '+573190000099', true);
CREATE TEMP TABLE off AS SELECT (public.rifa_offline_sale_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM r), 21, 'Doña Ana', '+573190000098', false)->>'ticket_id')::uuid AS id;
SELECT pg_temp.expect_fail($$SELECT public.rifa_offline_sale_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),7,'Otra','+573190000097',true)$$,
  'NUMBER_TAKEN', 'G2 vender por fuera un número tomado');
SELECT public.rifa_mark_offline_paid_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM off));
SELECT public.rifa_release_ticket_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM off), 'Se arrepintió');
-- Quien compró por fuera el 20 se registra después con ese celular y ve su número.
INSERT INTO auth.users (id, phone, created_at) VALUES ('77777777-7777-4777-8777-0000000000e1', '573190000099', now());
UPDATE public.users SET display_name = 'Don Pedro' WHERE id = '77777777-7777-4777-8777-0000000000e1';
DO $$
DECLARE v jsonb := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), '77777777-7777-4777-8777-0000000000e1');
        l jsonb := public.rifa_my_list_v1('77777777-7777-4777-8777-0000000000e1');
BEGIN
  ASSERT v->'board'->20->>'s' = 'pagado' AND (v->'board'->20->>'m')::boolean, 'G3 la venta por fuera aparece como suya';
  ASSERT v->'board'->21->>'s' = 'libre', 'G3 el 21 liberado vuelve a libre';
  ASSERT jsonb_array_length(l->'bought') = 1 AND l->'bought'->0->'numbers'->0->>'number' = '20', 'G3 aparece en su pestaña RIFAS';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- H · de Pública a Privada con números de otras personas: no
-- ════════════════════════════════════════════════════════════════════════
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_visibility_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),'privada')$$,
  'VISIBILITY_LOCKED', 'H2 Pública→Privada con números tomados');

-- ════════════════════════════════════════════════════════════════════════
-- I · revertir aprobación
-- ════════════════════════════════════════════════════════════════════════
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_unpay_proof_v1('77777777-7777-4777-8777-0000000000c1',%L,'')$$, (SELECT j->>'proof_id' FROM pf)),
  'REASON_REQUIRED', 'I1 revertir sin motivo');
SELECT public.rifa_unpay_proof_v1('77777777-7777-4777-8777-0000000000c1', (SELECT (j->>'proof_id')::uuid FROM pf), 'La transferencia no llegó');
DO $$ BEGIN
  ASSERT (SELECT state FROM public.rifa_tickets WHERE rifa_id=(SELECT id FROM r) AND number=7 AND state<>'liberado') = 'en_revision', 'I2 vuelve a revisión';
  ASSERT (SELECT detail->>'reason' FROM public.rifa_events WHERE rifa_id=(SELECT id FROM r) AND kind='aprobacion_revertida') = 'La transferencia no llegó',
    'I2 auditoría con motivo';
END $$;
SELECT public.rifa_review_proof_v1('77777777-7777-4777-8777-0000000000c1', (SELECT (j->>'proof_id')::uuid FROM pf), 'aprobar', NULL);

-- ════════════════════════════════════════════════════════════════════════
-- J · resultado
-- ════════════════════════════════════════════════════════════════════════
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),7,NULL,NULL,NULL)$$,
  'TOO_EARLY', 'J1 resultado antes del sorteo');
SELECT public.rifa_reserve_v1((SELECT id FROM r), '77777777-7777-4777-8777-0000000000b3', ARRAY[33]);
UPDATE public.rifas SET draw_at = now() - interval '1 minute' WHERE id = (SELECT id FROM r);
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b3',ARRAY[34])$$,
  'RIFA_CLOSED', 'J2 reservar después del cierre');
SELECT pg_temp.expect_fail($$SELECT public.rifa_offline_sale_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),34,'Tarde','+573190000096',true)$$,
  'RIFA_CLOSED', 'J2 vender por fuera después del cierre');
SELECT pg_temp.expect_fail($$SELECT public.rifa_begin_proof_v1((SELECT id FROM r),'77777777-7777-4777-8777-0000000000b3',
  '88888888-8888-4888-8888-000000000004', repeat('e',64),'image/jpeg',500)$$, 'RIFA_CLOSED', 'J2 empezar un comprobante después del sorteo');
-- J2b · después del sorteo el tablero queda congelado para el creador: solo aprobar.
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_unpay_proof_v1('77777777-7777-4777-8777-0000000000c1',%L,'Ya no')$$, (SELECT j->>'proof_id' FROM pf)),
  'DRAW_LOCKED', 'J2b revertir un pago después del sorteo');
SELECT pg_temp.expect_fail(format($$SELECT public.rifa_release_ticket_v1('77777777-7777-4777-8777-0000000000c1',%L,'x')$$,
  (SELECT id FROM public.rifa_tickets WHERE rifa_id=(SELECT id FROM r) AND number=33 AND state<>'liberado')),
  'DRAW_LOCKED', 'J2b liberar después del sorteo');
-- J3 · reservado sin pago a la hora del sorteo = no vendido (no se puede pagar después).
DO $$
DECLARE d text;
BEGIN
  d := pg_temp.expect_fail($q$SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),33,NULL,NULL,NULL)$q$,
    'UNSOLD_CHOICE_REQUIRED', 'J3 ganador con reserva sin pago cuenta como no vendido');
  ASSERT d LIKE 'El 33 no se vendió%', 'J3 mensaje: ' || d;
END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),55,NULL,NULL,NULL)$$,
  'UNSOLD_CHOICE_REQUIRED', 'J4 número no vendido sin decisión');
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000b1',(SELECT id FROM r),55,'desierta',NULL,NULL)$$,
  'CREATOR_ONLY', 'J4 un comprador escribe el resultado');
SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM r), 55, 'volver_a_jugar', now() + interval '3 days', 'Lotería de Medellín');
DO $$ BEGIN
  ASSERT (SELECT status FROM public.rifas WHERE id=(SELECT id FROM r)) = 'abierta', 'J5 volver a jugar deja la rifa abierta';
  ASSERT (SELECT lottery_name FROM public.rifas WHERE id=(SELECT id FROM r)) = 'Lotería de Medellín', 'J5 nueva lotería';
  ASSERT (SELECT count(*) FROM public.rifa_draws WHERE rifa_id=(SELECT id FROM r) AND outcome='volver_a_jugar' AND number=55) = 1, 'J5 historial';
END $$;
-- J5b · tope de 3 repeticiones.
INSERT INTO public.rifa_draws (rifa_id, number, lottery_name, draw_at, outcome, created_by)
SELECT (SELECT id FROM r), n, 'x', now() - interval '1 day', 'volver_a_jugar', '77777777-7777-4777-8777-0000000000c1' FROM (VALUES (90),(91)) v(n);
UPDATE public.rifas SET draw_at = now() - interval '1 minute' WHERE id = (SELECT id FROM r);
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),56,'volver_a_jugar',now()+interval '3 days',NULL)$$,
  'REPLAY_LIMIT', 'J5b cuarta repetición');
DELETE FROM public.rifa_draws WHERE rifa_id = (SELECT id FROM r) AND number IN (90, 91);
UPDATE public.rifas SET draw_at = now() - interval '1 minute' WHERE id = (SELECT id FROM r);
SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1', (SELECT id FROM r), 7, NULL, NULL, NULL);
DO $$
DECLARE c jsonb := public.rifa_creator_view_v1('77777777-7777-4777-8777-0000000000c1', (SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)));
        v jsonb := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), '77777777-7777-4777-8777-0000000000b1');
BEGIN
  ASSERT (SELECT status FROM public.rifas WHERE id=(SELECT id FROM r)) = 'resuelta', 'J6 resuelta';
  ASSERT c->'winner'->>'name' = 'Comprador Uno' AND c->'winner'->>'payout_account' = '3009990004', 'J6 el creador ve cómo pagarle al ganador';
  ASSERT (c->'summary'->>'collected_cop')::int = 6000 * 3, 'J6 recaudado calculado en SQL (7, 8 y 20)';
  ASSERT v->>'winning_number' = '7' AND (v->'draws'->1->>'mine')::boolean, 'J6 el ganador lo ve';
  ASSERT jsonb_array_length(v->'draws') = 2, 'J6 todos ven el historial (55 no vendido y 07)';
END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_set_result_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r),8,NULL,NULL,NULL)$$,
  'RIFA_FINISHED', 'J7 resultado dos veces');

-- ════════════════════════════════════════════════════════════════════════
-- K · privacidad de la vista pública
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text := public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r)), '77777777-7777-4777-8777-0000000000b2')::text;
BEGIN
  ASSERT t NOT LIKE '%Comprador Uno%' AND t NOT LIKE '%Don Pedro%', 'K1 sin nombres de compradores';
  ASSERT t NOT LIKE '%573190000004%' AND t NOT LIKE '%573190000099%', 'K1 sin celulares de compradores';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- A (resto) · quitar el permiso no apaga lo que está en curso; tope de activas
-- ════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE r2 AS SELECT (public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Camiseta firmada','texto',NULL,'Camiseta firmada',
  50,5000,'Chontico','ultimas_dos',now()+interval '2 days','publica','daviplata','3001234567','Creadora Uno')->>'id')::uuid AS id;
SELECT public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Tercera rifa','texto',NULL,'Balón',
  100,5000,'Chontico','ultimas_dos',now()+interval '2 days','privada','nequi','3001234567','Creadora Uno');
SELECT public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Cuarta rifa','texto',NULL,'Gorra',
  100,5000,'Chontico','ultimas_dos',now()+interval '2 days','privada','nequi','3001234567','Creadora Uno');
SELECT pg_temp.expect_fail($$SELECT public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Quinta rifa','texto',NULL,'Termo',
  100,5000,'Chontico','ultimas_dos',now()+interval '2 days','privada','nequi','3001234567','Creadora Uno')$$,
  'MAX_ACTIVE_RIFAS', 'A5 tope de rifas activas (3 abiertas)');
SELECT pg_temp.expect_fail($$SELECT public.rifa_revoke_creator_v1('77777777-7777-4777-8777-0000000000b1','77777777-7777-4777-8777-0000000000c1')$$,
  'ADMIN_REQUIRED', 'A6 un no-admin quita el permiso');
SELECT public.rifa_revoke_creator_v1('77777777-7777-4777-8777-0000000000a1', '77777777-7777-4777-8777-0000000000c1');
SELECT pg_temp.expect_fail($$SELECT public.rifa_create_v1('77777777-7777-4777-8777-0000000000c1','Otra','texto',NULL,'Algo',
  100,5000,'Chontico','ultimas_dos',now()+interval '2 days','privada','nequi','3001234567','Creadora Uno')$$,
  'CREATOR_REQUIRED', 'A6 sin permiso ya no crea');
-- Premio en texto: no pide cuenta de cobro. La rifa en curso sigue vendiendo.
UPDATE public.users SET default_payout_method = NULL, default_payout_account = NULL WHERE id = '77777777-7777-4777-8777-0000000000c2';
SELECT public.rifa_reserve_v1((SELECT id FROM r2), '77777777-7777-4777-8777-0000000000c2', ARRAY[3]);
DO $$ BEGIN
  ASSERT (SELECT revoked_by FROM public.rifa_creators WHERE user_id='77777777-7777-4777-8777-0000000000c1') = '77777777-7777-4777-8777-0000000000a1', 'A6 revoked_by';
  ASSERT EXISTS (SELECT 1 FROM public.rifa_events WHERE kind='creador_retirado'), 'A6 queda registro';
  ASSERT (SELECT (x->>'active_rifas')::int FROM jsonb_array_elements(public.rifa_admin_creators_v1('77777777-7777-4777-8777-0000000000a1')) x
          WHERE x->>'user_id' = '77777777-7777-4777-8777-0000000000c1') = 3, 'A6 lista de creadores con activas';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- L · ocultar (admin) y reportar
-- ════════════════════════════════════════════════════════════════════════
SELECT public.rifa_report_v1('77777777-7777-4777-8777-0000000000b3', (SELECT id FROM r2), 'Parece falsa');
SELECT pg_temp.expect_fail($$SELECT public.rifa_admin_hide_v1('77777777-7777-4777-8777-0000000000c1',(SELECT id FROM r2),true,'x')$$,
  'ADMIN_REQUIRED', 'L1 un no-admin oculta');
SELECT public.rifa_admin_hide_v1('77777777-7777-4777-8777-0000000000a1', (SELECT id FROM r2), true, 'Reportada, en revisión');
SELECT pg_temp.expect_fail($$SELECT public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r2)),'77777777-7777-4777-8777-0000000000b3')$$,
  'RIFA_NOT_FOUND', 'L2 oculta: quien no compró no la ve');
SELECT pg_temp.expect_fail($$SELECT public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r2)),NULL)$$,
  'RIFA_NOT_FOUND', 'L2 oculta: sin sesión no la ve');
DO $$ BEGIN
  ASSERT public.rifa_public_view_v1((SELECT slug FROM public.rifas WHERE id=(SELECT id FROM r2)), '77777777-7777-4777-8777-0000000000c2')->>'hidden' = 'true',
    'L2 oculta: quien ya compró sigue viendo su número';
  ASSERT (public.rifa_admin_list_v1('77777777-7777-4777-8777-0000000000a1')->0->>'reports')::int >= 0, 'L3 listado admin';
END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_reserve_v1((SELECT id FROM r2),'77777777-7777-4777-8777-0000000000c2',ARRAY[4])$$,
  'RIFA_HIDDEN', 'L2 oculta: no se reserva');

-- ════════════════════════════════════════════════════════════════════════
-- M · embudo: solo cuentas creadas después de abrir el enlace sin sesión
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  ASSERT public.rifa_record_signup_v1('77777777-7777-4777-8777-0000000000b1', (SELECT id FROM r), now() - interval '1 hour') = false,
    'M1 una cuenta vieja no cuenta como registro por la rifa';
  ASSERT public.rifa_record_signup_v1('77777777-7777-4777-8777-0000000000e1', (SELECT id FROM r), now() - interval '10 minutes') = true,
    'M1 la cuenta nueva sí';
  ASSERT public.rifa_record_signup_v1('77777777-7777-4777-8777-0000000000e1', (SELECT id FROM r), now() - interval '10 minutes') = false,
    'M1 una sola vez';
  PERFORM public.rifa_track_view_v1((SELECT id FROM r), NULL);
  PERFORM public.rifa_track_view_v1((SELECT id FROM r), NULL);
  ASSERT (SELECT (x->>'anonymous_views')::int FROM jsonb_array_elements(public.rifa_funnel_v1('77777777-7777-4777-8777-0000000000a1')) x
          WHERE x->>'rifa_id' = (SELECT id FROM r)::text) = 2, 'M2 visitas sin sesión';
  ASSERT (SELECT (x->>'signups')::int FROM jsonb_array_elements(public.rifa_funnel_v1('77777777-7777-4777-8777-0000000000a1')) x
          WHERE x->>'rifa_id' = (SELECT id FROM r)::text) = 1, 'M2 cuentas nuevas';
END $$;
SELECT pg_temp.expect_fail($$SELECT public.rifa_funnel_v1('77777777-7777-4777-8777-0000000000b1')$$, 'ADMIN_REQUIRED', 'M3 embudo solo admin');

\echo 'rifas-check: OK (A–M)'
ROLLBACK;
