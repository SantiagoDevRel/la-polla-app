// app/api/auth/set-password/route.ts — Authenticated user sets or changes
// their password. Called from:
//   1) /set-password page after registration (mandatory) — currentPassword optional
//   2) /perfil/cambiar-clave page when user wants to rotate — currentPassword required
//
// Min 4 characters, any type. After success, sets users.has_custom_password=true
// so the middleware lets the user navigate freely.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailForPhone, normalizePhone } from "@/lib/auth/phone";

const schema = z.object({
  password: z
    .string()
    .min(4, "La contraseña debe tener al menos 4 caracteres")
    .max(128),
  // currentPassword is required only when has_custom_password is already
  // true (rotation flow). On first-time set, the OTP flow already proved
  // ownership of the phone, so no current password to verify.
  currentPassword: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("has_custom_password, whatsapp_number")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    }

    // Rotation flow requires the current password to prevent session
    // hijacking from changing the password silently.
    if (profile.has_custom_password) {
      if (!parsed.data.currentPassword) {
        return NextResponse.json(
          { error: "Necesitamos tu contraseña actual" },
          { status: 400 },
        );
      }
      const email = emailForPhone(normalizePhone(profile.whatsapp_number));
      const verifyClient = createClient();
      const { error: verifyErr } = await verifyClient.auth.signInWithPassword({
        email,
        password: parsed.data.currentPassword,
      });
      if (verifyErr) {
        return NextResponse.json(
          { error: "Contraseña actual incorrecta" },
          { status: 401 },
        );
      }
    }

    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      password: parsed.data.password,
    });
    if (authErr) {
      console.error("[set-password] auth update failed:", authErr);
      return NextResponse.json(
        { error: "Error guardando la contraseña" },
        { status: 500 },
      );
    }

    const { error: profileErr } = await admin
      .from("users")
      .update({ has_custom_password: true })
      .eq("id", user.id);
    if (profileErr) {
      console.error("[set-password] flag update failed:", profileErr);
      // Auth password is already changed; the flag mismatch will resolve
      // next time the user logs in. Not fatal, but log it.
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[set-password] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
