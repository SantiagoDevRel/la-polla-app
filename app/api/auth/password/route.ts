import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { phonePasswordEnabled } from "@/lib/auth/password-config";
import { hashPhonePassword, validPhonePassword, phonePasswordRequestSalt } from "@/lib/auth/phone-password";
import { z } from "zod";
import { toE164, normalizePhone } from "@/lib/auth/phone";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const writeSchema = z.object({ expected_user_id: z.string().uuid(), request_id: z.string().uuid(),
  expected_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });

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
    const protocol = writeSchema.safeParse(body);
    // Old open tabs cannot write without a version fence after deployment.
    if (!protocol.success) return reply({ code: "PASSWORD_REFRESH_REQUIRED", error: "Actualiza esta página para guardar tu contraseña con seguridad." }, 409);
    const { expected_user_id, request_id, expected_revision } = protocol.data;
    if (expected_user_id !== user.id) return reply({ code: "SESSION_CHANGED", error: "Cambiaste de cuenta. Ingresa con la cuenta original y vuelve a intentarlo." }, 412);
    const credential = await hashPhonePassword(body.password, phonePasswordRequestSalt(user.id, request_id));
    const { data: saved, error: savedError } = await createAdminClient().rpc("phone_password_save_v1", {
      p_user_id: user.id, p_phone_number: normalizePhone(phone), p_request_id: request_id,
      p_expected_revision: expected_revision, p_salt: credential.salt, p_password_hash: credential.password_hash,
    });
    if (savedError) {
      if (savedError.message?.includes("PASSWORD_OWNER_CHANGED")) return reply({ code: "SESSION_CHANGED", error: "Tu celular cambió. Ingresa de nuevo antes de guardar tu contraseña." }, 412);
      if (savedError.message?.includes("PASSWORD_REQUEST_REUSED")) return reply({ code: "PASSWORD_REQUEST_REUSED", error: "Este intento corresponde a otra contraseña. Actualiza la página y vuelve a intentarlo." }, 400);
      return reply({ error: "No pudimos confirmar el guardado de tu contraseña. Conserva tus dígitos y reintenta." }, 503);
    }
    if (saved?.conflict === true) return reply({ code: "PASSWORD_CHANGED", error: "Tu contraseña cambió en otro intento. Revisa el estado antes de volver a guardar." }, 409);
    if (saved?.ok !== true || saved.user_id !== user.id || saved.request_id !== request_id || saved.revision !== expected_revision + 1) {
      return reply({ error: "No pudimos confirmar el guardado de tu contraseña. Conserva tus dígitos y reintenta." }, 503);
    }
    return reply({ ok: true, userId: user.id, requestId: request_id, revision: saved.revision });
  } catch { return reply({ error: "No pudimos guardar tu contraseña. Intenta de nuevo." }, 503); }
}
