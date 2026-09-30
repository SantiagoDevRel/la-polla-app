-- Six-digit optional password: no public GoTrue password grant or client-readable hash.
CREATE TABLE public.phone_password_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number text UNIQUE NOT NULL CHECK (phone_number ~ '^[1-9][0-9]{7,14}$'),
  salt text NOT NULL CHECK (salt ~ '^[a-f0-9]{32}$'),
  password_hash text NOT NULL CHECK (password_hash ~ '^[a-f0-9]{128}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.phone_password_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY phone_password_no_client_access ON public.phone_password_credentials
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.phone_password_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.phone_password_credentials TO service_role;

-- Attempts are counted BEFORE expensive hashing. Lock both identities in a stable
-- order so parallel requests cannot pass the same remaining slot. Never delete
-- attempts or relax SMS limits. IP is HMACed; no raw IP/secret is stored here.
CREATE OR REPLACE FUNCTION public.phone_password_reserve_attempt(p_phone text, p_ip_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_lock text;
BEGIN
  IF p_phone !~ '^[1-9][0-9]{7,14}$' OR p_ip_key !~ '^[a-f0-9]{64}$'
     OR p_phone IS NULL OR p_ip_key IS NULL THEN RETURN false; END IF;
  FOR v_lock IN SELECT k FROM unnest(ARRAY['pin-phone:' || p_phone, 'pin-ip:' || p_ip_key]) AS k ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock, 0));
  END LOOP;
  IF (SELECT count(*) FROM public.otp_rate_limits WHERE attempt_type = 'password'
      AND phone_number = p_phone AND attempted_at > now() - interval '15 minutes') >= 5
     OR (SELECT count(*) FROM public.otp_rate_limits WHERE attempt_type = 'password'
      AND phone_number = p_phone AND attempted_at > now() - interval '24 hours') >= 20
     OR (SELECT count(*) FROM public.otp_rate_limits WHERE attempt_type = 'password'
      AND ip_address = p_ip_key AND attempted_at > now() - interval '15 minutes') >= 50
  THEN RETURN false; END IF;
  INSERT INTO public.otp_rate_limits(phone_number, attempt_type, ip_address)
    VALUES (p_phone, 'password', p_ip_key);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.phone_password_reserve_attempt(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_password_reserve_attempt(text, text) TO service_role;
