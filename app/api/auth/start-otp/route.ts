// app/api/auth/start-otp/route.ts — Origen único para iniciar el OTP.
//
// Llama a Supabase signInWithOtp que dispara el SMS via Twilio.
// Aplica rate-limit por phone para no abrir la puerta a fuerza bruta
// del verify-otp.
//
// NOTA: el gate Turnstile fue rolleado back temporalmente porque el
// widget interaction-only no rendereaba en algunos browsers y bloqueaba
// login. El vector Twilio bill-bombing por phones rotados queda abierto
// hasta que cablemos un widget visible probado (TaskList #8).

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  checkAndRecordAttempt,
  checkIpRateLimit,
  checkDailySmsCap,
} from "@/lib/auth/rate-limit";
import { normalizePhone } from "@/lib/auth/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admins (migración 024) — exentos del tope diario de SMS para que las
// pruebas de login del equipo no se choquen con el cap. E.164 sin "+".
const ADMIN_PHONES = new Set(["573117312391", "REDACTED-PHONE"]);

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

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

  // Rate limit por IP (defensa anti Twilio bill-bombing). El límite por
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

  // Tope DIARIO de SMS por teléfono (2/día). Más allá, empujamos al
  // usuario a WhatsApp (gratis e instantáneo) — el botón de WhatsApp del
  // /login ya da el camino, así que NO lo dejamos afuera, solo movemos el
  // costo del canal pago al gratis. Admins exentos. Va ANTES del envío.
  if (!ADMIN_PHONES.has(phoneNormalized)) {
    const daily = await checkDailySmsCap(phoneNormalized);
    if (daily.blocked) {
      return NextResponse.json(
        {
          error:
            "Ya usaste tus 2 ingresos por SMS de hoy. Entra gratis y al instante por WhatsApp 👇",
          useWhatsapp: true,
        },
        { status: 429 },
      );
    }
  }

  // Rate limit por phone (5 generate-attempts / hora). El verify-otp
  // tiene su propio limit de 5/15min, pero limitar generates evita
  // que un atacante use signInWithOtp como un canal para inundar
  // Twilio costos.
  const limit = await checkAndRecordAttempt(phoneNormalized, "generate", ip);
  if (limit.blocked) {
    return NextResponse.json(
      {
        error: "Demasiados intentos. Espera un rato.",
        retryAfter: limit.retryAfter,
      },
      { status: 429 },
    );
  }

  // Supabase signInWithOtp dispara el SMS via Twilio.
  // Anon client (no cookies — no hay sesión todavía).
  const supabase = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await supabase.auth.signInWithOtp({
    phone: phoneE164,
    options: { channel: "sms" },
  });
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("phone signups") || msg.includes("provider")) {
      return NextResponse.json(
        { error: "Login por celular no está activado. Contacta a soporte." },
        { status: 503 },
      );
    }
    if (msg.includes("rate") || msg.includes("limit")) {
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
