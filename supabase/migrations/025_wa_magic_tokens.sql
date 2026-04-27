-- 025_wa_magic_tokens.sql
-- One-time magic-link tokens used as a WhatsApp fallback for SMS OTP.
-- Flow: user taps "Probar con WhatsApp" in /login → wa.me/<bot> with a
-- pre-filled message → bot receives it on the webhook, generates a row
-- here, replies with a CTA button containing /api/auth/wa-magic?token=…
-- Tapping the button consumes the token (one-shot) and signs the user
-- in via admin.generateLink + verifyOtp.
--
-- Defense in depth:
--   • token is 64 hex chars (32 random bytes) — not enumerable.
--   • single-use (consumed_at set on first redeem).
--   • short TTL (10 minutes).
--   • RLS denies everything to anon/authenticated; only service-role
--     access. The endpoints already validate phone via the consumer
--     before signing in.

CREATE TABLE IF NOT EXISTS public.wa_magic_tokens (
  token TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  ip_address TEXT NULL
);

CREATE INDEX IF NOT EXISTS wa_magic_tokens_phone_idx
  ON public.wa_magic_tokens (phone_number);

CREATE INDEX IF NOT EXISTS wa_magic_tokens_expires_idx
  ON public.wa_magic_tokens (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.wa_magic_tokens ENABLE ROW LEVEL SECURITY;

-- No anon / authenticated policies on purpose. Only service-role
-- (the bot webhook + the consumer endpoint) ever touches this table.
-- The default behavior with RLS enabled and zero policies is "deny all"
-- for non-service-role roles, which is what we want.

COMMENT ON TABLE public.wa_magic_tokens IS
  'One-time WhatsApp magic-login tokens. Service-role only. See migration 025.';
