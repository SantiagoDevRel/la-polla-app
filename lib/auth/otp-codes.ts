// lib/auth/otp-codes.ts — Códigos de error estables entre /api/auth/start-otp y
// /login. Sin imports de servidor: lo usa también el cliente.

/** El teléfono ya usó los SMS de login permitidos en las últimas 24 horas. */
export const DAILY_SMS_CAP_CODE = "daily_sms_cap";

/** Página pública de ayuda a la que remite ese error. */
export const SUPPORT_PATH = "/soporte";
