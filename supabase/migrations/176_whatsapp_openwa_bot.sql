-- 176_whatsapp_openwa_bot.sql — Bot de jugadores por WhatsApp (OpenWA).
--
-- Un proceso OpenWA en el DGX recibe los mensajes de un número propio de La
-- Polla y un relay los reenvía firmados a /api/whatsapp/openwa. La app responde
-- con las pantallas del bot de Telegram (lib/telegram-player) convertidas a
-- texto con opciones numeradas. Nada de esto toca pronósticos, pagos ni pollas:
-- toda escritura de negocio sigue pasando por las funciones de Casa.
--
-- Apagado por defecto: sin WHATSAPP_OPENWA_BOT_ENABLED=true la ruta responde
-- 404 y estas tablas quedan vacías.
--
-- Todo es service_role: RLS activado con deny-all explícito, sin GRANT a anon
-- ni authenticated, y EXECUTE revocado de PUBLIC/anon/authenticated.

-- ── 1. Conversación por número ──────────────────────────────────────────────
-- phone: dígitos E.164 sin «+» (el número que WhatsApp verificó al registrar la
-- cuenta). flow*: paso de texto en curso, igual que telegram_login_chats.
-- menu: qué callback corresponde a cada número o letra de la última pantalla.
CREATE TABLE public.whatsapp_bot_chats (
  phone text PRIMARY KEY CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  flow text CHECK (flow IN ('name', 'proof', 'photo_pick', 'ticket', 'score', 'answer', 'pay_name', 'pay_account')),
  flow_data jsonb CHECK (flow_data IS NULL OR jsonb_typeof(flow_data) = 'object'),
  flow_at timestamptz,
  menu jsonb CHECK (menu IS NULL OR jsonb_typeof(menu) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_bot_chats_user_idx
  ON public.whatsapp_bot_chats (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.whatsapp_bot_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_bot_chats_deny_all ON public.whatsapp_bot_chats
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.whatsapp_bot_chats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_bot_chats TO service_role;

COMMENT ON TABLE public.whatsapp_bot_chats IS
  'Service-role only. Estado del chat de WhatsApp (OpenWA) por número: cuenta,
   paso de texto en curso y opciones numeradas de la última pantalla.';

-- ── 2. Mensajes recibidos (deduplicación y límite por número) ──────────────
-- OpenWA reintenta una entrega si no recibe 2xx: el id del mensaje de WhatsApp
-- es la clave, así un reintento nunca se procesa dos veces.
CREATE TABLE public.whatsapp_bot_inbound (
  message_id text PRIMARY KEY CHECK (char_length(message_id) BETWEEN 1 AND 200),
  phone text NOT NULL CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'done', 'failed', 'limited')),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_bot_inbound_phone_idx
  ON public.whatsapp_bot_inbound (phone, received_at DESC);

ALTER TABLE public.whatsapp_bot_inbound ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_bot_inbound_deny_all ON public.whatsapp_bot_inbound
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.whatsapp_bot_inbound FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_bot_inbound TO service_role;

-- ── 3. Foto recibida sin paso activo ────────────────────────────────────────
-- Si llega un comprobante antes de elegir la polla, el bot pregunta de cuál es.
-- Mientras tanto la imagen se guarda aquí (base64, máx. 3 MB decodificados) y
-- se borra a las 2 horas (whatsapp_bot_claim_outbox).
CREATE TABLE public.whatsapp_bot_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  mimetype text CHECK (mimetype IS NULL OR char_length(mimetype) <= 100),
  data_b64 text NOT NULL CHECK (char_length(data_b64) BETWEEN 1 AND 4200000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_bot_media_created_idx ON public.whatsapp_bot_media (created_at);

ALTER TABLE public.whatsapp_bot_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_bot_media_deny_all ON public.whatsapp_bot_media
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.whatsapp_bot_media FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.whatsapp_bot_media TO service_role;

-- ── 4. Avisos por enviar (pago confirmado o rechazado, cupo de regalo) ─────
-- La app no puede llamar a OpenWA (vive en el DGX, sin entrada pública): deja
-- el aviso aquí y el relay lo reclama cada pocos segundos.
CREATE TABLE public.whatsapp_bot_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('review', 'referral_gift')),
  dedupe_key text UNIQUE CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4096),
  menu jsonb CHECK (menu IS NULL OR jsonb_typeof(menu) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_bot_outbox_status_idx
  ON public.whatsapp_bot_outbox (status, created_at);

ALTER TABLE public.whatsapp_bot_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_bot_outbox_deny_all ON public.whatsapp_bot_outbox
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.whatsapp_bot_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_bot_outbox TO service_role;

-- ── 5. Reclamar avisos (y limpiar lo vencido) ───────────────────────────────
-- FOR UPDATE SKIP LOCKED: dos relays (o un reintento) nunca reclaman el mismo
-- aviso. Un aviso «sending» que no se confirmó en 2 minutos vuelve a la cola;
-- a los 5 intentos queda «failed». La limpieza va aquí porque el relay llama
-- esta función cada pocos segundos: no hace falta otro cron.
CREATE OR REPLACE FUNCTION public.whatsapp_bot_claim_outbox(p_limit integer DEFAULT 10)
RETURNS TABLE (id uuid, phone text, body text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.whatsapp_bot_media m WHERE m.created_at < now() - interval '2 hours';
  DELETE FROM public.whatsapp_bot_inbound i WHERE i.received_at < now() - interval '7 days';
  DELETE FROM public.whatsapp_bot_outbox o
   WHERE o.status IN ('sent', 'failed') AND o.created_at < now() - interval '30 days';
  UPDATE public.whatsapp_bot_outbox o
     SET status = 'failed', last_error = coalesce(o.last_error, 'max_attempts')
   WHERE o.status = 'sending' AND o.attempts >= 5 AND o.claimed_at < now() - interval '2 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
      FROM public.whatsapp_bot_outbox o
     WHERE (o.status = 'pending'
            OR (o.status = 'sending' AND o.claimed_at < now() - interval '2 minutes' AND o.attempts < 5))
       AND o.created_at > now() - interval '2 days'
     ORDER BY o.created_at
     LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_bot_outbox o
     SET status = 'sending', attempts = o.attempts + 1, claimed_at = now()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.id, o.phone, o.body;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_claim_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_claim_outbox(integer) TO service_role;

-- ── 6. Confirmar un aviso ────────────────────────────────────────────────────
-- Enviado: queda «sent» y sus opciones pasan a ser el menú del chat (responder
-- «1» abre lo que ofrece el aviso), salvo que la persona esté escribiendo algo
-- (boleta, marcador…): ese paso conserva su menú. Falló: vuelve a la cola
-- hasta 5 intentos.
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ack_outbox(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.whatsapp_bot_outbox%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.whatsapp_bot_outbox o WHERE o.id = p_id AND o.status = 'sending' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_ok THEN
    UPDATE public.whatsapp_bot_outbox o SET status = 'sent', sent_at = now(), last_error = NULL WHERE o.id = p_id;
    IF v_row.menu IS NOT NULL THEN
      UPDATE public.whatsapp_bot_chats c SET menu = v_row.menu, updated_at = now()
       WHERE c.phone = v_row.phone AND c.flow IS NULL;
    END IF;
  ELSE
    UPDATE public.whatsapp_bot_outbox o
       SET status = CASE WHEN o.attempts >= 5 THEN 'failed' ELSE 'pending' END,
           last_error = left(coalesce(p_error, 'send_failed'), 300)
     WHERE o.id = p_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_ack_outbox(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ack_outbox(uuid, boolean, text) TO service_role;
