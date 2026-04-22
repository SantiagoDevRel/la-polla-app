// app/api/auth/login-wait/route.ts — Register a phone as waiting for a
// bot-triggered OTP. Called when the login page routes the user to the
// "Abrí el chat con el bot" step. The bot webhook watches this table and,
// on any inbound message from a listed phone, generates + sends the OTP.
// TTL 15 minutes, managed by the DB column defaults.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()+]/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw = typeof body?.phone === "string" ? body.phone : "";
    const phone = normalizePhone(raw);
    if (!phone || phone.length < 10) {
      return NextResponse.json({ error: "Número inválido" }, { status: 400 });
    }
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await admin
      .from("login_pending_sessions")
      .upsert(
        {
          phone,
          created_at: nowIso,
          expires_at: expiresIso,
          code_sent: false,
          code_sent_at: null,
        },
        { onConflict: "phone" }
      );
    if (error) {
      console.error("[login-wait] upsert failed:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[login-wait] unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
