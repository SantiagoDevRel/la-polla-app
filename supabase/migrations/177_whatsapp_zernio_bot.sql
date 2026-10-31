-- Official WhatsApp transport. Additive, dormant until its server flag is enabled.
ALTER TABLE public.whatsapp_bot_chats
  ADD COLUMN zernio_conversation_id text CHECK (zernio_conversation_id ~ '^[a-f0-9]{24}$'),
  ADD COLUMN zernio_last_inbound_at timestamptz;

-- Saved responses separate business execution from retryable provider delivery.
CREATE TABLE public.whatsapp_zernio_deliveries (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 200),
  phone text NOT NULL REFERENCES public.whatsapp_bot_chats(phone),
  conversation_id text NOT NULL CHECK (conversation_id ~ '^[a-f0-9]{24}$'),
  kind text NOT NULL CHECK (kind IN ('inbound', 'notice')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'sent', 'failed', 'limited')),
  replies jsonb CHECK (replies IS NULL OR jsonb_typeof(replies) = 'array'),
  menu jsonb CHECK (menu IS NULL OR jsonb_typeof(menu) = 'object'),
  lease uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_until timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_zernio_deliveries_phone_idx ON public.whatsapp_zernio_deliveries(phone, lease_until);
ALTER TABLE public.whatsapp_zernio_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_zernio_deliveries_deny_all ON public.whatsapp_zernio_deliveries
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON public.whatsapp_zernio_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_zernio_deliveries TO service_role;

CREATE FUNCTION public.whatsapp_zernio_claim(
  p_key text, p_phone text, p_conversation_id text,
  p_inbound_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.whatsapp_zernio_deliveries;
  c public.whatsapp_bot_chats;
  n integer;
  lease_id uuid := gen_random_uuid();
BEGIN
  IF p_phone !~ '^[1-9][0-9]{7,14}$' OR p_conversation_id !~ '^[a-f0-9]{24}$'
    OR char_length(p_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid bot envelope'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('zernio:' || p_phone, 0));
  IF p_inbound_at IS NOT NULL THEN
    IF p_inbound_at <= now() - interval '10 minutes' OR p_inbound_at > now() + interval '5 minutes' THEN
      RETURN jsonb_build_object('outcome', 'ignored');
    END IF;
    INSERT INTO public.whatsapp_bot_chats(phone, zernio_conversation_id, zernio_last_inbound_at)
      VALUES(p_phone, p_conversation_id, least(p_inbound_at, now()))
      ON CONFLICT(phone) DO UPDATE SET
        zernio_conversation_id = CASE WHEN excluded.zernio_last_inbound_at >= coalesce(whatsapp_bot_chats.zernio_last_inbound_at, '-infinity')
          THEN excluded.zernio_conversation_id ELSE whatsapp_bot_chats.zernio_conversation_id END,
        zernio_last_inbound_at = greatest(whatsapp_bot_chats.zernio_last_inbound_at, excluded.zernio_last_inbound_at);
  END IF;
  SELECT * INTO c FROM public.whatsapp_bot_chats WHERE phone = p_phone;
  IF NOT FOUND OR c.zernio_conversation_id IS DISTINCT FROM p_conversation_id
    OR c.zernio_last_inbound_at IS NULL OR c.zernio_last_inbound_at <= now() - interval '24 hours'
    THEN RETURN jsonb_build_object('outcome', 'ignored'); END IF;

  SELECT * INTO d FROM public.whatsapp_zernio_deliveries WHERE key = p_key;
  IF FOUND THEN
    IF d.phone <> p_phone OR d.conversation_id <> p_conversation_id THEN RAISE EXCEPTION 'bot scope mismatch'; END IF;
    IF d.status IN ('sent', 'failed', 'limited') THEN RETURN jsonb_build_object('outcome', d.status); END IF;
    IF d.lease_until > now() THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
    IF d.status = 'processing' THEN
      -- Never replay uncertain business writes after a crashed invocation.
      UPDATE public.whatsapp_zernio_deliveries SET status = 'failed' WHERE key = p_key;
      UPDATE public.whatsapp_bot_inbound SET status = 'failed' WHERE message_id = p_key AND status = 'processing';
      RETURN jsonb_build_object('outcome', 'failed');
    END IF;
    UPDATE public.whatsapp_zernio_deliveries SET lease = lease_id, lease_until = now() + interval '2 minutes' WHERE key = p_key;
    RETURN jsonb_build_object('outcome', 'ready', 'lease', lease_id, 'replies', d.replies);
  END IF;
  -- Serialize business turns. Notices have independent keys and never change the
  -- active input menu, so an approval during proof processing is not dropped.
  IF p_inbound_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.whatsapp_zernio_deliveries WHERE phone = p_phone
    AND kind = 'inbound' AND status IN ('processing', 'ready') AND lease_until > now()) THEN
    RETURN jsonb_build_object('outcome', 'busy');
  END IF;
  IF p_inbound_at IS NOT NULL THEN
    INSERT INTO public.whatsapp_bot_inbound(message_id, phone) VALUES(p_key, p_phone) ON CONFLICT DO NOTHING;
    SELECT count(*) INTO n FROM public.whatsapp_bot_inbound WHERE phone = p_phone AND received_at >= now() - interval '1 minute';
  END IF;
  INSERT INTO public.whatsapp_zernio_deliveries(key, phone, conversation_id, kind, status, lease)
    VALUES(p_key, p_phone, p_conversation_id, CASE WHEN p_inbound_at IS NULL THEN 'notice' ELSE 'inbound' END,
      CASE WHEN n > 20 THEN 'limited' ELSE 'processing' END, lease_id);
  IF n > 20 THEN
    UPDATE public.whatsapp_bot_inbound SET status = 'limited' WHERE message_id = p_key;
    RETURN jsonb_build_object('outcome', 'limited');
  END IF;
  RETURN jsonb_build_object('outcome', 'new', 'lease', lease_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.whatsapp_zernio_claim(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_zernio_claim(text, text, text, timestamptz) TO service_role;

CREATE FUNCTION public.whatsapp_zernio_prepare(p_key text, p_lease uuid, p_replies jsonb, p_menu jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.whatsapp_zernio_deliveries;
BEGIN
  SELECT * INTO d FROM public.whatsapp_zernio_deliveries WHERE key = p_key AND lease = p_lease
    AND status = 'processing' AND lease_until > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.whatsapp_zernio_deliveries SET replies = p_replies, menu = p_menu, status = 'ready' WHERE key = p_key;
  IF d.kind = 'inbound' AND p_menu IS NOT NULL THEN
    UPDATE public.whatsapp_bot_chats SET menu = p_menu, updated_at = now() WHERE phone = d.phone;
  END IF;
  IF d.kind = 'inbound' THEN UPDATE public.whatsapp_bot_inbound SET status = 'done' WHERE message_id = p_key; END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.whatsapp_zernio_prepare(text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_zernio_prepare(text, uuid, jsonb, jsonb) TO service_role;
