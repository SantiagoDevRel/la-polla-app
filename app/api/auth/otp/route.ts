// app/api/auth/otp/route.ts — Validates OTP delivered via the WhatsApp bot
// and either creates a new account (with a temp password the user will
// replace immediately on /set-password) or signs in an existing account.
//
// Replaces the old HMAC-derived-password trick. The temp password here is
// 32 cryptographically-random bytes; it never leaves the server. The user
// always lands on /set-password right after to choose their real password,
// which the middleware enforces by gating has_custom_password=false.
//
// Bot-first flow: the bot generates the OTP and delivers it through the
// 24h service window. POST is intentionally absent — generation is bot-
// triggered via login_pending_sessions.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { validateOTP } from "@/lib/utils/otp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone, emailForPhone } from "@/lib/auth/phone";

const verifySchema = z.object({
  phone: z.string().min(8, "Número de teléfono inválido"),
  code: z.string().length(6, "El código debe ser de 6 dígitos"),
});

function generateTempPassword(): string {
  // 32 bytes = 64 hex chars, ample entropy. The user never sees this; it
  // exists only between the OTP success and the /set-password submission.
  return randomBytes(32).toString("hex");
}

// PUT — Validates the OTP, creates or refreshes the account, and signs in.
// Always returns needsPassword=true; the frontend redirects to /set-password
// (existing users get their flag flipped to false here so middleware sends
// them through the same flow — that's the forgot-password reset path).
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
    const verifyLimit = await checkAndRecordAttempt(phone, "verify", ip);
    if (verifyLimit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos fallidos. Esperá 15 minutos.",
          retryAfter: verifyLimit.retryAfter,
        },
        { status: 429 },
      );
    }

    const isValid = await validateOTP(phone, code);
    if (!isValid) {
      return NextResponse.json(
        { error: "Código inválido o expirado" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const tempPassword = generateTempPassword();
    const email = emailForPhone(phone);

    // Look up existing public.users row by normalized phone. If found, we
    // either reset the temp password (mid-registration retry, or forgot-
    // password flow). If not found, create a fresh auth user.
    const { data: existingProfile } = await admin
      .from("users")
      .select("id, has_custom_password")
      .eq("whatsapp_number", phone)
      .maybeSingle();

    let userId: string;
    let isNewUser = false;

    if (existingProfile) {
      // Reset auth password to the new temp value so signInWithPassword
      // succeeds below. Flip has_custom_password=false so middleware sends
      // the user through /set-password again — this doubles as the forgot-
      // password reset (OTP proves phone ownership, then user picks a new
      // password).
      const { error: updateAuthErr } = await admin.auth.admin.updateUserById(
        existingProfile.id,
        { password: tempPassword },
      );
      if (updateAuthErr) {
        console.error("[otp PUT] auth update failed:", updateAuthErr);
        return NextResponse.json(
          { error: "Error al iniciar sesión" },
          { status: 500 },
        );
      }

      const { error: profileErr } = await admin
        .from("users")
        .update({ has_custom_password: false })
        .eq("id", existingProfile.id);
      if (profileErr) {
        console.error("[otp PUT] flag update failed:", profileErr);
        // Non-fatal: middleware still works off has_custom_password but
        // we'll leak the flag mismatch into /avisos. Log for follow-up.
      }
      userId = existingProfile.id;
    } else {
      const { data: newUser, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: tempPassword,
          // Supabase Auth wants E.164 with the leading +; we pass it back
          // here even though our internal lookups use the normalized form.
          phone: `+${phone}`,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { phone, auth_method: "whatsapp_otp" },
        });

      if (
        createErr &&
        !createErr.message.includes("already been registered")
      ) {
        console.error("[otp PUT] createUser failed:", createErr);
        return NextResponse.json(
          { error: "Error al crear cuenta" },
          { status: 500 },
        );
      }

      if (!newUser?.user) {
        // The "already registered" branch lands here when Supabase Auth
        // already has the email/phone but our public.users row is missing.
        // Pull the auth.users id by email so we can still sign them in.
        const { data: list } = await admin.auth.admin.listUsers();
        const found = list?.users.find((u) => u.email === email);
        if (!found) {
          return NextResponse.json(
            { error: "No pudimos completar el registro" },
            { status: 500 },
          );
        }
        await admin.auth.admin.updateUserById(found.id, {
          password: tempPassword,
        });
        userId = found.id;
      } else {
        userId = newUser.user.id;
        isNewUser = true;
      }

      // The 003_auth_user_sync trigger inserts public.users with whatsapp_
      // number = NEW.phone (which is "+57..."). Normalize so all our lookups
      // hit the same key shape.
      await admin
        .from("users")
        .update({ whatsapp_number: phone })
        .eq("id", userId);
    }

    // Sign in via the email/password client so cookies are set on the
    // response. signInWithPassword is the only way to get the SSR cookie
    // dance right.
    const supabase = createClient();
    const { data: session, error: signInErr } =
      await supabase.auth.signInWithPassword({ email, password: tempPassword });

    if (signInErr || !session.user) {
      console.error("[otp PUT] signIn failed:", signInErr);
      return NextResponse.json(
        { error: "Error al iniciar sesión" },
        { status: 500 },
      );
    }

    void recordLoginEvent({
      userId: session.user.id,
      method: "otp",
      request,
    });

    return NextResponse.json({
      status: "Verificado",
      phone,
      newUser: isNewUser,
      // Always true: every OTP-completed session lands at /set-password
      // because we just rotated the password to a temp value.
      needsPassword: true,
    });
  } catch (err) {
    console.error("[otp PUT] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
