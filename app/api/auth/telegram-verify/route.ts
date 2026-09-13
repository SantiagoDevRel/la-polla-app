// app/api/auth/telegram-verify/route.ts — Canjea el código de 6 dígitos que
// entregó el bot de login de Telegram y deja la sesión en cookies HttpOnly.
//
// POST JSON same-origin { phone: "+57...", code: "123456" }.
//   - Canal apagado (faltan variables) → 404 sin tocar la base.
//   - Solo JSON y solo desde el mismo origen (CSRF: un formulario de otro sitio
//     no puede mandar application/json sin preflight, y además se revisan
//     Sec-Fetch-Site y Origin).
//   - 5 intentos / 15 min por teléfono (otp_rate_limits, 'telegram_verify') y
//     5 intentos por token en la base.
//   - Error genérico: nunca dice si el número tiene cuenta o token.
//   - Código correcto de una cuenta de Telegram no autorizada para la cuenta
//     existente → 409 sms_only, sin sesión (lib/auth/telegram-login/identity.ts).
// La sesión se crea con el mismo mecanismo que el magic-link
// (lib/auth/phone-session.ts).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone, toE164 } from "@/lib/auth/phone";
import {
  applyOnboardingCookie,
  startSessionForVerifiedPhone,
} from "@/lib/auth/phone-session";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { consumeLoginCode } from "@/lib/auth/telegram-login/consume";
import { telegramSessionAuthorizer } from "@/lib/auth/telegram-login/identity";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import { redactPhone } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  phone: z.string().max(32),
  code: z.string().regex(/^\d{6}$/),
});

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const config = getTelegramLoginConfig();
  if (!config) return json({ error: "not_available" }, 404);

  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const parsed = bodySchema.safeParse(raw);
  const phoneE164 = parsed.success ? toE164(parsed.data.phone) : null;
  if (!parsed.success || !phoneE164) {
    return json({ error: "invalid_input" }, 400);
  }
  const phoneNormalized = normalizePhone(phoneE164);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const limit = await checkAndRecordAttempt(phoneNormalized, "telegram_verify", ip);
  if (limit.blocked) {
    return json(
      { error: "rate_limited", retryAfter: limit.retryAfter?.toISOString() },
      429,
    );
  }

  const admin = createAdminClient();
  const consumed = await consumeLoginCode(admin, config, phoneE164, parsed.data.code);
  if (consumed.status === "error") {
    console.error("[telegram-verify] canje falló:", redactPhone(phoneNormalized));
    return json({ error: "server_error" }, 500);
  }
  if (consumed.status !== "ok") return json({ error: "invalid_code" }, 401);

  const session = await startSessionForVerifiedPhone(phoneNormalized, "telegram-verify", {
    authorize: telegramSessionAuthorizer(admin, config, consumed.telegramUserId),
  });
  if (!session.ok) {
    // Cuenta existente que no acepta esta cuenta de Telegram: solo SMS.
    if (session.stage === "denied") return json({ error: "sms_only" }, 409);
    return json({ error: "session_failed" }, 500);
  }

  void recordLoginEvent({ userId: session.userId, method: "telegram", request });

  const response = json({ ok: true, newUser: session.needsOnboarding });
  applyOnboardingCookie(response, session.needsOnboarding);
  return response;
}
