-- 006_otp_rate_limits.sql — Rate limiting table for OTP attempts
CREATE TABLE IF NOT EXISTS public.otp_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number varchar NOT NULL,
  attempt_type varchar NOT NULL CHECK (attempt_type IN ('generate', 'verify')),
  attempted_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address varchar
);

-- Index for fast lookups by phone + time
CREATE INDEX IF NOT EXISTS idx_otp_rate_limits_phone_time
  ON public.otp_rate_limits (phone_number, attempted_at DESC);

-- RLS enabled — no user-facing policies (service_role only)
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;
