// app/api/auth/login-password/route.ts — Phone + password login.
// Used by /login/password page after check-phone confirmed the user has
// a custom password. On success, creates a Supabase session and records
// a login event in /avisos.
//
// Body: { phone: string, password: string }
// Returns: { ok: true } on success, error + 401/429 on failure.
//
// Rate limit: 5 attempts per phone per 15 min via otp_rate_limits with
// attempt_type='password'. Same table the OTP and join-code flows use.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone, emailForPhone } from "@/lib/auth/phone";

const schema = z.object({
  phone: z.string().min(8, "Número inválido"),
  password: z
    .string()
    .min(4, "La contraseña debe tener al menos 4 caracteres")
    .max(128),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const phone = normalizePhone(parsed.data.phone);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

    const limit = await checkAndRecordAttempt(phone, "password", ip);
    if (limit.blocked) {
      return NextResponse.json(
        {
          error:
            "Demasiados intentos. Esperá 15 minutos o usá 'olvidé mi contraseña'.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 },
      );
    }

    const admin = createAdminClient();
    const { data: userRow } = await admin
      .from("users")
      .select("id, has_custom_password")
      .eq("whatsapp_number", phone)
      .maybeSingle();

    // Don't differentiate "no such phone" from "wrong password" in the
    // error message — that would let attackers enumerate registered numbers.
    if (!userRow || !userRow.has_custom_password) {
      return NextResponse.json(
        { error: "Teléfono o contraseña incorrectos" },
        { status: 401 },
      );
    }

    const supabase = createClient();
    const email = emailForPhone(phone);
    const { data: session, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password: parsed.data.password,
      });

    if (signInError || !session.user) {
      return NextResponse.json(
        { error: "Teléfono o contraseña incorrectos" },
        { status: 401 },
      );
    }

    void recordLoginEvent({
      userId: session.user.id,
      method: "password",
      request,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[login-password] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
