-- 023_drop_legacy_otp_artifacts.sql
-- Cleanup tras migracion completa de WhatsApp OTP a Twilio Verify SMS.
-- Ningun codigo en main las referencia desde el merge feat/twilio-sms-auth.
--
-- Aplicado en prod via MCP el 2026-04-27. Este archivo es para tracking
-- en el repo (sirve como source-of-truth si re-creamos el proyecto).

DROP TABLE IF EXISTS public.login_pending_sessions;
DROP TABLE IF EXISTS public.whatsapp_conversation_state;

ALTER TABLE public.users DROP COLUMN IF EXISTS has_custom_password;
