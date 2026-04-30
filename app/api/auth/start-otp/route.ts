// app/api/auth/start-otp/route.ts — Origen único para iniciar el OTP.
//
// Llama a Supabase signInWithOtp que dispara el SMS via Twilio.
// Aplica rate-limit por phone para no abrir la puerta a fuerza bruta
// del verify-otp.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { normalizePhone } from "@/lib/auth/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Rate limit por phone (5 generate-attempts / hora). El verify-otp
  // tiene su propio limit de 5/15min, pero limitar generates evita
  // que un atacante use signInWithOtp como un canal para inundar
  // Twilio costos.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
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
