-- Signed inbound message -> one-time hashed link. Reuse 025; never store the bearer token.
CREATE OR REPLACE FUNCTION public.wa_issue_login_link(
  p_token_hash text, p_phone text, p_expires_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE existing public.wa_magic_tokens%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^wa2:[a-f0-9]{64}$'
     OR p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{7,14}$'
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '15 minutes' THEN
    RETURN 'ignored';
  END IF;
  -- Serialize issuance per sender, including concurrent distinct webhook deliveries.
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-login:' || p_phone, 0));
  SELECT * INTO existing FROM public.wa_magic_tokens WHERE token = p_token_hash;
  IF FOUND THEN
    IF existing.phone_number = p_phone AND existing.consumed_at IS NULL AND existing.expires_at > now() THEN
      RETURN 'retry';
    END IF;
    RETURN 'ignored';
  END IF;
  IF (SELECT count(*) FROM public.wa_magic_tokens
      WHERE phone_number = p_phone AND created_at > now() - interval '1 hour'
        AND token LIKE 'wa2:%') >= 5 THEN RETURN 'limited'; END IF;
  INSERT INTO public.wa_magic_tokens(token, phone_number, expires_at)
    VALUES (p_token_hash, p_phone, p_expires_at);
  RETURN 'issued';
END;
$$;
-- New function only. No changes to existing grants, rows, outbound flags or predictions.
REVOKE ALL ON FUNCTION public.wa_issue_login_link(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_issue_login_link(text, text, timestamptz) TO service_role;
