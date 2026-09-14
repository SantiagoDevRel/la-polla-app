// lib/auth/captcha.ts — Token de Cloudflare Turnstile en el envío del SMS.
//
// El navegador resuelve el widget de Turnstile en /login y manda el token a
// /api/auth/start-otp, que lo reenvía a Supabase Auth en
// signInWithOtp({ options: { captchaToken } }). La verificación contra
// Cloudflare la hace SUPABASE (security_captcha_provider=turnstile + secret en
// la configuración de Auth), no este servidor: un token de Turnstile es de un
// solo uso, así que verificarlo aquí primero lo quemaría y Supabase lo
// rechazaría por duplicado.
//
// Mientras security_captcha_enabled=false, Supabase ignora el token: el código
// puede desplegarse antes de activar la captcha sin cambiar el login.
// Activación y reversa: README → «Captcha de Auth (Turnstile)».

/** Tope defensivo: los tokens reales rondan 1 KB; nada legítimo pasa de 4 KB. */
const MAX_TOKEN_LENGTH = 4096;

/**
 * Lee `captchaToken` del body de start-otp. Devuelve null si falta o no parece
 * un token (vacío, demasiado largo, con espacios o caracteres de control). No
 * valida el token: eso lo hace Supabase Auth contra Cloudflare.
 */
export function parseCaptchaToken(body: unknown): string | null {
  const raw = (body as { captchaToken?: unknown } | null)?.captchaToken;
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  // ASCII visible sin espacios: el formato de Turnstile es base64url con puntos.
  if (!/^[\x21-\x7e]+$/.test(token)) return null;
  return token;
}

/**
 * ¿Supabase Auth rechazó la petición por la captcha? GoTrue responde 400 con
 * `code: "captcha_failed"` y el mensaje «captcha protection: request
 * disallowed (...)».
 */
export function isCaptchaRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "captcha_failed") return true;
  return typeof message === "string" && /captcha/i.test(message);
}
