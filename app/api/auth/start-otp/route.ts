// app/api/auth/start-otp/route.ts — Origen único para iniciar el OTP.
//
// Llama a Supabase signInWithOtp. Hoy el SMS sale por Twilio Verify
// (proveedor nativo de Phone Auth). El cutover a LabsMobile es el
// "Send SMS Hook" (`/api/auth/sms-hook`) — este archivo no cambia:
// Supabase genera el OTP y el hook solo lo entrega.
// Aplica rate-limit por phone para no abrir la puerta a fuerza bruta
// del verify-otp.
//
// La llamada a Supabase Auth sale con la IP real de la persona
// (`Sb-Forwarded-For`, lib/supabase/auth-ip.ts). Sin eso, el límite por IP de
// Supabase se repartía entre todos los usuarios detrás de las IPs de Vercel.
//
// Captcha (Cloudflare Turnstile, 2026-09-14): /login manda `captchaToken`.
// OJO: con la secret key GoTrue se salta la captcha (credenciales de admin),
// así que Supabase NO la verifica aquí. Con SMS_CAPTCHA_ENFORCED=true este
// archivo la verifica contra Cloudflare ANTES del cupo y de Supabase, y
// responde 403 CAPTCHA_FAILED_CODE sin enviar (lib/auth/captcha.ts). Apagado,
// el token solo se reenvía a Supabase como antes.

import { NextRequest, NextResponse } from "next/server";
import {
  checkAndRecordAttempt,
  checkIpRateLimit,
  checkDailySmsCap,
  otpRejectedBeforeSending,
  releaseGenerateAttempt,
  GENERATE_MAX_POR_HORA,
} from "@/lib/auth/rate-limit";
import { normalizePhone } from "@/lib/auth/phone";
import {
  CAPTCHA_FAILED_CODE,
  COUNTRY_NOT_ALLOWED_CODE,
  DAILY_SMS_CAP_CODE,
  SUPPORT_PATH,
} from "@/lib/auth/otp-codes";
import { paisSmsPermitido } from "@/lib/sms/paises";
import { avisarTopeSmsPorHora } from "@/lib/auth/sms-tope-alerta";
import {
  isCaptchaRejection,
  isSmsCaptchaEnforced,
  parseCaptchaToken,
  verifySmsCaptcha,
} from "@/lib/auth/captcha";
import { authRequestConfig, createAuthClient, getClientIp } from "@/lib/supabase/auth-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Respuesta del tope diario. `code` lo usa /login para mostrar el texto
// traducido (Login.errDailySmsCap) con el enlace a /soporte; `error` queda
// para clientes viejos que solo pintan el texto.
const CAPTCHA_FAILED_MESSAGE = "No pudimos verificar que eres una persona. Vuelve a intentarlo.";

const DAILY_SMS_CAP_MESSAGE =
  "Ya enviamos los códigos por SMS permitidos hoy para este número. Inténtalo de nuevo mañana o escríbenos a soporte.";

// Admins — exentos del tope diario de SMS para que las pruebas de login
// del equipo no se choquen con el cap. Se leen de env (ADMIN_PHONES_E164,
// E.164 sin "+", separados por coma) para no hardcodear números personales
// en el repo público. Si la var no está seteada, el set queda vacío y los
// admins caen al cap normal — no rompe nada, solo se pierde la exención.
const ADMIN_PHONES = new Set(
  (process.env.ADMIN_PHONES_E164 ?? "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean),
);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const phoneRaw =
    typeof (body as { phone?: unknown })?.phone === "string"
      ? ((body as { phone: string }).phone as string).trim()
      : "";
  if (!phoneRaw) {
    return NextResponse.json({ error: "Falta phone" }, { status: 400 });
  }

  const phoneE164 = normalizePhone(phoneRaw);
  if (!phoneE164) {
    return NextResponse.json({ error: "Phone inválido" }, { status: 400 });
  }
  const phoneNormalized = phoneE164.replace(/\D/g, "");
  // Antes de rate limits y de Supabase: un país fuera de la lista no genera
  // código ni gasta un intento.
  if (!paisSmsPermitido(phoneNormalized)) {
    return NextResponse.json(
      { error: "País no disponible", code: COUNTRY_NOT_ALLOWED_CODE },
      { status: 400 },
    );
  }
  const captchaToken = parseCaptchaToken(body);

  const ip = getClientIp(request.headers) ?? undefined;

  // Rate limit por IP (defensa anti bill-bombing de SMS). El límite por
  // phone de abajo NO frena al bot que rota números; este sí, porque el
  // atacante scriptea desde un set acotado de IPs. Si no hay IP, se
  // saltea y el límite por phone queda como único gate.
  if (ip) {
    const ipLimit = await checkIpRateLimit(ip);
    if (ipLimit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos desde tu red. Espera un rato.",
          retryAfter: ipLimit.retryAfter,
        },
        { status: 429 },
      );
    }
  }

  // Captcha exigida (SMS_CAPTCHA_ENFORCED). Va ANTES del cupo diario y del
  // intento por teléfono: un token malo no gasta cupo ni llega a Supabase.
  // Con la secret key GoTrue no verifica la captcha, así que la verifica esta
  // ruta y el token (ya usado) no se reenvía. Con la anon key la verifica
  // GoTrue: aquí solo se exige que venga.
  let forwardCaptchaToken = captchaToken;
  if (isSmsCaptchaEnforced()) {
    const supabaseSkipsCaptcha = authRequestConfig(ip).key.startsWith("sb_secret_");
    if (supabaseSkipsCaptcha) {
      const verdict = await verifySmsCaptcha(captchaToken, ip);
      if (!verdict.ok && verdict.reason === "misconfigured") {
        console.error("[start-otp] SMS_CAPTCHA_ENFORCED sin CLOUDFLARE_TURNSTILE_SECRET_KEY: envío bloqueado");
        return NextResponse.json(
          { error: "No pudimos enviar el código. Inténtalo más tarde o escríbenos a soporte." },
          { status: 503 },
        );
      }
      if (!verdict.ok) {
        console.warn(`[start-otp] captcha rechazada: ${verdict.detail}`);
        return NextResponse.json(
          { error: CAPTCHA_FAILED_MESSAGE, code: CAPTCHA_FAILED_CODE },
          { status: 403 },
        );
      }
      forwardCaptchaToken = null;
    } else if (!captchaToken) {
      return NextResponse.json(
        { error: CAPTCHA_FAILED_MESSAGE, code: CAPTCHA_FAILED_CODE },
        { status: 403 },
      );
    }
  }

  // Tope DIARIO de SMS por teléfono (2/día). Acota el costo del re-login
  // crónico. Admins exentos. Va ANTES del envío. WhatsApp está apagado, así
  // que el mensaje remite a soporte, no a otro canal.
  if (!ADMIN_PHONES.has(phoneNormalized)) {
    const daily = await checkDailySmsCap(phoneNormalized);
    if (daily.blocked) {
      return NextResponse.json(
        {
          error: DAILY_SMS_CAP_MESSAGE,
          code: DAILY_SMS_CAP_CODE,
          supportPath: SUPPORT_PATH,
        },
        { status: 429 },
      );
    }
  }

  // Rate limit por phone (10 generate-attempts / hora). El verify-otp
  // tiene su propio limit de 5/15min, pero limitar generates evita
  // que un atacante use signInWithOtp como un canal para inundar
  // costos de SMS.
  const limit = await checkAndRecordAttempt(phoneNormalized, "generate", ip);
  if (limit.blocked) {
    // El bloqueo deja de ser silencioso: avisa al administrador (una vez por
    // número y por hora). Es fail-soft y se espera a propósito — en serverless
    // una promesa suelta se corta cuando la respuesta se va.
    await avisarTopeSmsPorHora({
      phone: phoneNormalized,
      maxPorHora: GENERATE_MAX_POR_HORA,
      ip,
      retryAfter: limit.retryAfter,
    });
    return NextResponse.json(
      {
        error: "Pediste muchos códigos seguidos. Espera unos minutos.",
        retryAfter: limit.retryAfter,
      },
      { status: 429 },
    );
  }

  // Supabase signInWithOtp dispara el SMS (Twilio hoy; LabsMobile cuando
  // el Send SMS Hook esté cableado en el dashboard de Auth). Sin cookies:
  // todavía no hay sesión.
  const auth = createAuthClient(ip);
  const { error } = await auth.signInWithOtp({
    phone: phoneE164,
    options: forwardCaptchaToken
      ? { channel: "sms", captchaToken: forwardCaptchaToken }
      : { channel: "sms" },
  });
  if (error) {
    // Supabase lo rechazó sin mandar SMS → ese intento no gasta el cupo.
    if (limit.attemptId && otpRejectedBeforeSending(error)) {
      await releaseGenerateAttempt(limit.attemptId);
    }
    if (isCaptchaRejection(error)) {
      return NextResponse.json(
        { error: CAPTCHA_FAILED_MESSAGE, code: CAPTCHA_FAILED_CODE },
        { status: 403 },
      );
    }
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("phone signups") || msg.includes("provider")) {
      return NextResponse.json(
        { error: "Login por celular no está activado. Contacta a soporte." },
        { status: 503 },
      );
    }
    if (error.status === 429 || msg.includes("rate") || msg.includes("limit")) {
      return NextResponse.json(
        { error: "Muchos intentos. Espera un minuto." },
        { status: 429 },
      );
    }
    console.error("[start-otp] signInWithOtp failed:", error);
    return NextResponse.json(
      { error: error.message || "No pudimos enviar el código" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
