// app/api/auth/verify-otp/route.ts — Server-side OTP verify.
// CRÍTICO: corre server-side para persistir cookies via Set-Cookie HttpOnly,
// que iOS Safari respeta sí o sí. verifyOtp en el browser dejaba al user
// "medio logueado" (sesión válida en memory pero cookies perdidas, y al
// navegar a /inicio parecía no logueado).
//
// Mismo patrón que los-del-sur-app.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone } from "@/lib/auth/phone";

export const runtime = "nodejs";

const verifySchema = z.object({
  phone: z.string().min(8, "Número inválido"),
  token: z.string().regex(/^\d{6}$/, "El código debe ser de 6 dígitos"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const phoneE164 = parsed.data.phone; // viene como "+57..."
    const phoneNormalized = normalizePhone(phoneE164); // "57..." sin +
    const code = parsed.data.token;

    // Defense in depth: rate limit por phone (5 intentos / 15 min).
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
    const limit = await checkAndRecordAttempt(phoneNormalized, "verify", ip);
    if (limit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos fallidos. Espera 15 minutos.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 },
      );
    }

    const supabase = createClient();
    // Defensive: clear any existing session BEFORE verifying. Users
    // legitimately have multiple accounts (one per phone), and if they
    // come into /login already logged into account A and then submit
    // an OTP for account B, the cookie swap doesn't always happen
    // cleanly when there's a live session on the request. Signing
    // out first guarantees verifyOtp writes a fresh session and B
    // takes over.
    await supabase.auth.signOut().catch(() => {});

    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token: code,
      type: "sms",
    });

    if (error || !data.user) {
      console.error("[verify-otp] verifyOtp failed:", error);
      return NextResponse.json(
        { error: error?.message || "Código inválido o vencido" },
        { status: 401 },
      );
    }

    // Detect new user (created within the last 30 seconds) → frontend
    // routes a /onboarding para nombre + pollito.
    const createdAt = new Date(data.user.created_at).getTime();
    const isNewUser = Date.now() - createdAt < 30_000;

    // El trigger 003_auth_user_sync ya creó el row de public.users.
    // Normalizamos whatsapp_number (sin +) para que los lookups
    // internos por phone hagan match.
    const admin = createAdminClient();
    await admin
      .from("users")
      .update({
        whatsapp_number: phoneNormalized,
        whatsapp_verified: true,
      })
      .eq("id", data.user.id);

    void recordLoginEvent({
      userId: data.user.id,
      method: "otp",
      request,
    });

    return NextResponse.json({
      ok: true,
      newUser: isNewUser,
      user: { id: data.user.id },
    });
  } catch (err) {
    console.error("[verify-otp] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
