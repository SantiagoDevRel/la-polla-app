-- 120_telegram_login_single_live_link.sql — Login por Telegram v2: un solo
-- enlace vigente por cuenta de Telegram.
--
-- En la prueba real de 119 quedaron DOS enlaces válidos de la misma cuenta
-- durante ~55 s: telegram_login_link_issue solo vencía los enlaces sueltos
-- (sin navegador) y telegram_login_request_approve no vencía ninguno. Un enlace
-- viejo que sigue sirviendo es un enlace más que se puede reenviar o copiar.
--
-- Desde aquí, emitir un enlace (aprobar una solicitud del navegador, volver a
-- aprobarla o emitir uno suelto) vence en la misma transacción TODOS los demás
-- enlaces aprobados y sin usar de esa cuenta de Telegram, con o sin navegador.
-- La pestaña que esperaba una solicitud vencida así ve «vencida» y ofrece pedir
-- otro. Los enlaces ya canjeados no cambian.
--
-- Aditiva: CREATE OR REPLACE de las dos funciones de 119 con la misma firma,
-- sin tablas nuevas. Mismo lock por cuenta de Telegram (tglogin:tg:<id>) que
-- ya serializa aprobaciones y emisiones; el canje (FOR UPDATE de la fila)
-- espera o gana contra el UPDATE de vencimiento, nunca quedan dos vivos.
-- Permisos: solo service_role, reafirmados abajo.
--
-- Regresión: scripts/telegram-login-single-link-check.sql (Supabase local).

-- ── 1. Confirmar la cuenta y emitir el enlace de una solicitud ─────────────
CREATE OR REPLACE FUNCTION public.telegram_login_request_approve(
  p_request_id uuid,
  p_telegram_user_id bigint,
  p_user_id uuid,
  p_phone_e164 text,
  p_link_token_hash text
) RETURNS TABLE (
  status text,
  expires_at timestamptz,
  locale text,
  requester_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
  req public.telegram_login_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_link_token_hash IS NULL
     OR p_link_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF NOT public.telegram_login_grant_is_valid(p_telegram_user_id, p_user_id, p_phone_e164) THEN
    RETURN QUERY SELECT 'not_linked'::text, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tglogin:tg:' || p_telegram_user_id::text, 0));

  SELECT * INTO req FROM public.telegram_login_requests r
   WHERE r.id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR req.nonce_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF req.status IN ('pending', 'approved') AND req.expires_at <= t THEN
    UPDATE public.telegram_login_requests r SET status = 'expired' WHERE r.id = req.id;
    RETURN QUERY SELECT 'expired'::text, req.expires_at, req.locale, req.requester_label;
    RETURN;
  END IF;

  IF req.status = 'approved'
     AND req.telegram_user_id = p_telegram_user_id
     AND req.user_id = p_user_id THEN
    UPDATE public.telegram_login_requests r
       SET link_token_hash = p_link_token_hash
     WHERE r.id = req.id;

    -- 120: el enlace nuevo es el único vivo de esta cuenta de Telegram.
    UPDATE public.telegram_login_requests r
       SET status = 'expired', expires_at = LEAST(r.expires_at, t)
     WHERE r.telegram_user_id = p_telegram_user_id
       AND r.status = 'approved'
       AND r.id <> req.id;

    RETURN QUERY SELECT 'ok'::text, req.expires_at, req.locale, req.requester_label;
    RETURN;
  END IF;

  IF req.status <> 'pending' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::timestamptz, req.locale, NULL::text;
    RETURN;
  END IF;

  IF public.telegram_login_link_rate_limited(p_telegram_user_id, t) THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::timestamptz, req.locale, NULL::text;
    RETURN;
  END IF;

  UPDATE public.telegram_login_requests r
     SET status = 'approved',
         telegram_user_id = p_telegram_user_id,
         user_id = p_user_id,
         phone_e164 = p_phone_e164,
         link_token_hash = p_link_token_hash,
         approved_at = t,
         expires_at = t + interval '5 minutes'
   WHERE r.id = req.id;

  -- 120: el enlace nuevo es el único vivo de esta cuenta de Telegram.
  UPDATE public.telegram_login_requests r
     SET status = 'expired', expires_at = LEAST(r.expires_at, t)
   WHERE r.telegram_user_id = p_telegram_user_id
     AND r.status = 'approved'
     AND r.id <> req.id;

  RETURN QUERY SELECT 'ok'::text, t + interval '5 minutes', req.locale, req.requester_label;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_request_approve(uuid, bigint, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_request_approve(uuid, bigint, uuid, text, text)
  TO service_role;

-- ── 2. Enlace del bot sin navegador ────────────────────────────────────────
-- status: ok | not_linked | rate_limited. 119 vencía solo los enlaces sueltos
-- anteriores; 120 vence también los de solicitudes del navegador.
CREATE OR REPLACE FUNCTION public.telegram_login_link_issue(
  p_telegram_user_id bigint,
  p_user_id uuid,
  p_phone_e164 text,
  p_link_token_hash text,
  p_locale text
) RETURNS TABLE (status text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
BEGIN
  IF p_link_token_hash IS NULL OR p_link_token_hash !~ '^[0-9a-f]{64}$'
     OR p_locale IS NULL OR p_locale NOT IN ('es', 'en') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF NOT public.telegram_login_grant_is_valid(p_telegram_user_id, p_user_id, p_phone_e164) THEN
    RETURN QUERY SELECT 'not_linked'::text, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tglogin:tg:' || p_telegram_user_id::text, 0));

  IF public.telegram_login_link_rate_limited(p_telegram_user_id, t) THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.telegram_login_requests r
     SET status = 'expired', expires_at = LEAST(r.expires_at, t)
   WHERE r.telegram_user_id = p_telegram_user_id
     AND r.status = 'approved';

  INSERT INTO public.telegram_login_requests
    (status, locale, telegram_user_id, user_id, phone_e164, link_token_hash,
     created_at, approved_at, expires_at)
  VALUES
    ('approved', p_locale, p_telegram_user_id, p_user_id, p_phone_e164,
     p_link_token_hash, t, t, t + interval '5 minutes');

  RETURN QUERY SELECT 'ok'::text, t + interval '5 minutes';
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_link_issue(bigint, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_link_issue(bigint, uuid, text, text, text)
  TO service_role;
