-- 119_telegram_login_requests.sql — Login por Telegram v2: sin códigos.
--
-- Numeración: 118 la reservó la rama de UI de Casa (sin mergear al crear esta).
--
-- Feedback del dueño sobre v1 (115): pedir el código al bot y escribirlo en la
-- web no se entendía, y el botón «Compartir mi número» quedaba escondido. Pidió
-- un enlace de un solo uso que dure 5 minutos y abra una sola sesión. v2:
--
--   1. /login crea una SOLICITUD atada al navegador (cookie httpOnly con un
--      secreto; aquí solo su sha256) y abre t.me/<bot>?start=<nonce>.
--   2. En Telegram, una cuenta ya vinculada (telegram_login_identities, 115)
--      recibe el enlace sin volver a compartir el número. Una cuenta nueva
--      comparte su número UNA vez (misma prueba de propiedad de 115).
--   3. El bot manda un ENLACE de un solo uso que vence en 5 minutos, guardado
--      en la fila de la solicitud («approved» = cuenta confirmada y enlace
--      emitido). SOLO el enlace abre sesión, y la abre en el navegador que lo
--      abre: si tiene la cookie de esa solicitud entra sin confirmar; si no,
--      confirma viendo el número enmascarado.
--   4. La pestaña que pidió NUNCA abre sesión con su cookie: consulta el estado
--      y, si el enlace se abrió en ese mismo navegador, ya tiene la sesión.
--      Así nadie puede crear una solicitud, hacerle llegar el deep link a otra
--      persona y quedarse con su sesión cuando ella toca Iniciar (phishing tipo
--      device code): el enlace llega solo al Telegram de quien aprueba.
--
-- Sin nonce (alguien que escribe al bot directo) la fila nace aprobada, sin
-- navegador. Las tablas y funciones de 115 NO se borran: telegram_login_tokens
-- y sus funciones de código quedan sin uso. Se reutilizan
-- telegram_login_identities, telegram_login_identity_status,
-- telegram_login_authorize y telegram_login_chats (con columnas nuevas).
--
-- Todo es service_role: RLS activado con deny-all explícito, REVOKE a PUBLIC,
-- anon y authenticated, SECURITY DEFINER con search_path fijo.

-- ── 1. Solicitudes ─────────────────────────────────────────────────────────
CREATE TABLE public.telegram_login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 del nonce del deep link. NULL = enlace emitido por el bot sin navegador.
  nonce_hash text UNIQUE CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  -- sha256 del secreto de la cookie lp_tg_req del navegador que pidió.
  browser_hash text UNIQUE CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  -- HMAC-SHA256 (pepper del servidor) del token del enlace de un solo uso.
  link_token_hash text UNIQUE CHECK (link_token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'consumed', 'expired', 'cancelled')),
  -- Idioma y dominio del enlace (las cookies de sesión son host-only).
  locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en')),
  telegram_user_id bigint CHECK (telegram_user_id > 0),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  requester_ip inet,
  -- "Windows en Bogotá, CO": se muestra en Telegram para reconocer el ingreso.
  requester_label text CHECK (char_length(requester_label) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Pendiente: created_at + 5 min. Al aprobar (o emitir el enlace): + 5 min
  -- desde ese momento, que es lo que dura el enlace.
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  CONSTRAINT telegram_login_requests_browser_pair
    CHECK ((nonce_hash IS NULL) = (browser_hash IS NULL)),
  CONSTRAINT telegram_login_requests_bot_link_born_approved
    CHECK (nonce_hash IS NOT NULL OR status <> 'pending'),
  CONSTRAINT telegram_login_requests_approved_fields
    CHECK (
      status NOT IN ('approved', 'consumed')
      OR (telegram_user_id IS NOT NULL AND user_id IS NOT NULL
          AND phone_e164 IS NOT NULL AND approved_at IS NOT NULL
          AND link_token_hash IS NOT NULL)
    ),
  CONSTRAINT telegram_login_requests_consumed_at
    CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE INDEX telegram_login_requests_created_idx
  ON public.telegram_login_requests (created_at DESC);
CREATE INDEX telegram_login_requests_tg_user_idx
  ON public.telegram_login_requests (telegram_user_id, approved_at DESC);
CREATE INDEX telegram_login_requests_user_idx
  ON public.telegram_login_requests (user_id);

ALTER TABLE public.telegram_login_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_login_requests_deny_all ON public.telegram_login_requests
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.telegram_login_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.telegram_login_requests TO service_role;

COMMENT ON TABLE public.telegram_login_requests IS
  'Service-role only. Login por Telegram v2: solicitud atada a un navegador
   (sha256 del nonce y del secreto de cookie) y enlace de un solo uso (HMAC).
   Solo el enlace abre sesión, una sola vez, en el navegador que lo abre.';

-- ── 2. Estado del chat con el bot ──────────────────────────────────────────
-- pending_request_id: solicitud que trajo el /start mientras se espera el
--   contacto (el contacto llega en otro mensaje, sin payload).
-- contact_prompted_at: para no repetir el mensaje largo en cada texto.
-- reply_keyboard_open: v1 dejaba el teclado «Compartir mi número» abierto; los
--   chats existentes arrancan en true para quitarlo en el próximo mensaje.
ALTER TABLE public.telegram_login_chats
  ADD COLUMN pending_request_id uuid
    REFERENCES public.telegram_login_requests(id) ON DELETE SET NULL,
  ADD COLUMN contact_prompted_at timestamptz,
  ADD COLUMN reply_keyboard_open boolean NOT NULL DEFAULT true;
ALTER TABLE public.telegram_login_chats
  ALTER COLUMN reply_keyboard_open SET DEFAULT false;

-- ── 3. Crear solicitud del navegador ───────────────────────────────────────
-- Balde del tope por origen: la IPv4 exacta y, en IPv6, el /64 (una conexión
-- IPv6 suele traer un /64 entero: contar por dirección exacta no frena nada).
CREATE FUNCTION public.telegram_login_ip_bucket(p_ip inet)
RETURNS inet
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_ip IS NULL THEN NULL
    WHEN family(p_ip) = 6 THEN network(set_masklen(p_ip, 64))
    ELSE set_masklen(p_ip, 32)
  END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_ip_bucket(inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_ip_bucket(inet) TO service_role;

CREATE INDEX telegram_login_requests_ip_bucket_idx
  ON public.telegram_login_requests (public.telegram_login_ip_bucket(requester_ip), created_at DESC);

-- 'ok' o 'rate_limited'. Tope: 10 solicitudes / 15 min por balde (IPv4 exacta,
-- IPv6 /64; sin IP, un balde común). SIN tope global: con uno, un atacante con
-- unas decenas de IPs llenaba el cupo y dejaba a todos sin Telegram (el
-- respaldo justo cuando el SMS falla). Una fila de más cuesta poco. Se cuenta
-- en esta misma tabla bajo un lock por balde: conteo e insert son atómicos
-- (otp_rate_limits se consulta y se escribe en dos pasos).
CREATE FUNCTION public.telegram_login_request_create(
  p_nonce_hash text,
  p_browser_hash text,
  p_locale text,
  p_requester_ip inet,
  p_requester_label text
) RETURNS TABLE (status text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
  v_bucket inet := public.telegram_login_ip_bucket(p_requester_ip);
BEGIN
  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$'
     OR p_browser_hash IS NULL OR p_browser_hash !~ '^[0-9a-f]{64}$'
     OR p_nonce_hash = p_browser_hash
     OR p_locale IS NULL OR p_locale NOT IN ('es', 'en') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('tglogin:req-ip:' || COALESCE(v_bucket::text, 'unknown'), 0)
  );

  IF (SELECT count(*) FROM public.telegram_login_requests r
       WHERE public.telegram_login_ip_bucket(r.requester_ip) IS NOT DISTINCT FROM v_bucket
         AND r.nonce_hash IS NOT NULL
         AND r.created_at > t - interval '15 minutes') >= 10
  THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.telegram_login_requests
    (nonce_hash, browser_hash, status, locale, requester_ip, requester_label,
     created_at, expires_at)
  VALUES
    (p_nonce_hash, p_browser_hash, 'pending', p_locale, p_requester_ip,
     left(p_requester_label, 80), t, t + interval '5 minutes');

  RETURN QUERY SELECT 'ok'::text, t + interval '5 minutes';
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_request_create(text, text, text, inet, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_request_create(text, text, text, inet, text)
  TO service_role;

-- ── 4. Estado para el navegador ────────────────────────────────────────────
-- invalid | pending | approved | consumed | expired | cancelled. Una fila
-- pendiente o aprobada ya vencida se informa como expired.
CREATE FUNCTION public.telegram_login_request_status(
  p_browser_hash text
) RETURNS TABLE (status text, expires_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
  req public.telegram_login_requests%ROWTYPE;
BEGIN
  IF p_browser_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO req FROM public.telegram_login_requests r
   WHERE r.browser_hash = p_browser_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::timestamptz;
  ELSIF req.status IN ('pending', 'approved') AND req.expires_at <= t THEN
    RETURN QUERY SELECT 'expired'::text, req.expires_at;
  ELSE
    RETURN QUERY SELECT req.status, req.expires_at;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_request_status(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_request_status(text) TO service_role;

-- ── 5. Buscar la solicitud de un deep link (bot) ───────────────────────────
CREATE FUNCTION public.telegram_login_request_find(
  p_nonce_hash text
) RETURNS TABLE (
  request_id uuid,
  status text,
  telegram_user_id bigint,
  locale text,
  requester_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
  req public.telegram_login_requests%ROWTYPE;
BEGIN
  IF p_nonce_hash IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO req FROM public.telegram_login_requests r
   WHERE r.nonce_hash = p_nonce_hash;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT
    req.id,
    CASE WHEN req.status IN ('pending', 'approved') AND req.expires_at <= t
         THEN 'expired' ELSE req.status END,
    req.telegram_user_id,
    req.locale,
    req.requester_label;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_request_find(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_request_find(text) TO service_role;

-- ── 6. Cuentas vinculadas a una cuenta de Telegram ─────────────────────────
-- Con su teléfono en E.164 (auth.users.phone, o el email sintético de los
-- canales sin SMS). Más de una fila = ambiguo: el bot pide el número.
CREATE FUNCTION public.telegram_login_linked_accounts(
  p_telegram_user_id bigint
) RETURNS TABLE (user_id uuid, phone_e164 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tli.user_id,
         CASE WHEN d.digits ~ '^[1-9][0-9]{7,14}$' THEN '+' || d.digits END
    FROM public.telegram_login_identities tli
    JOIN auth.users u ON u.id = tli.user_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), ''),
        substring(COALESCE(u.email, '') FROM '^([0-9]{8,15})@wa\.lapolla\.app$')
      ) AS digits
    ) d
   WHERE p_telegram_user_id IS NOT NULL
     AND tli.telegram_user_id = p_telegram_user_id;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_linked_accounts(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_linked_accounts(bigint) TO service_role;

-- ── 7. Guardas compartidas ─────────────────────────────────────────────────
-- La cuenta acepta esta cuenta de Telegram Y el teléfono resuelve a esa misma
-- cuenta. Aprobar o emitir sin esto no es posible aunque el código TS falle.
CREATE FUNCTION public.telegram_login_grant_is_valid(
  p_telegram_user_id bigint,
  p_user_id uuid,
  p_phone_e164 text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_telegram_user_id IS NOT NULL AND p_telegram_user_id > 0
     AND p_user_id IS NOT NULL
     AND p_phone_e164 IS NOT NULL AND p_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
     AND EXISTS (
       SELECT 1 FROM public.telegram_login_identities tli
        WHERE tli.user_id = p_user_id
          AND tli.telegram_user_id = p_telegram_user_id
     )
     AND public.find_auth_user_id_by_phone(p_phone_e164) = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_grant_is_valid(bigint, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_grant_is_valid(bigint, uuid, text)
  TO service_role;

-- Enlaces emitidos por una cuenta de Telegram: 5 / 15 min y 20 / día.
CREATE FUNCTION public.telegram_login_link_rate_limited(
  p_telegram_user_id bigint,
  p_now timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (SELECT count(*) FROM public.telegram_login_requests r
           WHERE r.telegram_user_id = p_telegram_user_id
             AND r.approved_at > p_now - interval '15 minutes') >= 5
      OR (SELECT count(*) FROM public.telegram_login_requests r
           WHERE r.telegram_user_id = p_telegram_user_id
             AND r.approved_at > p_now - interval '1 day') >= 20;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_link_rate_limited(bigint, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_link_rate_limited(bigint, timestamptz)
  TO service_role;

-- ── 8. Confirmar la cuenta y emitir el enlace de una solicitud ─────────────
-- status: ok | invalid | expired | unavailable | not_linked | rate_limited.
-- Solo una pendiente y vigente. Guarda la cuenta y el hash del enlace que el
-- bot manda a ESA cuenta de Telegram; no le da nada al navegador que pidió
-- (no hay consumo por cookie). Si la MISMA cuenta de Telegram la vuelve a pedir
-- (tocó Iniciar dos veces), se reemplaza el enlace sin extender el plazo.
CREATE FUNCTION public.telegram_login_request_approve(
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

  RETURN QUERY SELECT 'ok'::text, t + interval '5 minutes', req.locale, req.requester_label;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_request_approve(uuid, bigint, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_request_approve(uuid, bigint, uuid, text, text)
  TO service_role;

-- ── 9. Enlace del bot sin navegador ────────────────────────────────────────
-- status: ok | not_linked | rate_limited. Deja un solo enlace suelto vivo por
-- cuenta de Telegram: emitir uno nuevo vence los anteriores sin usar.
CREATE FUNCTION public.telegram_login_link_issue(
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
     AND r.nonce_hash IS NULL
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

-- ── 10. (sin consumo por cookie) ───────────────────────────────────────────
-- A propósito NO existe una función que abra sesión con la cookie del
-- navegador que pidió: esa vía entregaba la sesión de quien aprobaba en
-- Telegram a quien había creado la solicitud. La única vía es el enlace (12).

-- ── 11. Ver un enlace SIN canjearlo ────────────────────────────────────────
-- status: ok | used | expired | invalid. same_browser = el navegador que abre
-- el enlace es el que pidió la solicitud (cookie propia): solo entonces la web
-- entra sin pedir confirmación. Quien abre el enlace ya tiene el token, que
-- solo llegó al Telegram de la cuenta: la cookie sola no alcanza para nada.
CREATE FUNCTION public.telegram_login_link_peek(
  p_link_token_hash text,
  p_browser_hash text
) RETURNS TABLE (status text, phone_e164 text, same_browser boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
  req public.telegram_login_requests%ROWTYPE;
BEGIN
  IF p_link_token_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, false;
    RETURN;
  END IF;
  SELECT * INTO req FROM public.telegram_login_requests r
   WHERE r.link_token_hash = p_link_token_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, false;
  ELSIF req.status = 'consumed' THEN
    RETURN QUERY SELECT 'used'::text, NULL::text, false;
  ELSIF req.status <> 'approved' OR req.expires_at <= t THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, false;
  ELSE
    RETURN QUERY SELECT 'ok'::text, req.phone_e164,
      (req.browser_hash IS NOT NULL AND p_browser_hash IS NOT NULL
       AND req.browser_hash = p_browser_hash);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_link_peek(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_link_peek(text, text) TO service_role;

-- ── 12. Canjear el enlace ──────────────────────────────────────────────────
-- status: ok | used | expired | invalid. Consume la fila entera: una solicitud
-- abre UNA sola sesión, en el navegador que envía el POST con el token.
CREATE FUNCTION public.telegram_login_link_consume(
  p_link_token_hash text,
  p_browser_hash text
) RETURNS TABLE (
  status text,
  user_id uuid,
  telegram_user_id bigint,
  phone_e164 text,
  same_browser boolean
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
  IF p_link_token_hash IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::bigint, NULL::text, false;
    RETURN;
  END IF;

  SELECT * INTO req FROM public.telegram_login_requests r
   WHERE r.link_token_hash = p_link_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::bigint, NULL::text, false;
    RETURN;
  END IF;
  IF req.status = 'consumed' THEN
    RETURN QUERY SELECT 'used'::text, NULL::uuid, NULL::bigint, NULL::text, false;
    RETURN;
  END IF;
  IF req.status <> 'approved' OR req.expires_at <= t THEN
    IF req.status = 'approved' THEN
      UPDATE public.telegram_login_requests r SET status = 'expired' WHERE r.id = req.id;
    END IF;
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::bigint, NULL::text, false;
    RETURN;
  END IF;

  UPDATE public.telegram_login_requests r
     SET status = 'consumed', consumed_at = t
   WHERE r.id = req.id;

  RETURN QUERY SELECT 'ok'::text, req.user_id, req.telegram_user_id, req.phone_e164,
    (req.browser_hash IS NOT NULL AND p_browser_hash IS NOT NULL
     AND req.browser_hash = p_browser_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_link_consume(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_link_consume(text, text) TO service_role;

-- ── 13. Cancelar ───────────────────────────────────────────────────────────
-- Por el navegador (botón Cancelar: pendiente o aprobada sin usar) o por el bot
-- (el número compartido solo puede entrar por SMS: solo pendiente). Devuelve
-- true si canceló algo.
CREATE FUNCTION public.telegram_login_request_cancel(
  p_browser_hash text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  n integer;
BEGIN
  IF (p_browser_hash IS NULL) = (p_request_id IS NULL) THEN
    RETURN false;
  END IF;

  UPDATE public.telegram_login_requests r
     SET status = 'cancelled'
   WHERE r.nonce_hash IS NOT NULL
     AND (
       (p_browser_hash IS NOT NULL AND r.browser_hash = p_browser_hash
        AND r.status IN ('pending', 'approved'))
       OR
       (p_request_id IS NOT NULL AND r.id = p_request_id AND r.status = 'pending')
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.telegram_login_request_cancel(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_login_request_cancel(text, uuid) TO service_role;
