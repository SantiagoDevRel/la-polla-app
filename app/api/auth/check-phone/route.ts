// app/api/auth/check-phone/route.ts — Pre-auth phone existence probe.
// Routes /login between the password input (existing user with custom
// password) and the OTP flow (new user OR existing user mid-registration).
//
// Body: { phone: string, turnstileToken: string }
// Returns: { exists: boolean, hasCustomPassword: boolean }
//
// Security:
//   - Requires a valid Turnstile token. This is the gate that stops bots
//     from enumerating registered phones in bulk.
//   - Phone normalized to digits-only so the lookup matches the format
//     stored in public.users.whatsapp_number on registration.
//   - Returns minimum info: exists + has_custom_password, no PII.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { normalizePhone } from "@/lib/auth/phone";

const schema = z.object({
  phone: z.string().min(8, "Número inválido"),
  turnstileToken: z.string().min(1, "Falta verificación anti-bot"),
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
    if (phone.length < 8) {
      return NextResponse.json({ error: "Número inválido" }, { status: 400 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
    const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ip);
    if (!turnstile.ok) {
      return NextResponse.json(
        {
          error:
            "La verificación anti-bot falló. Recargá la página e intentá de nuevo.",
        },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const { data: user, error } = await admin
      .from("users")
      .select("id, has_custom_password")
      .eq("whatsapp_number", phone)
      .maybeSingle();

    if (error) {
      console.error("[check-phone] lookup failed:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    return NextResponse.json({
      exists: !!user,
      hasCustomPassword: user?.has_custom_password ?? false,
    });
  } catch (err) {
    console.error("[check-phone] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
