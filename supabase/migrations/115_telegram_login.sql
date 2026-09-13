-- 115_telegram_login.sql — Login alternativo por Telegram (segunda vía al SMS).
--
-- Numeración: 110/111 los usa la rama de calendario (claude/api-football-calendar)
-- todavía sin mergear. 115 deja margen para no chocar; los huecos no importan.
--
-- Flujo: un bot de Telegram PROPIO (no el del admin) pide al usuario que comparta
-- SU contacto (request_contact). Telegram garantiza que ese contacto es el número
-- de la cuenta cuando contact.user_id = from.id. El servidor emite un código de
-- 6 dígitos y un enlace de un solo uso. Aquí se guardan SOLO hashes HMAC con pepper
-- del servidor: ni el código ni el enlace existen en claro en la base.
--
-- Todo es service_role: RLS activado, sin políticas para usuarios (deny-all
-- explícito) y EXECUTE revocado de anon/authenticated en cada función.

-- ── 1. Tokens ──────────────────────────────────────────────────────────────
CREATE TABLE public.telegram_login_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  telegram_user_id bigint NOT NULL CHECK (telegram_user_id > 0),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  link_token_hash text NOT NULL UNIQUE CHECK (link_token_hash ~ '^[0-9a-f]{64}$'),
  -- Vence a los 10 minutos. Invalidar un token = llevar expires_at a now():
  -- lo hace una emisión nueva para el mismo teléfono, un consumo, o agotar
  -- los intentos del código.
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX telegram_login_tokens_phone_idx
  ON public.telegram_login_tokens (phone_e164, created_at DESC);
CREATE INDEX telegram_login_tokens_tg_user_idx
  ON public.telegram_login_tokens (telegram_user_id, created_at DESC);

ALTER TABLE public.telegram_login_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_login_tokens_deny_all ON public.telegram_login_tokens
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.telegram_login_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.telegram_login_tokens TO service_role;

COMMENT ON TABLE public.telegram_login_tokens IS
  'Service-role only. Códigos/enlaces de login emitidos por el bot de Telegram.
   Solo hashes HMAC-SHA256 con pepper del servidor. Un solo uso: consumir el
   código o el enlace invalida ambos.';

-- ── 2. Idioma del chat (deep link ?start=login | login_en) ─────────────────
-- El contacto llega en un mensaje aparte del /start, sin payload. Guardamos el
-- idioma elegido en el /start para responder y armar el enlace en el dominio
-- correcto (las cookies de sesión son host-only).
CREATE TABLE public.telegram_login_chats (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id > 0),
  locale text NOT NULL CHECK (locale IN ('es', 'en')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_login_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_login_chats_deny_all ON public.telegram_login_chats
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.telegram_login_chats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.telegram_login_chats TO service_role;

-- ── 3. Rate limit de verificación en la tabla existente ────────────────────
-- 'telegram_verify' = intentos de código por teléfono (5 / 15 min).
-- 'wa_magic' ya lo usaba lib/auth/rate-limit.ts pero NUNCA entró al CHECK
-- (verificado en prod el 2026-09-13): su insert fallaba en silencio y el límite
-- del magic-link de WhatsApp no bloqueaba. Se incluye para que el constraint
-- refleje los tipos que el código usa.
ALTER TABLE public.otp_rate_limits
  DROP CONSTRAINT IF EXISTS otp_rate_limits_attempt_type_check;
ALTER TABLE public.otp_rate_limits
  ADD CONSTRAINT otp_rate_limits_attempt_type_check
  CHECK (attempt_type::text = ANY (ARRAY[
    'generate'::varchar,
    'verify'::varchar,
    'join_code'::varchar,
    'password'::varchar,
    'wa_magic'::varchar,
    'telegram_verify'::varchar
  ]::text[]));

-- ── 4. Emitir (atómico) ────────────────────────────────────────────────────
-- Serializa por teléfono y por usuario de Telegram, aplica los topes y deja un
-- solo token vivo por teléfono. Devuelve 'ok' o 'rate_limited'.
CREATE FUNCTION public.telegram_login_issue(
  p_phone_e164 text,
  p_telegram_user_id bigint,
  p_code_hash text,
  p_link_token_hash text,
  p_ttl_seconds integer DEFAULT 600
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz := clock_timestamp();
  ttl integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 600), 60), 600);
BEGIN
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     OR p_telegram_user_id IS NULL OR p_telegram_user_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- Orden fijo de locks (teléfono, luego usuario) para no crear deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended('tglogin:phone:' || p_phone_e164, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('tglogin:tg:' || p_telegram_user_id::text, 0));

  -- 3 emisiones / 15 min y 10 / día, por teléfono y por cuenta de Telegram.
  IF (SELECT count(*) FROM public.telegram_login_tokens
       WHERE phone_e164 = p_phone_e164 AND created_at > t - interval '15 minutes') >= 3
     OR (SELECT count(*) FROM public.telegram_login_tokens
       WHERE phone_e164 = p_phone_e164 AND created_at > t - interval '1 day') >= 10
     OR (SELECT count(*) FROM public.telegram_login_tokens
       WHERE telegram_user_id = p_telegram_user_id AND created_at > t - interval '15 minutes') >= 3
     OR (SELECT count(*) FROM public.telegram_login_tokens
       WHERE telegram_user_id = p_telegram_user_id AND created_at > t - interval '1 day') >= 10
  THEN
    RETURN 'rate_limited';
  END IF;

  -- Emitir uno nuevo invalida los anteriores del mismo teléfono.
  UPDATE public.telegram_login_tokens
     SET expires_at = t
   WHERE phone_e164 = p_phone_e164
     AND consumed_at IS NULL
     AND expires_at > t;

  INSERT INTO public.telegram_login_tokens
    (phone_e164, telegram_user_id, code_hash, link_token_hash, expires_at, created_at)
  VALUES
    (p_phone_e164, p_telegram_user_id, p_code_hash, p_link_token_hash,
     t + make_interval(secs => ttl), t);

  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_issue(text, bigint, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_issue(text, bigint, text, text, integer)
  TO service_role;

-- ── 5. Canjear por código ──────────────────────────────────────────────────
-- 'ok' solo si el hash coincide con el ÚNICO token vivo del teléfono. Cada fallo
-- suma un intento; al quinto el token muere (y con él su enlace). Nunca dice si
-- el teléfono tiene token: los fallos devuelven siempre 'invalid'.
-- Con 'ok' devuelve la cuenta de Telegram que pidió el código: la sesión solo se
-- abre si esa cuenta está autorizada para la cuenta de La Polla (sección 9).
CREATE FUNCTION public.telegram_login_redeem_code(
  p_phone_e164 text,
  p_code_hash text
) RETURNS TABLE (status text, telegram_user_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz := clock_timestamp();
  tok public.telegram_login_tokens%ROWTYPE;
BEGIN
  IF p_phone_e164 IS NULL OR p_code_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO tok
    FROM public.telegram_login_tokens tlt
   WHERE tlt.phone_e164 = p_phone_e164
     AND tlt.consumed_at IS NULL
     AND tlt.expires_at > t
   ORDER BY tlt.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND OR tok.attempts >= 5 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint;
    RETURN;
  END IF;

  IF tok.code_hash = p_code_hash THEN
    UPDATE public.telegram_login_tokens tlt
       SET consumed_at = t, expires_at = LEAST(tlt.expires_at, t)
     WHERE tlt.id = tok.id;
    RETURN QUERY SELECT 'ok'::text, tok.telegram_user_id;
    RETURN;
  END IF;

  UPDATE public.telegram_login_tokens tlt
     SET attempts = tlt.attempts + 1,
         expires_at = CASE WHEN tlt.attempts + 1 >= 5 THEN t ELSE tlt.expires_at END
   WHERE tlt.id = tok.id;
  RETURN QUERY SELECT 'invalid'::text, NULL::bigint;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_redeem_code(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_redeem_code(text, text)
  TO service_role;

-- ── 6. Canjear por enlace ──────────────────────────────────────────────────
-- Devuelve (status, phone_e164, telegram_user_id). status: ok | used | expired
-- | invalid. phone_e164 y telegram_user_id solo viajan con 'ok'.
-- Solo lo llama el POST same-origin de /api/auth/telegram-link, después de que
-- la persona vio el número enmascarado y confirmó (el GET usa la sección 7).
CREATE FUNCTION public.telegram_login_redeem_link(
  p_link_token_hash text
) RETURNS TABLE (status text, phone_e164 text, telegram_user_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz := clock_timestamp();
  tok public.telegram_login_tokens%ROWTYPE;
BEGIN
  IF p_link_token_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO tok
    FROM public.telegram_login_tokens tlt
   WHERE tlt.link_token_hash = p_link_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::bigint;
    RETURN;
  END IF;
  IF tok.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used'::text, NULL::text, NULL::bigint;
    RETURN;
  END IF;
  IF tok.expires_at <= t OR tok.attempts >= 5 THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::bigint;
    RETURN;
  END IF;

  UPDATE public.telegram_login_tokens tlt
     SET consumed_at = t, expires_at = LEAST(tlt.expires_at, t)
   WHERE tlt.id = tok.id;

  RETURN QUERY SELECT 'ok'::text, tok.phone_e164, tok.telegram_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_redeem_link(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_redeem_link(text)
  TO service_role;

-- ── 7. Ver un enlace SIN canjearlo ─────────────────────────────────────────
-- El GET del enlace no abre sesión: muestra el número enmascarado y un botón
-- que hace el POST. Así un enlace ajeno reenviado por chat no mete a nadie en
-- la cuenta de otro sin verlo, y un escáner o una vista previa no lo queman.
-- Mismos estados que el canje; phone_e164 solo viaja con 'ok'.
CREATE FUNCTION public.telegram_login_peek_link(
  p_link_token_hash text
) RETURNS TABLE (status text, phone_e164 text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz := clock_timestamp();
  tok public.telegram_login_tokens%ROWTYPE;
BEGIN
  IF p_link_token_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO tok
    FROM public.telegram_login_tokens tlt
   WHERE tlt.link_token_hash = p_link_token_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
  ELSIF tok.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used'::text, NULL::text;
  ELSIF tok.expires_at <= t OR tok.attempts >= 5 THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text;
  ELSE
    RETURN QUERY SELECT 'ok'::text, tok.phone_e164;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_peek_link(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_peek_link(text)
  TO service_role;

-- ── 8. Cuenta de Telegram autorizada por cuenta de La Polla ────────────────
-- El número que Telegram tiene asociado a una cuenta NO prueba quién tiene hoy
-- la SIM: si la operadora recicla el número y el dueño anterior lo conserva en
-- Telegram, ese dueño anterior sigue "teniendo" el número allá. Por eso el
-- teléfono solo no basta para entrar a una cuenta que YA existe.
--
-- Una fila = esta cuenta de La Polla acepta el login de esta cuenta de Telegram.
-- Se crea cuando Telegram crea la cuenta, o en el primer login de una cuenta
-- existente solo si el dueño activó TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS (y
-- con eso acepta el riesgo del número reciclado). Después, cualquier otra cuenta
-- de Telegram con ese número tiene que entrar por SMS.
CREATE TABLE public.telegram_login_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL CHECK (telegram_user_id > 0),
  linked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_login_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_login_identities_deny_all ON public.telegram_login_identities
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.telegram_login_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.telegram_login_identities TO service_role;

COMMENT ON TABLE public.telegram_login_identities IS
  'Service-role only. Qué cuenta de Telegram puede iniciar sesión en cada cuenta
   de La Polla. Sin fila, una cuenta existente no acepta Telegram (salvo que el
   dueño active TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS).';

-- ── 9. Estado del teléfono antes de emitir ─────────────────────────────────
-- new: el teléfono no tiene cuenta · linked: la cuenta acepta ESTA cuenta de
-- Telegram · linked_other: acepta otra · unlinked: cuenta sin Telegram.
-- Solo orienta la respuesta del bot; la decisión que abre sesión es la sección 10.
CREATE FUNCTION public.telegram_login_identity_status(
  p_phone_e164 text,
  p_telegram_user_id bigint
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  linked bigint;
BEGIN
  uid := public.find_auth_user_id_by_phone(p_phone_e164);
  IF uid IS NULL THEN
    RETURN 'new';
  END IF;

  SELECT tli.telegram_user_id INTO linked
    FROM public.telegram_login_identities tli
   WHERE tli.user_id = uid;

  IF NOT FOUND THEN
    RETURN 'unlinked';
  END IF;
  RETURN CASE WHEN linked = p_telegram_user_id THEN 'linked' ELSE 'linked_other' END;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_identity_status(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_identity_status(text, bigint)
  TO service_role;

-- ── 10. Autorizar la sesión ────────────────────────────────────────────────
-- true solo si la cuenta de La Polla acepta esta cuenta de Telegram. Con
-- p_allow_first_link (cuenta recién creada por Telegram, o cuentas existentes
-- con la variable del dueño) la primera cuenta de Telegram queda vinculada; la
-- que llegue primero gana y las demás reciben false.
CREATE FUNCTION public.telegram_login_authorize(
  p_user_id uuid,
  p_telegram_user_id bigint,
  p_allow_first_link boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  linked bigint;
BEGIN
  IF p_user_id IS NULL OR p_telegram_user_id IS NULL OR p_telegram_user_id <= 0 THEN
    RETURN false;
  END IF;

  IF COALESCE(p_allow_first_link, false) THEN
    INSERT INTO public.telegram_login_identities (user_id, telegram_user_id)
    VALUES (p_user_id, p_telegram_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT tli.telegram_user_id INTO linked
    FROM public.telegram_login_identities tli
   WHERE tli.user_id = p_user_id;

  RETURN FOUND AND linked = p_telegram_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_authorize(uuid, bigint, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_authorize(uuid, bigint, boolean)
  TO service_role;
