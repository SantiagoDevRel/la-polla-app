// app/api/auth/login-poll/route.ts — Frontend polls this while the user
// messages the bot. Returns "waiting" until the webhook fires the OTP, then
// "code_sent" so the UI advances to the code-entry step. Returns "expired"
// when the 15-minute TTL passes.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()+]/g, "");
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("phone") ?? "";
  const phone = normalizePhone(raw);
  if (!phone) {
    return NextResponse.json({ error: "Número requerido" }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("login_pending_sessions")
      .select("code_sent, expires_at")
      .eq("phone", phone)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ status: "expired" });
    }
    if (new Date(data.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ status: "expired" });
    }
    return NextResponse.json({
      status: data.code_sent ? "code_sent" : "waiting",
    });
  } catch (err) {
    console.error("[login-poll] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
