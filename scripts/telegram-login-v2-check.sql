-- scripts/telegram-login-v2-check.sql — Regresión de la migración 119 (login
-- por Telegram v2: solicitud del navegador + enlace de un solo uso). SOLO
-- contra Supabase LOCAL: todo corre en una transacción que se revierte.
--
--   docker cp scripts/telegram-login-v2-check.sql supabase_db_la-polla:/tmp/tg2.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/tg2.sql
--
-- Termina con "telegram-login-v2-check OK". Cualquier ASSERT roto aborta.
-- La regresión de 115 (scripts/telegram-login-check.sql) sigue vigente.

\set ON_ERROR_STOP 1
BEGIN;

DO $$
DECLARE
  linked uuid := 'c0000000-0000-4000-8000-000000000119';
  other uuid := 'd0000000-0000-4000-8000-000000000119';
  req_id uuid;
  r record;
  ok boolean;
  n integer;
BEGIN
  -- Cuenta de La Polla vinculada a la cuenta de Telegram 7001.
  INSERT INTO auth.users (id, phone) VALUES (linked, '573119000001');
  INSERT INTO public.telegram_login_identities (user_id, telegram_user_id) VALUES (linked, 7001);
  -- Otra cuenta, sin Telegram.
  INSERT INTO auth.users (id, phone) VALUES (other, '+573119000002');

  SELECT count(*) INTO n FROM public.telegram_login_linked_accounts(7001);
  ASSERT n = 1;
  SELECT * INTO r FROM public.telegram_login_linked_accounts(7001);
  ASSERT r.user_id = linked AND r.phone_e164 = '+573119000001';
  SELECT count(*) INTO n FROM public.telegram_login_linked_accounts(7999);
  ASSERT n = 0;

  -- ── Crear: 5 minutos, nonce único ──
  SELECT * INTO r FROM public.telegram_login_request_create(
    repeat('1', 64), repeat('a', 64), 'es', '203.0.113.9', 'Windows en Bogotá, CO');
  ASSERT r.status = 'ok';
  SELECT * INTO r FROM public.telegram_login_requests WHERE nonce_hash = repeat('1', 64);
  ASSERT r.status = 'pending' AND r.expires_at - r.created_at = interval '5 minutes',
    'la solicitud vence a los 5 minutos';
  req_id := r.id;

  BEGIN
    PERFORM public.telegram_login_request_create(
      repeat('1', 64), repeat('b', 64), 'es', '203.0.113.9', NULL);
    ASSERT false, 'un nonce repetido no debe entrar';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.telegram_login_request_create(
      repeat('2', 64), repeat('a', 64), 'es', '203.0.113.9', NULL);
    ASSERT false, 'un secreto de navegador repetido no debe entrar';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.telegram_login_request_create('corto', repeat('c', 64), 'es', NULL, NULL);
    ASSERT false, 'hash mal formado debe fallar';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  SELECT * INTO r FROM public.telegram_login_request_status(repeat('a', 64));
  ASSERT r.status = 'pending';
  SELECT * INTO r FROM public.telegram_login_request_status(repeat('f', 64));
  ASSERT r.status = 'invalid';
  SELECT * INTO r FROM public.telegram_login_request_find(repeat('1', 64));
  ASSERT r.request_id = req_id AND r.status = 'pending' AND r.requester_label = 'Windows en Bogotá, CO';

  -- Consumir antes de aprobar: nada.
  SELECT * INTO r FROM public.telegram_login_request_consume(repeat('a', 64));
  ASSERT r.status = 'pending' AND r.user_id IS NULL;

  -- ── Aprobar: solo con vínculo y teléfono de esa misma cuenta ──
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7002, linked, '+573119000001', repeat('9', 64));
  ASSERT r.status = 'not_linked', 'otra cuenta de Telegram no aprueba';
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000002', repeat('9', 64));
  ASSERT r.status = 'not_linked', 'un teléfono de otra cuenta no aprueba';
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, other, '+573119000002', repeat('9', 64));
  ASSERT r.status = 'not_linked', 'una cuenta sin vínculo no aprueba';

  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('9', 64));
  ASSERT r.status = 'ok' AND r.locale = 'es';
  SELECT * INTO r FROM public.telegram_login_requests WHERE id = req_id;
  ASSERT r.status = 'approved' AND r.expires_at - r.approved_at = interval '5 minutes',
    'el enlace vence a los 5 minutos de emitido';
  -- Tocar Iniciar otra vez: mismo usuario reemplaza el enlace.
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('8', 64));
  ASSERT r.status = 'ok';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('9', 64), NULL);
  ASSERT r.status = 'invalid', 'el enlace reemplazado ya no existe';

  -- Ver el enlace no lo quema; la cookie propia se reconoce.
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('8', 64), repeat('a', 64));
  ASSERT r.status = 'ok' AND r.phone_e164 = '+573119000001' AND r.same_browser;
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('8', 64), repeat('e', 64));
  ASSERT r.status = 'ok' AND NOT r.same_browser;
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('8', 64), NULL);
  ASSERT r.status = 'ok' AND NOT r.same_browser;

  -- ── Un solo consumo: navegador, y el enlace ya no sirve ──
  SELECT * INTO r FROM public.telegram_login_request_consume(repeat('a', 64));
  ASSERT r.status = 'ok' AND r.user_id = linked AND r.telegram_user_id = 7001
     AND r.phone_e164 = '+573119000001';
  SELECT * INTO r FROM public.telegram_login_request_consume(repeat('a', 64));
  ASSERT r.status = 'consumed' AND r.user_id IS NULL, 'segundo consumo rechazado';
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('8', 64), NULL);
  ASSERT r.status = 'used' AND r.user_id IS NULL, 'enlace y solicitud son excluyentes';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('8', 64), NULL);
  ASSERT r.status = 'used';
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('7', 64));
  ASSERT r.status = 'unavailable', 'no se reabre una solicitud consumida';

  -- ── Al revés: el enlace consume la solicitud ──
  PERFORM public.telegram_login_request_create(repeat('3', 64), repeat('c', 64), 'en', '203.0.113.9', NULL);
  SELECT request_id INTO req_id FROM public.telegram_login_request_find(repeat('3', 64));
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('6', 64));
  ASSERT r.status = 'ok' AND r.locale = 'en';
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('6', 64), repeat('c', 64));
  ASSERT r.status = 'ok' AND r.user_id = linked AND r.same_browser;
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('6', 64), repeat('c', 64));
  ASSERT r.status = 'used';
  SELECT * INTO r FROM public.telegram_login_request_consume(repeat('c', 64));
  ASSERT r.status = 'consumed' AND r.user_id IS NULL;
  SELECT * INTO r FROM public.telegram_login_request_status(repeat('c', 64));
  ASSERT r.status = 'consumed';

  -- ── Vencimiento ──
  PERFORM public.telegram_login_request_create(repeat('4', 64), repeat('d', 64), 'es', '203.0.113.9', NULL);
  SELECT request_id INTO req_id FROM public.telegram_login_request_find(repeat('4', 64));
  UPDATE public.telegram_login_requests SET expires_at = clock_timestamp() - interval '1 second' WHERE id = req_id;
  SELECT * INTO r FROM public.telegram_login_request_status(repeat('d', 64));
  ASSERT r.status = 'expired';
  SELECT * INTO r FROM public.telegram_login_request_find(repeat('4', 64));
  ASSERT r.status = 'expired';
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('5', 64));
  ASSERT r.status = 'expired', 'una solicitud vencida no se aprueba';
  SELECT * INTO r FROM public.telegram_login_request_consume(repeat('d', 64));
  ASSERT r.status = 'expired';

  -- Aprobada y vencida antes de usarse: ni navegador ni enlace.
  PERFORM public.telegram_login_request_create(repeat('5', 64), repeat('e', 64), 'es', '203.0.113.9', NULL);
  SELECT request_id INTO req_id FROM public.telegram_login_request_find(repeat('5', 64));
  PERFORM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('4', 64));
  UPDATE public.telegram_login_requests SET expires_at = clock_timestamp() - interval '1 second' WHERE id = req_id;
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('4', 64), repeat('e', 64));
  ASSERT r.status = 'expired' AND r.phone_e164 IS NULL;
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('4', 64), repeat('e', 64));
  ASSERT r.status = 'expired';
  SELECT * INTO r FROM public.telegram_login_request_consume(repeat('e', 64));
  ASSERT r.status = 'expired';

  -- ── Cancelar ──
  PERFORM public.telegram_login_request_create(repeat('6', 64), repeat('0', 64), 'es', '203.0.113.9', NULL);
  SELECT request_id INTO req_id FROM public.telegram_login_request_find(repeat('6', 64));
  ASSERT public.telegram_login_request_cancel(p_browser_hash => repeat('0', 64));
  SELECT * INTO r FROM public.telegram_login_request_approve(req_id, 7001, linked, '+573119000001', repeat('3', 64));
  ASSERT r.status = 'unavailable', 'una solicitud cancelada no se aprueba';
  SELECT * INTO r FROM public.telegram_login_request_status(repeat('0', 64));
  ASSERT r.status = 'cancelled';
  ASSERT NOT public.telegram_login_request_cancel(p_browser_hash => repeat('0', 64));
  ASSERT NOT public.telegram_login_request_cancel();

  -- ── Enlace del bot sin navegador: 5 min, uno vivo, un uso ──
  SELECT * INTO r FROM public.telegram_login_link_issue(7001, linked, '+573119000001', repeat('b', 64), 'es');
  ASSERT r.status = 'ok';
  SELECT * INTO r FROM public.telegram_login_requests WHERE link_token_hash = repeat('b', 64);
  ASSERT r.status = 'approved' AND r.nonce_hash IS NULL AND r.browser_hash IS NULL
     AND r.expires_at - r.approved_at = interval '5 minutes';
  SELECT * INTO r FROM public.telegram_login_link_issue(7001, linked, '+573119000001', repeat('c', 64), 'es');
  ASSERT r.status = 'ok';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('b', 64), NULL);
  ASSERT r.status = 'expired', 'emitir otro enlace vence el anterior';
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('c', 64), repeat('a', 64));
  ASSERT r.status = 'ok' AND NOT r.same_browser;
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('c', 64), NULL);
  ASSERT r.status = 'used';
  SELECT * INTO r FROM public.telegram_login_link_issue(7002, linked, '+573119000001', repeat('d', 64), 'es');
  ASSERT r.status = 'not_linked';
  BEGIN
    PERFORM public.telegram_login_link_issue(7001, linked, '+573119000001', 'x', 'es');
    ASSERT false, 'hash de enlace mal formado debe fallar';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- Tope de enlaces por cuenta de Telegram: 5 / 15 min (ya van 5 aprobadas).
  SELECT count(*) INTO n FROM public.telegram_login_requests
   WHERE telegram_user_id = 7001 AND approved_at > clock_timestamp() - interval '15 minutes';
  ASSERT n = 5, format('se esperaban 5 aprobaciones, hay %s', n);
  SELECT * INTO r FROM public.telegram_login_link_issue(7001, linked, '+573119000001', repeat('e', 64), 'es');
  ASSERT r.status = 'rate_limited';

  -- Tope por IP: 10 / 15 min (ya van 5 desde 203.0.113.9).
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM public.telegram_login_request_create(
      md5('n' || i) || md5('n2' || i), md5('b' || i) || md5('b2' || i), 'es', '203.0.113.9', NULL);
    ASSERT r.status = 'ok';
  END LOOP;
  SELECT * INTO r FROM public.telegram_login_request_create(
    repeat('7', 64), repeat('3', 64), 'es', '203.0.113.9', NULL);
  ASSERT r.status = 'rate_limited', 'la solicitud 11 de la misma IP se rechaza';
  SELECT * INTO r FROM public.telegram_login_request_create(
    repeat('7', 64), repeat('3', 64), 'es', '198.51.100.7', NULL);
  ASSERT r.status = 'ok', 'otra IP sigue pudiendo';

  -- Filas coherentes: una aprobada sin cuenta no puede existir.
  BEGIN
    INSERT INTO public.telegram_login_requests (status, expires_at)
    VALUES ('approved', clock_timestamp());
    ASSERT false, 'aprobada sin datos no debe entrar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.telegram_login_requests (nonce_hash, status, expires_at)
    VALUES (repeat('9', 64), 'pending', clock_timestamp());
    ASSERT false, 'nonce sin navegador no debe entrar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Chats: columnas nuevas.
  INSERT INTO public.telegram_login_chats (telegram_user_id, locale) VALUES (7003, 'es');
  SELECT reply_keyboard_open, pending_request_id, contact_prompted_at INTO r
    FROM public.telegram_login_chats WHERE telegram_user_id = 7003;
  ASSERT r.reply_keyboard_open = false AND r.pending_request_id IS NULL AND r.contact_prompted_at IS NULL;
END $$;

-- anon y authenticated: ni ejecutar ni leer.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.telegram_login_requests; ASSERT false, 'anon leyó solicitudes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_request_create(repeat('a',64), repeat('b',64), 'es', NULL, NULL); ASSERT false, 'anon creó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_request_status(repeat('a',64)); ASSERT false, 'anon consultó estado';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_request_consume(repeat('a',64)); ASSERT false, 'anon consumió';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_link_consume(repeat('a',64), NULL); ASSERT false, 'anon canjeó enlace';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_link_peek(repeat('a',64), NULL); ASSERT false, 'anon vio enlace';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.telegram_login_requests; ASSERT false, 'authenticated leyó solicitudes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_request_approve(gen_random_uuid(), 1, gen_random_uuid(), '+573000000000', repeat('a',64)); ASSERT false, 'authenticated aprobó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_link_issue(1, gen_random_uuid(), '+573000000000', repeat('a',64), 'es'); ASSERT false, 'authenticated emitió enlace';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_request_cancel(repeat('a',64)); ASSERT false, 'authenticated canceló';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_linked_accounts(1); ASSERT false, 'authenticated vio vínculos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_request_find(repeat('a',64)); ASSERT false, 'authenticated buscó nonce';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_grant_is_valid(1, gen_random_uuid(), '+573000000000'); ASSERT false, 'authenticated validó grant';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_link_rate_limited(1, now()); ASSERT false, 'authenticated consultó tope';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT 'telegram-login-v2-check OK' AS result;
ROLLBACK;
