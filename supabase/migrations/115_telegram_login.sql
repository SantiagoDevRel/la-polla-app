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

-- ── 5. Consumir por código ─────────────────────────────────────────────────
-- 'ok' solo si el hash coincide con el ÚNICO token vivo del teléfono. Cada fallo
-- suma un intento; al quinto el token muere (y con él su enlace). Nunca dice si
-- el teléfono tiene token: los fallos devuelven siempre 'invalid'.
CREATE FUNCTION public.telegram_login_consume_code(
  p_phone_e164 text,
  p_code_hash text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz := clock_timestamp();
  tok public.telegram_login_tokens%ROWTYPE;
BEGIN
  IF p_phone_e164 IS NULL OR p_code_hash IS NULL THEN
    RETURN 'invalid';
  END IF;

  SELECT * INTO tok
    FROM public.telegram_login_tokens
   WHERE phone_e164 = p_phone_e164
     AND consumed_at IS NULL
     AND expires_at > t
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND OR tok.attempts >= 5 THEN
    RETURN 'invalid';
  END IF;

  IF tok.code_hash = p_code_hash THEN
    UPDATE public.telegram_login_tokens
       SET consumed_at = t, expires_at = LEAST(expires_at, t)
     WHERE id = tok.id;
    RETURN 'ok';
  END IF;

  UPDATE public.telegram_login_tokens
     SET attempts = attempts + 1,
         expires_at = CASE WHEN attempts + 1 >= 5 THEN t ELSE expires_at END
   WHERE id = tok.id;
  RETURN 'invalid';
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_consume_code(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_consume_code(text, text)
  TO service_role;

-- ── 6. Consumir por enlace ─────────────────────────────────────────────────
-- Devuelve (status, phone_e164). status: ok | used | expired | invalid.
-- phone_e164 solo viaja con 'ok'.
CREATE FUNCTION public.telegram_login_consume_link(
  p_link_token_hash text
) RETURNS TABLE (status text, phone_e164 text)
LANGUAGE plpgsql
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
   WHERE tlt.link_token_hash = p_link_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
    RETURN;
  END IF;
  IF tok.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used'::text, NULL::text;
    RETURN;
  END IF;
  IF tok.expires_at <= t OR tok.attempts >= 5 THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text;
    RETURN;
  END IF;

  UPDATE public.telegram_login_tokens tlt
     SET consumed_at = t, expires_at = LEAST(tlt.expires_at, t)
   WHERE tlt.id = tok.id;

  RETURN QUERY SELECT 'ok'::text, tok.phone_e164;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_consume_link(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_consume_link(text)
  TO service_role;
