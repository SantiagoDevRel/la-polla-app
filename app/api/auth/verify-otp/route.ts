// app/api/auth/verify-otp/route.ts — Server-side OTP verify.
// CRÍTICO: corre server-side para persistir cookies via Set-Cookie HttpOnly,
// que iOS Safari respeta sí o sí. verifyOtp en el browser dejaba al user
// "medio logueado" (sesión válida en memory pero cookies perdidas, y al
// navegar a /inicio parecía no logueado).
//
// Mismo patrón que los-del-sur-app.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone, toE164 } from "@/lib/auth/phone";
import { needsName } from "@/lib/users/needs-name";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import { createAuthRouteClient, getClientIp } from "@/lib/supabase/auth-ip";

export const runtime = "nodejs";

const verifySchema = z.object({
  phone: z.string().min(8, "Número inválido"),
  token: z.string().regex(/^\d{6}$/, "El código debe ser de 6 dígitos"),
});

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Solicitud no permitida" }, { status: 403 });
  try {
    const body = await request.json().catch(() => null);
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const phoneE164 = toE164(parsed.data.phone);
    if (!phoneE164) return NextResponse.json({ error: "Número inválido" }, { status: 400 });
    const phoneNormalized = normalizePhone(phoneE164); // "57..." sin +
    const code = parsed.data.token;

    // Defense in depth: rate limit por phone (5 intentos / 15 min).
    const ip = getClientIp(request.headers) ?? undefined;
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

    // Cliente SOLO de Auth, con las cookies del request y la IP real de la
    // persona (Sb-Forwarded-For): el límite de /verify de Supabase es por IP y
    // desde Vercel lo compartían todos los usuarios. lib/supabase/auth-ip.ts.
    const auth = await createAuthRouteClient(ip);
    // verifyOtp replaces the cookie session on success. A wrong or expired
    // code must not revoke the person's existing browser session.

    const { data, error } = await auth.verifyOtp({
      phone: phoneE164,
      token: code,
      type: "sms",
    });

    if (error || !data.user) {
      if (error && typeof error.status === "number" && (error.status === 0 || error.status >= 500)) {
        return NextResponse.json({ error: "No pudimos verificar el código. Conserva tus 6 dígitos y vuelve a intentarlo." }, { status: 503 });
      }
      return NextResponse.json(
        { error: "Código inválido o vencido. Revisa los 6 dígitos o pide uno nuevo." },
        { status: 401 },
      );
    }

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

    // A code can take over 30 seconds to arrive. The profile, not account
    // creation age, determines whether registration still needs onboarding.
    const { data: profile, error: profileError } = await admin.from("users")
      .select("display_name, avatar_url").eq("id", data.user.id).maybeSingle();
    const isNewUser = !!profileError || !profile || needsName(profile.display_name) || !profile.avatar_url;

    void recordLoginEvent({
      userId: data.user.id,
      method: "otp",
      request,
    });

    // Limpiar la cookie lp_onb de cualquier sesión previa. El user puede
    // estar logueando con OTRA cuenta (multi-cuenta es real — cada phone
    // = una cuenta) y la cookie del user anterior NO aplica al nuevo.
    // El middleware re-setea la cookie en el primer nav si el nuevo user
    // tiene onboarding completo.
    const response = NextResponse.json({
      ok: true,
      newUser: isNewUser,
      user: { id: data.user.id },
    });
    response.headers.set("Cache-Control", "private, no-store");
    response.cookies.delete("lp_onb");
    return response;
  } catch (err) {
    console.error("[verify-otp] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
