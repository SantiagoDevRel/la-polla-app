import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { phonePasswordEnabled } from "@/lib/auth/password-config";
import { validPhonePassword, verifyPhonePassword, passwordIpKey } from "@/lib/auth/phone-password";
import { toE164, normalizePhone } from "@/lib/auth/phone";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { startSessionForVerifiedPhone, applyOnboardingCookie } from "@/lib/auth/phone-session";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { safeReturnTo } from "@/lib/auth/safe-return-to";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request, { requireProof: true })) return reply({ error: "Solicitud inválida." }, 403);
  if (!phonePasswordEnabled()) return reply({ error: "La contraseña no está disponible. Puedes entrar por SMS." }, 503);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Solicitud inválida." }, 415);
  try {
    const raw = await request.text();
    if (raw.length > 1024) return reply({ error: "Solicitud inválida." }, 413);
    const body = JSON.parse(raw) as { phone?: unknown; password?: unknown; returnTo?: unknown };
    const phone = typeof body.phone === "string" ? toE164(body.phone) : null;
    if (!phone || !validPhonePassword(body.password)) return reply({ error: "Escribe tu celular y contraseña de 6 dígitos." }, 400);
    const ip = getClientIp(request.headers);
    if (!ip) return reply({ error: "No pudimos verificar la solicitud. Puedes entrar por SMS." }, 503);
    const admin = createAdminClient();
    const { data: allowed, error: limitError } = await admin.rpc("phone_password_reserve_attempt", { p_phone: normalizePhone(phone), p_ip_key: passwordIpKey(ip) });
    if (limitError) return reply({ error: "No pudimos verificar la solicitud. Puedes entrar por SMS." }, 503);
    if (allowed !== true) return reply({ error: "Demasiados intentos. Puedes entrar por SMS o intentar más tarde." }, 429);
    const { data: credential, error: lookupError } = await admin.from("phone_password_credentials")
      .select("user_id, salt, password_hash").eq("phone_number", normalizePhone(phone)).maybeSingle();
    if (lookupError) return reply({ error: "No pudimos verificar la solicitud. Puedes entrar por SMS." }, 503);
    const matches = await verifyPhonePassword(body.password, credential);
    if (!matches || !credential) return reply({ error: "Celular o contraseña incorrectos. Puedes entrar por SMS." }, 401);
    const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(credential.user_id);
    if (ownerError || !owner.user?.phone_confirmed_at || toE164(owner.user.phone) !== phone) {
      return reply({ error: "Celular o contraseña incorrectos. Puedes entrar por SMS." }, 401);
    }
    const result = await startSessionForVerifiedPhone(phone, "password", { clientIp: ip,
      authorize: async account => {
        if (account.created || account.authUserId !== credential.user_id) return false;
        // A password reset while the hash was being checked invalidates that
        // in-flight check. The verified hash must still belong to this phone.
        const { data: current, error: currentError } = await admin.from("phone_password_credentials")
          .select("password_hash").eq("user_id", credential.user_id).eq("phone_number", normalizePhone(phone)).maybeSingle();
        return !currentError && current?.password_hash === credential.password_hash;
      } });
    if (!result.ok) return reply({ error: "No pudimos iniciar sesión. Puedes entrar por SMS." }, 503);
    await recordLoginEvent({ userId: result.userId, method: "password", request });
    const returnTo = typeof body.returnTo === "string" ? safeReturnTo(body.returnTo) : null;
    const response = reply({ ok: true, redirectTo: result.needsOnboarding ? "/onboarding" : returnTo || "/inicio" });
    applyOnboardingCookie(response, result.needsOnboarding);
    return response;
  } catch { return reply({ error: "No pudimos iniciar sesión. Puedes entrar por SMS." }, 503); }
}
