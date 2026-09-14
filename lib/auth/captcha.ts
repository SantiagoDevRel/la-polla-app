// lib/auth/captcha.ts — Token de Cloudflare Turnstile en el envío del SMS.
//
// El navegador resuelve el widget de Turnstile en /login y manda el token a
// /api/auth/start-otp.
//
// ⚠️ Supabase NO verifica la captcha en esa llamada. start-otp usa la secret
// key (`sb_secret_`, necesaria para Sb-Forwarded-For); el gateway de Supabase
// la traduce a un JWT de service_role y GoTrue omite la captcha con
// credenciales de admin (`verifyCaptcha` en internal/api/middleware.go). Sin
// verificación propia, un script podría llamar a start-otp sin token.
//
// Por eso, con SMS_CAPTCHA_ENFORCED=true, start-otp verifica el token AQUÍ
// contra siteverify (secret CLOUDFLARE_TURNSTILE_SECRET_KEY, hostname
// permitido y acción `sms-otp`) antes de tocar el cupo o Supabase, y falla
// cerrado. El token queda usado, así que no se reenvía a Supabase. Si la
// llamada va con la anon key (sin SUPABASE_SECRET_KEY), GoTrue sí lo
// verifica: ahí se exige el token y se reenvía sin verificarlo antes.
//
// Con SMS_CAPTCHA_ENFORCED apagado se conserva el comportamiento anterior: el
// token se reenvía y lo decide Supabase (security_captcha_enabled). Esto NO
// protege start-otp; solo sirve para desplegar antes de activar.
// Activación y reversa: README → «Captcha de Auth (Turnstile)».

/** Tope defensivo: los tokens reales rondan 1 KB; nada legítimo pasa de 4 KB. */
const MAX_TOKEN_LENGTH = 4096;

/** Acción que declara el widget de /login (components/auth/SmsCaptcha.tsx). */
export const SMS_CAPTCHA_ACTION = "sms-otp";

/** Hostnames de producción donde vive /login. */
const DEFAULT_ALLOWED_HOSTNAMES = ["lapollacolombiana.com", "chickenpicks.app"];

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

/**
 * Lee `captchaToken` del body de start-otp. Devuelve null si falta o no parece
 * un token (vacío, demasiado largo, con espacios o caracteres de control). No
 * valida el token: eso lo hace verifySmsCaptcha o Supabase Auth.
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

/** ¿La app exige y verifica la captcha antes de enviar el SMS? */
export function isSmsCaptchaEnforced(): boolean {
  return (process.env.SMS_CAPTCHA_ENFORCED ?? "").trim().toLowerCase() === "true";
}

function allowedHostnames(): Set<string> {
  const extra = (process.env.SMS_CAPTCHA_EXTRA_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_HOSTNAMES, ...extra]);
}

export type SmsCaptchaVerdict =
  | { ok: true }
  /** Token ausente, inválido, vencido, usado, de otro dominio o Cloudflare no respondió. */
  | { ok: false; reason: "rejected"; detail: string }
  /** Falta CLOUDFLARE_TURNSTILE_SECRET_KEY: error de configuración. */
  | { ok: false; reason: "misconfigured"; detail: string };

interface SiteverifyResponse {
  success?: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
}

async function callSiteverify(form: URLSearchParams): Promise<SiteverifyResponse | null> {
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as SiteverifyResponse;
  } catch {
    return null;
  }
}

/**
 * Verifica el token de Turnstile contra Cloudflare. Falla cerrado: sin token,
 * sin respuesta de Cloudflare (tras un reintento con la misma
 * idempotency_key) o con hostname/acción inesperados, devuelve ok=false.
 */
export async function verifySmsCaptcha(
  token: string | null,
  ip: string | null | undefined,
): Promise<SmsCaptchaVerdict> {
  const secret = (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ?? "").trim();
  if (!secret) return { ok: false, reason: "misconfigured", detail: "missing_secret" };
  if (!token) return { ok: false, reason: "rejected", detail: "missing_token" };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  // Permite repetir la verificación del MISMO token si la primera no respondió.
  form.set("idempotency_key", crypto.randomUUID());

  const data = (await callSiteverify(form)) ?? (await callSiteverify(form));
  if (!data) return { ok: false, reason: "rejected", detail: "siteverify_unavailable" };
  if (data.success !== true) {
    return { ok: false, reason: "rejected", detail: data["error-codes"]?.join(",") || "not_success" };
  }
  if (!data.hostname || !allowedHostnames().has(data.hostname.toLowerCase())) {
    return { ok: false, reason: "rejected", detail: "hostname" };
  }
  if (data.action !== SMS_CAPTCHA_ACTION) {
    return { ok: false, reason: "rejected", detail: "action" };
  }
  return { ok: true };
}
