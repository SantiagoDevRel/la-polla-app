import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { phonePasswordEnabled } from "@/lib/auth/password-config";
import { hashPhonePassword, validPhonePassword } from "@/lib/auth/phone-password";
import { toE164, normalizePhone } from "@/lib/auth/phone";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() { return reply({ enabled: phonePasswordEnabled() }); }

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request, { requireProof: true })) return reply({ error: "Solicitud inválida." }, 403);
  if (!phonePasswordEnabled()) return reply({ error: "La contraseña no está disponible. Puedes entrar por SMS." }, 503);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Solicitud inválida." }, 415);
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return reply({ error: "Ingresa antes de crear tu contraseña." }, 401);
    const phone = toE164(user.phone);
    if (!phone || !user.phone_confirmed_at) return reply({ error: "Primero verifica tu celular por SMS." }, 403);
    const raw = await request.text();
    if (raw.length > 1024) return reply({ error: "Solicitud inválida." }, 413);
    const body = JSON.parse(raw) as { password?: unknown; confirmation?: unknown };
    if (!validPhonePassword(body.password) || body.password !== body.confirmation) return reply({ error: "Escribe y confirma una contraseña de 6 dígitos." }, 400);
    const credential = await hashPhonePassword(body.password);
    const { error: savedError } = await createAdminClient().from("phone_password_credentials").upsert({
      user_id: user.id, phone_number: normalizePhone(phone), ...credential, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (savedError) return reply({ error: "No pudimos guardar tu contraseña. Intenta de nuevo." }, 503);
    return reply({ ok: true });
  } catch { return reply({ error: "No pudimos guardar tu contraseña. Intenta de nuevo." }, 503); }
}
