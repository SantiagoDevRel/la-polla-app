-- 060_otp_rate_limits_ip_index.sql
--
-- Índice para el gate de rate-limit por IP (lib/auth/rate-limit.ts →
-- checkIpRateLimit). La query filtra por (ip_address, attempt_type,
-- attempted_at). El índice existente es (phone_number, attempted_at),
-- que no cubre el lookup por IP → sin este índice la query hace seq
-- scan y se degrada a medida que la tabla crece.
--
-- Defensa contra Twilio bill-bombing: un bot que rota números desde una
-- IP queda capado a 8/min + 40/hora por IP.

CREATE INDEX IF NOT EXISTS idx_otp_rate_limits_ip_time
  ON public.otp_rate_limits (ip_address, attempt_type, attempted_at DESC);
