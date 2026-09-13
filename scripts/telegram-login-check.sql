-- scripts/telegram-login-check.sql — Regresión de la migración 115 (login por
-- Telegram). SOLO contra Supabase LOCAL: todo corre en una transacción que se
-- revierte al final, no deja filas.
--
--   docker cp scripts/telegram-login-check.sql supabase_db_la-polla:/tmp/tg.sql
--   docker exec supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/tg.sql
--
-- Termina con "telegram-login-check OK". Cualquier ASSERT roto aborta.

\set ON_ERROR_STOP 1
BEGIN;

DO $$
DECLARE
  h text := repeat('a', 64);
  s text;
  r record;
BEGIN
  -- Emisión y reemplazo: solo un token vivo por teléfono.
  ASSERT public.telegram_login_issue('+573000000001', 111, repeat('a',64), repeat('b',64)) = 'ok';
  ASSERT public.telegram_login_issue('+573000000001', 111, repeat('c',64), repeat('d',64)) = 'ok';
  ASSERT (SELECT count(*) FROM public.telegram_login_tokens
           WHERE phone_e164 = '+573000000001' AND expires_at > clock_timestamp()) = 1;
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('b',64));
  ASSERT r.status = 'expired', 'el enlace reemplazado debe estar vencido';

  -- Topes: 3 / 15 min por teléfono y por cuenta de Telegram.
  ASSERT public.telegram_login_issue('+573000000001', 111, repeat('e',64), repeat('f',64)) = 'ok';
  ASSERT public.telegram_login_issue('+573000000001', 111, repeat('1',64), repeat('2',64)) = 'rate_limited';
  ASSERT public.telegram_login_issue('+573000000002', 111, repeat('3',64), repeat('4',64)) = 'rate_limited';

  -- Código: incorrecto suma intento; correcto canjea y devuelve la cuenta de
  -- Telegram; reuso falla; el enlace queda usado.
  SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000001', repeat('0',64));
  ASSERT r.status = 'invalid' AND r.telegram_user_id IS NULL;
  SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000001', repeat('e',64));
  ASSERT r.status = 'ok' AND r.telegram_user_id = 111;
  SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000001', repeat('e',64));
  ASSERT r.status = 'invalid';
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('f',64));
  ASSERT r.status = 'used' AND r.phone_e164 IS NULL AND r.telegram_user_id IS NULL;

  -- Fuerza bruta: 5 fallos matan el token (código y enlace).
  ASSERT public.telegram_login_issue('+573000000009', 222, repeat('5',64), repeat('6',64)) = 'ok';
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000009', repeat('0',64));
    ASSERT r.status = 'invalid';
  END LOOP;
  SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000009', repeat('5',64));
  ASSERT r.status = 'invalid';
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('6',64));
  ASSERT r.status = 'expired';

  -- Enlace: ver NO canjea; canjear funciona una vez, devuelve teléfono y cuenta
  -- de Telegram y anula el código.
  ASSERT public.telegram_login_issue('+573000000010', 333, repeat('7',64), repeat('8',64)) = 'ok';
  SELECT * INTO r FROM public.telegram_login_peek_link(repeat('8',64));
  ASSERT r.status = 'ok' AND r.phone_e164 = '+573000000010';
  SELECT * INTO r FROM public.telegram_login_peek_link(repeat('8',64));
  ASSERT r.status = 'ok', 'ver dos veces no debe quemar el enlace';
  ASSERT (SELECT consumed_at IS NULL FROM public.telegram_login_tokens
           WHERE link_token_hash = repeat('8',64));
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('8',64));
  ASSERT r.status = 'ok' AND r.phone_e164 = '+573000000010' AND r.telegram_user_id = 333;
  SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000010', repeat('7',64));
  ASSERT r.status = 'invalid';
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('8',64));
  ASSERT r.status = 'used';
  SELECT * INTO r FROM public.telegram_login_peek_link(repeat('8',64));
  ASSERT r.status = 'used' AND r.phone_e164 IS NULL;
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('9',64));
  ASSERT r.status = 'invalid';
  SELECT * INTO r FROM public.telegram_login_peek_link(repeat('9',64));
  ASSERT r.status = 'invalid';

  -- Vencimiento.
  ASSERT public.telegram_login_issue('+573000000011', 444, repeat('a',64), repeat('c',64)) = 'ok';
  UPDATE public.telegram_login_tokens SET expires_at = clock_timestamp() - interval '1 second'
   WHERE link_token_hash = repeat('c',64);
  SELECT * INTO r FROM public.telegram_login_redeem_code('+573000000011', repeat('a',64));
  ASSERT r.status = 'invalid';
  SELECT * INTO r FROM public.telegram_login_peek_link(repeat('c',64));
  ASSERT r.status = 'expired' AND r.phone_e164 IS NULL;
  SELECT * INTO r FROM public.telegram_login_redeem_link(repeat('c',64));
  ASSERT r.status = 'expired';

  -- Entrada inválida.
  BEGIN
    PERFORM public.telegram_login_issue('3000000001', 1, h, repeat('e',64));
    ASSERT false, 'teléfono sin + debe fallar';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- Tipos nuevos del rate limit.
  INSERT INTO public.otp_rate_limits(phone_number, attempt_type)
  VALUES ('573000000001', 'telegram_verify'), ('573000000001', 'wa_magic');
END $$;

-- Cuenta de Telegram autorizada por cuenta (número reciclado).
DO $$
DECLARE
  sms_account uuid := 'a0000000-0000-4000-8000-000000000115';
  tg_account uuid := 'b0000000-0000-4000-8000-000000000115';
BEGIN
  -- Teléfono sin cuenta: Telegram puede crearla.
  ASSERT public.telegram_login_identity_status('+573999000001', 901) = 'new';

  -- Cuenta creada por SMS (el dueño actual de la SIM).
  INSERT INTO auth.users (id, phone) VALUES (sms_account, '573999000001');
  ASSERT public.telegram_login_identity_status('+573999000001', 901) = 'unlinked';
  -- Sin la variable del dueño, otra persona con ese número en Telegram no entra
  -- y no queda vinculada.
  ASSERT public.telegram_login_authorize(sms_account, 901, false) = false;
  ASSERT NOT EXISTS (SELECT 1 FROM public.telegram_login_identities WHERE user_id = sms_account);

  -- Cuenta creada por Telegram: queda vinculada a esa cuenta de Telegram.
  INSERT INTO auth.users (id, phone) VALUES (tg_account, '573999000002');
  ASSERT public.telegram_login_authorize(tg_account, 902, true) = true;
  ASSERT public.telegram_login_identity_status('+573999000002', 902) = 'linked';
  ASSERT public.telegram_login_authorize(tg_account, 902, false) = true;
  -- Otra cuenta de Telegram con el mismo número: nunca, ni con primer vínculo.
  ASSERT public.telegram_login_identity_status('+573999000002', 903) = 'linked_other';
  ASSERT public.telegram_login_authorize(tg_account, 903, false) = false;
  ASSERT public.telegram_login_authorize(tg_account, 903, true) = false;
  ASSERT (SELECT telegram_user_id FROM public.telegram_login_identities WHERE user_id = tg_account) = 902;

  -- Con la variable del dueño, la primera cuenta de Telegram de una cuenta SMS
  -- queda vinculada y las siguientes no.
  ASSERT public.telegram_login_authorize(sms_account, 901, true) = true;
  ASSERT public.telegram_login_authorize(sms_account, 904, true) = false;

  -- Entradas nulas.
  ASSERT public.telegram_login_authorize(NULL, 901, true) = false;
  ASSERT public.telegram_login_authorize(sms_account, NULL, true) = false;
END $$;

-- anon y authenticated: ni ejecutar ni leer.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.telegram_login_redeem_link(repeat('8',64)); ASSERT false, 'anon ejecutó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_peek_link(repeat('8',64)); ASSERT false, 'anon vio un enlace';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.telegram_login_tokens; ASSERT false, 'anon leyó tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_authorize('a0000000-0000-4000-8000-000000000115', 1, true); ASSERT false, 'anon autorizó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.telegram_login_issue('+573000000012', 1, repeat('a',64), repeat('d',64)); ASSERT false, 'authenticated ejecutó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_redeem_code('+573000000012', repeat('a',64)); ASSERT false, 'authenticated canjeó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.telegram_login_identity_status('+573000000012', 1); ASSERT false, 'authenticated consultó identidad';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.telegram_login_chats; ASSERT false, 'authenticated leyó chats';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.telegram_login_identities; ASSERT false, 'authenticated leyó identidades';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT 'telegram-login-check OK' AS result;
ROLLBACK;
