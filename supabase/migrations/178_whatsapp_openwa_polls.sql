-- Native OpenWA menus. Dormant until the owner enables the existing bot flag.
-- No business writes: callbacks still use the shared player flows and Casa RPCs.
CREATE TABLE public.whatsapp_bot_polls (
  poll_message_id text PRIMARY KEY CHECK (char_length(poll_message_id) BETWEEN 1 AND 200),
  phone text NOT NULL REFERENCES public.whatsapp_bot_chats(phone) ON DELETE CASCADE,
  chat_id text NOT NULL CHECK (chat_id ~ '^[1-9][0-9]{0,39}@(c\.us|lid)$'),
  menu_nonce text NOT NULL CHECK (menu_nonce ~ '^[a-f0-9]{32}$'),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 12),
  vote_key text CHECK (vote_key IS NULL OR vote_key ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
ALTER TABLE public.whatsapp_bot_polls ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_bot_polls_deny_all ON public.whatsapp_bot_polls
  FOR ALL TO public USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.whatsapp_bot_polls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_bot_polls TO service_role;
CREATE INDEX whatsapp_bot_polls_expiry_idx ON public.whatsapp_bot_polls(expires_at);
CREATE INDEX whatsapp_bot_chats_openwa_nonce_idx ON public.whatsapp_bot_chats ((menu->>'nonce'))
  WHERE menu->>'openwa' = '1';

-- The signed acknowledgement contains no account identifier. Resolve its nonce
-- against the server-generated current menu; never infer a phone from a @lid.
CREATE FUNCTION public.whatsapp_bot_register_poll(p_poll_message_id text, p_chat_id text, p_nonce text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_chat public.whatsapp_bot_chats%ROWTYPE;
BEGIN
  IF p_nonce IS NULL OR p_nonce !~ '^[a-f0-9]{32}$' THEN RETURN false; END IF;
  SELECT c.* INTO v_chat FROM public.whatsapp_bot_chats c
   WHERE c.menu->>'openwa' = '1' AND c.menu->>'nonce' = p_nonce FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_chat_id IS NULL OR p_chat_id !~ '^[1-9][0-9]{0,39}@(c\.us|lid)$'
     OR (p_chat_id LIKE '%@c.us' AND p_chat_id <> v_chat.phone || '@c.us') THEN RETURN false; END IF;
  INSERT INTO public.whatsapp_bot_polls(poll_message_id, phone, chat_id, menu_nonce, options)
    VALUES (p_poll_message_id, v_chat.phone, p_chat_id, p_nonce, v_chat.menu->'options')
    ON CONFLICT (poll_message_id) DO NOTHING;
  RETURN EXISTS (SELECT 1 FROM public.whatsapp_bot_polls p WHERE p.poll_message_id = p_poll_message_id
    AND p.phone = v_chat.phone AND p.chat_id = p_chat_id AND p.menu_nonce = p_nonce);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_register_poll(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_register_poll(text,text,text) TO service_role;

-- One accepted vote per poll, including changes with a different option/time.
-- Lock the chat first (the same order as registration), then the poll. Concurrent
-- deliveries cannot both claim, and new menus invalidate all older polls.
CREATE FUNCTION public.whatsapp_bot_claim_poll_vote(p_poll_message_id text, p_chat_id text, p_option text, p_vote_key text)
RETURNS TABLE(phone text, chat_id text, callback text, menu_nonce text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text; v_menu jsonb; v_poll public.whatsapp_bot_polls%ROWTYPE; v_callback text;
BEGIN
  SELECT p.phone INTO v_phone FROM public.whatsapp_bot_polls p WHERE p.poll_message_id = p_poll_message_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT c.menu INTO v_menu FROM public.whatsapp_bot_chats c WHERE c.phone = v_phone FOR UPDATE;
  SELECT p.* INTO v_poll FROM public.whatsapp_bot_polls p WHERE p.poll_message_id = p_poll_message_id FOR UPDATE;
  IF NOT FOUND OR v_poll.consumed_at IS NOT NULL OR v_poll.expires_at <= now()
     OR v_poll.chat_id IS DISTINCT FROM p_chat_id OR v_menu->>'openwa' IS DISTINCT FROM '1'
     OR v_menu->>'nonce' IS DISTINCT FROM v_poll.menu_nonce
     OR v_menu->'options' IS DISTINCT FROM v_poll.options
     OR p_vote_key IS NULL OR p_vote_key !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
  SELECT o->>'data' INTO v_callback FROM jsonb_array_elements(v_poll.options) o WHERE o->>'label' = p_option;
  IF v_callback IS NULL THEN RETURN; END IF;
  UPDATE public.whatsapp_bot_polls p SET consumed_at = now(), vote_key = p_vote_key
    WHERE p.poll_message_id = p_poll_message_id;
  RETURN QUERY SELECT v_poll.phone, v_poll.chat_id, v_callback, v_poll.menu_nonce;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_claim_poll_vote(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_claim_poll_vote(text,text,text,text) TO service_role;

-- Return a notice's prepared poll only when no text/proof flow is in progress.
-- The menu is active before the relay sends and acknowledges the native poll.
CREATE FUNCTION public.whatsapp_bot_claim_openwa_outbox(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, phone text, body text, menu jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_item record; v_menu jsonb; v_prepared jsonb;
BEGIN
  FOR v_item IN SELECT * FROM public.whatsapp_bot_claim_outbox(p_limit) LOOP
    SELECT o.menu INTO v_menu FROM public.whatsapp_bot_outbox o WHERE o.id = v_item.id;
    v_prepared := NULL;
    IF v_menu->>'openwa' = '1' THEN
      UPDATE public.whatsapp_bot_chats c SET menu = v_menu, updated_at = now()
       WHERE c.phone = v_item.phone AND c.flow IS NULL
       RETURNING c.menu INTO v_prepared;
    END IF;
    RETURN QUERY SELECT v_item.id, v_item.phone,
      CASE WHEN v_menu->>'openwa' = '1' AND v_prepared IS NULL
        THEN v_menu->>'body' ELSE v_item.body END, v_prepared;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_claim_openwa_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_claim_openwa_outbox(integer) TO service_role;

-- Preserve migration 176's notice semantics, but a delayed acknowledgement of a
-- poll notice must never restore an older menu over a newer player turn.
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ack_outbox(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.whatsapp_bot_outbox%ROWTYPE;
BEGIN
  SELECT o.* INTO v_row FROM public.whatsapp_bot_outbox o WHERE o.id = p_id AND o.status = 'sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_ok THEN
    UPDATE public.whatsapp_bot_outbox o SET status = 'sent', sent_at = now(), last_error = NULL WHERE o.id = p_id;
    IF v_row.menu IS NOT NULL THEN
      UPDATE public.whatsapp_bot_chats c SET menu = v_row.menu, updated_at = now()
       WHERE c.phone = v_row.phone AND c.flow IS NULL
         AND (v_row.menu->>'openwa' IS DISTINCT FROM '1' OR c.menu->>'nonce' = v_row.menu->>'nonce');
    END IF;
  ELSE
    UPDATE public.whatsapp_bot_outbox o
       SET status = CASE WHEN o.attempts >= 5 THEN 'failed' ELSE 'pending' END,
           last_error = left(coalesce(p_error, 'send_failed'), 300) WHERE o.id = p_id;
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_ack_outbox(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ack_outbox(uuid,boolean,text) TO service_role;
