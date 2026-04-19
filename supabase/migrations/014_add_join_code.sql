-- 014_add_join_code.sql — 6-char join code per polla + rate limit extension.
--
-- Adds a unique VARCHAR(6) code to every polla so users can join without
-- an invite link or an admin approval round-trip. The code comes from an
-- unambiguous alphabet (no 0 / O / I / 1 to avoid reading mistakes) and
-- rotates on admin demand. Also extends otp_rate_limits so the same table
-- can throttle join-code attempts by phone.

-- 1. Add join_code column to pollas
ALTER TABLE public.pollas
  ADD COLUMN join_code VARCHAR(6) UNIQUE;

CREATE INDEX idx_pollas_join_code ON public.pollas(join_code)
  WHERE join_code IS NOT NULL;

COMMENT ON COLUMN public.pollas.join_code IS
  '6-char alphanumeric uppercase code (no 0/O/I/1) for direct join.
   Always exactly 1 active code per polla. NULL only between rotations.';

-- 2. Extend otp_rate_limits CHECK to allow join_code attempts
ALTER TABLE public.otp_rate_limits
  DROP CONSTRAINT IF EXISTS otp_rate_limits_attempt_type_check;

ALTER TABLE public.otp_rate_limits
  ADD CONSTRAINT otp_rate_limits_attempt_type_check
  CHECK (attempt_type::text = ANY (ARRAY[
    'generate'::varchar,
    'verify'::varchar,
    'join_code'::varchar
  ]::text[]));
