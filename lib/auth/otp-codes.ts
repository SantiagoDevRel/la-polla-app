// lib/auth/otp-codes.ts — Códigos de error estables entre /api/auth/start-otp y
// /login. Sin imports de servidor: lo usa también el cliente.

/** El teléfono ya usó los SMS de login permitidos en las últimas 24 horas. */
export const DAILY_SMS_CAP_CODE = "daily_sms_cap";

/**
 * Supabase Auth rechazó el envío por la captcha (token de Turnstile ausente,
 * vencido, ya usado o de otro dominio). /login pide repetir la verificación.
 */
export const CAPTCHA_FAILED_CODE = "captcha_failed";

/** Página pública de ayuda a la que remite ese error. */
export const SUPPORT_PATH = "/soporte";
