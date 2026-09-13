// lib/auth/telegram-login/session.ts — Abre la sesión de una solicitud o un
// enlace ya consumidos. Usa el ÚNICO mecanismo de sesión para teléfonos
// probados (lib/auth/phone-session.ts) con la IP real, y exige otra vez el
// vínculo con la cuenta de Telegram que aprobó (identity.ts).

import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordLoginEvent } from "@/lib/auth/login-event";
import {
  applyOnboardingCookie,
  startSessionForVerifiedPhone,
  type PhoneSessionResult,
} from "@/lib/auth/phone-session";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { telegramGrantAuthorizer } from "./identity";
import type { LoginGrant } from "./requests";

export async function startTelegramSession(
  request: NextRequest,
  db: SupabaseClient,
  grant: LoginGrant,
  logTag: string,
): Promise<PhoneSessionResult> {
  const session = await startSessionForVerifiedPhone(grant.phoneE164, logTag, {
    authorize: telegramGrantAuthorizer(db, grant),
    clientIp: getClientIp(request.headers),
  });
  if (session.ok) {
    void recordLoginEvent({ userId: session.userId, method: "telegram", request });
  }
  return session;
}

export function finishTelegramSessionResponse(
  response: NextResponse,
  needsOnboarding: boolean,
): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  applyOnboardingCookie(response, needsOnboarding);
  return response;
}
