-- 017_user_password_and_login_events.sql
-- Foundation for the new auth flow:
--   1) Add has_custom_password flag on users (true once user picks an
--      alphanumeric password during /set-password). New registrations
--      land with false until the user completes the flow.
--   2) Allow 'password' as an attempt_type in otp_rate_limits so the new
--      /api/auth/login-password endpoint can throttle brute force on the
--      same table.
--   3) Add 'login_event' to the notification_type enum so successful
--      logins can be surfaced in /avisos as audit-ish entries.

-- 1. Password flag on users.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS has_custom_password BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.has_custom_password IS
  'True once the user has picked their own password via /set-password.
   False on fresh registration (set after OTP). Middleware redirects users
   with false to /set-password so every authenticated session has a real
   password the user knows.';

-- 2. Extend otp_rate_limits CHECK to include 'password'.
ALTER TABLE public.otp_rate_limits
  DROP CONSTRAINT IF EXISTS otp_rate_limits_attempt_type_check;

ALTER TABLE public.otp_rate_limits
  ADD CONSTRAINT otp_rate_limits_attempt_type_check
  CHECK (attempt_type::text = ANY (ARRAY[
    'generate'::varchar,
    'verify'::varchar,
    'join_code'::varchar,
    'password'::varchar
  ]::text[]));

-- 3. Add login_event to notification_type enum.
-- Postgres ENUMs are append-only; ALTER TYPE ... ADD VALUE handles this.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'login_event';
