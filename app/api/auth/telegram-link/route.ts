// app/api/auth/telegram-link/route.ts — Enlace de un solo uso del bot de login
// de Telegram. GET ?t=<43 caracteres base64url>.
//
//   1. Canal apagado → página de error, sin tocar la base.
//   2. La base canjea el hash del token en una transacción (usado, vencido o
//      inexistente → error). Canjear el enlace invalida también el código.
//   3. Sesión con el mismo mecanismo que el magic-link
//      (lib/auth/phone-session.ts) y redirect a /onboarding o /casa.
//
// El token viaja en la URL: la respuesta nunca se cachea (no-store; el service
// worker ya deja /api/* en NetworkOnly) y el redirect no lleva Referer.
// HEAD responde 405 sin canjear: Next.js derivaría HEAD de GET y un
// verificador de enlaces quemaría el token.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { authErrorPage } from "@/lib/auth/auth-error-page";
import {
  applyOnboardingCookie,
  startSessionForVerifiedPhone,
} from "@/lib/auth/phone-session";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { consumeLoginLink } from "@/lib/auth/telegram-login/consume";
import { localeForHost } from "@/lib/auth/telegram-login/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  es: {
    unavailable: "Este acceso no está disponible. Entra con tu número desde /login.",
    invalid: "El enlace no es válido. Pide un código nuevo en el bot de Telegram.",
    used: "Este enlace ya se usó. Pide un código nuevo en el bot de Telegram.",
    expired: "Este enlace venció. Pide un código nuevo en el bot de Telegram.",
    failed: "No pudimos iniciar tu sesión. Inténtalo de nuevo.",
  },
  en: {
    unavailable: "This sign-in option is not available. Sign in with your number at /login.",
    invalid: "This link is not valid. Request a new code in the Telegram bot.",
    used: "This link was already used. Request a new code in the Telegram bot.",
    expired: "This link expired. Request a new code in the Telegram bot.",
    failed: "We could not sign you in. Please try again.",
  },
} as const;

export async function GET(request: NextRequest) {
  const locale = localeForHost(request.headers.get("host"));
  const copy = COPY[locale];

  const config = getTelegramLoginConfig();
  if (!config) return authErrorPage(copy.unavailable, 404, locale);

  const token = request.nextUrl.searchParams.get("t")?.trim() ?? "";
  const admin = createAdminClient();
  const result = await consumeLoginLink(admin, config, token);

  if (result.status !== "ok") {
    if (result.status === "error") {
      console.error("[telegram-link] canje falló");
      return authErrorPage(copy.failed, 500, locale);
    }
    return authErrorPage(copy[result.status], 400, locale);
  }

  const session = await startSessionForVerifiedPhone(result.phoneE164, "telegram-link");
  if (!session.ok) return authErrorPage(copy.failed, 500, locale);

  void recordLoginEvent({ userId: session.userId, method: "telegram", request });

  const target = session.needsOnboarding ? "/onboarding" : "/casa";
  const response = NextResponse.redirect(new URL(target, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  applyOnboardingCookie(response, session.needsOnboarding);
  return response;
}

export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET", "Cache-Control": "no-store" },
  });
}
