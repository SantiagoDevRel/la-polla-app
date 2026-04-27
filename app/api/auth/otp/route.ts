// app/api/auth/otp/route.ts — OTP send + verify via Supabase native phone
// auth (Twilio Verify under the hood). Replaces the WhatsApp-bot OTP flow.
//
// POST { phone, turnstileToken } → Supabase asks Twilio Verify to SMS a
//   6-digit code to the phone. Returns 200 on dispatch.
// PUT  { phone, code } → Supabase asks Twilio Verify to validate the code.
//   On success, Supabase issues session cookies (set on the response by
//   the SSR cookie adapter). Returns { newUser } so the frontend can route
//   to /onboarding for first-time users.
//
// Server-side defense layers:
//   1) Cloudflare Turnstile validation (POST only — verify is gated by code)
//   2) Rate limit per phone (existing infra in lib/auth/rate-limit)
//   3) Supabase + Twilio Verify Fraud Guard (geo restricted to +57)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone } from "@/lib/auth/phone";
import { verifyTurnstile } from "@/lib/auth/turnstile";

const sendSchema = z.object({
  phone: z.string().min(8, "Número de teléfono inválido"),
  turnstileToken: z.string().min(1, "Verificación anti-bot requerida"),
});

const verifySchema = z.object({
  phone: z.string().min(8, "Número de teléfono inválido"),
  code: z.string().length(6, "El código debe ser de 6 dígitos"),
});

// POST — Envía el OTP por SMS via Twilio Verify (orquestado por Supabase).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

    // Layer 1: Turnstile (anti-bot) — bypass-able only by humans, kills the
    // automated SMS pumping attack vector that Twilio Fraud Guard alone may
    // miss for sub-pumping rates.
    const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ip);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "Verificación anti-bot fallida. Recargá la página." },
        { status: 400 },
      );
    }

    const phone = normalizePhone(parsed.data.phone);

    // Reject anything that isn't Colombian. Defense-in-depth — Twilio Verify
    // is also geo-restricted to +57.
    if (!phone.startsWith("57") || phone.length < 11 || phone.length > 13) {
      return NextResponse.json(
        { error: "Solo se permiten números colombianos (+57)" },
        { status: 400 },
      );
    }

    // Layer 2: rate limit per phone. Reuses the `generate` bucket from the
    // old WhatsApp flow (5 sends per phone per hour).
    const limit = await checkAndRecordAttempt(phone, "generate", ip);
    if (limit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos. Esperá unos minutos antes de reintentar.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 },
      );
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: `+${phone}`,
      options: {
        // Auto-create the auth user on first OTP. The 003_auth_user_sync
        // trigger inserts the matching public.users row.
        shouldCreateUser: true,
      },
    });

    if (error) {
      console.error("[otp POST] signInWithOtp failed:", error);
      // Don't leak Twilio/Supabase internals to the user.
      return NextResponse.json(
        { error: "No pudimos enviar el código. Intentá en unos minutos." },
        { status: 500 },
      );
    }

    return NextResponse.json({ status: "sent", phone });
  } catch (err) {
    console.error("[otp POST] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// PUT — Valida el código y autentica. Supabase setea cookies en la response.
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const phone = normalizePhone(parsed.data.phone);
    const code = parsed.data.code;

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
    const limit = await checkAndRecordAttempt(phone, "verify", ip);
    if (limit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos fallidos. Esperá 15 minutos.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 },
      );
    }

    const supabase = createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: `+${phone}`,
      token: code,
      type: "sms",
    });

    if (error || !data.user) {
      console.error("[otp PUT] verifyOtp failed:", error);
      return NextResponse.json(
        { error: "Código inválido o expirado" },
        { status: 400 },
      );
    }

    // Detect new user: created within the last 30 seconds. If so, the
    // frontend routes to /onboarding for display name + first polla flow.
    const createdAt = new Date(data.user.created_at).getTime();
    const isNewUser = Date.now() - createdAt < 30_000;

    // The 003_auth_user_sync trigger writes whatsapp_number = NEW.phone
    // ("+57..."). Our internal lookups expect normalized form (no +). Fix
    // it once on first verify so the user is consistent across tables.
    const admin = createAdminClient();
    await admin
      .from("users")
      .update({ whatsapp_number: phone, whatsapp_verified: true })
      .eq("id", data.user.id);

    void recordLoginEvent({
      userId: data.user.id,
      method: "otp",
      request,
    });

    return NextResponse.json({
      status: "Verificado",
      phone,
      newUser: isNewUser,
    });
  } catch (err) {
    console.error("[otp PUT] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
