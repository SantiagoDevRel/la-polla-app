// app/api/auth/start-otp/route.ts — Origen único para iniciar el OTP.
//
// Por qué existe: para los phones admin (lib/auth/admin-phones.ts) NO
// queremos disparar Twilio ni Supabase signInWithOtp — el admin va a
// usar el código bypass server-side. Para todos los demás, sí
// disparamos Supabase normal y se manda SMS.
//
// El cliente llama a este endpoint con {phone} y nunca le interesa
// saber si fue bypass o no — la UX (pantalla de OTP) es idéntica.
// Eso evita filtrar el listado de phones admin al bundle del cliente.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { isAdminBypassPhone } from "@/lib/auth/admin-phones";
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

  // Rate limit por phone (5 generate-attempts / hora). Aplica también
  // para admins — no queremos que un script de fuerza bruta pueda
  // probar bypass codes ilimitadamente. La limitación está en el
  // verify-otp también (5 verifies / 15 min), pero esta capa de
  // generate-rate evita inundar el endpoint.
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

  // Admin bypass: NO llamamos a Twilio. El admin ya conoce el código
  // bypass (server-only env var ADMIN_BYPASS_OTP). Devolvemos ok
  // genérico — el cliente no se entera de la diferencia.
  if (isAdminBypassPhone(phoneE164)) {
    return NextResponse.json({ ok: true });
  }

  // Path normal: Supabase signInWithOtp dispara el SMS via Twilio.
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
