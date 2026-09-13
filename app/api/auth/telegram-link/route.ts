// app/api/auth/telegram-link/route.ts — Enlace de un solo uso del bot de login
// de Telegram.
//
// GET ?t=<43 caracteres base64url> NO abre sesión. Muestra a qué número se va a
// entrar ("+57 ••• ••• 4567") y un botón que hace el POST. Sin ese paso,
// cualquiera podía reenviar SU enlace por chat y dejar a otra persona dentro de
// la cuenta del atacante (reemplazando la sesión que ya tenía en ese navegador).
// Tampoco lo quema un escáner de enlaces ni una vista previa.
//
// POST (formulario de esa misma página, t en el cuerpo):
//   1. Canal apagado → página de error, sin tocar la base.
//   2. Solo mismo origen, con prueba positiva (Sec-Fetch-Site u Origin): un
//      formulario de otro sitio no canjea.
//   3. La base canjea el hash del token en una transacción (usado, vencido o
//      inexistente → error). Canjear el enlace invalida también el código.
//   4. Sesión con el mismo mecanismo que el magic-link
//      (lib/auth/phone-session.ts), solo si la cuenta de Telegram que pidió el
//      enlace está autorizada para esa cuenta (identity.ts). Redirect 303 a
//      /onboarding o /casa.
//
// El token nunca se cachea (no-store; el service worker ya deja /api/* en
// NetworkOnly). HEAD responde 405: Next.js derivaría HEAD de GET.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { authConfirmPage, authErrorPage } from "@/lib/auth/auth-error-page";
import {
  applyOnboardingCookie,
  startSessionForVerifiedPhone,
} from "@/lib/auth/phone-session";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { consumeLoginLink, peekLoginLink } from "@/lib/auth/telegram-login/consume";
import { telegramSessionAuthorizer } from "@/lib/auth/telegram-login/identity";
import { localeForHost } from "@/lib/auth/telegram-login/links";
import { maskPhone } from "@/lib/auth/telegram-login/messages";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/auth/telegram-link";

const COPY = {
  es: {
    unavailable: "Este acceso no está disponible. Entra con tu número desde /login.",
    invalid: "El enlace no es válido. Pide un código nuevo en el bot de Telegram.",
    used: "Este enlace ya se usó. Pide un código nuevo en el bot de Telegram.",
    expired: "Este enlace venció. Pide un código nuevo en el bot de Telegram.",
    failed: "No pudimos iniciar tu sesión. Inténtalo de nuevo.",
    forbidden: "Abre el enlace otra vez y confirma desde esa página.",
    smsOnly: "Por seguridad, con este número solo puedes entrar con el código por SMS.",
    title: "La Polla · Confirma tu ingreso",
    heading: "Confirma tu ingreso",
    lead: "Vas a entrar a La Polla con el número:",
    notYours:
      "Si este no es tu número, no continúes: alguien pudo enviarte este enlace. Pide tu propio código en el bot de Telegram.",
    replacesSession: "Este navegador ya tiene una sesión abierta. Si continúas, esa sesión se cierra.",
    submit: "Entrar con este número",
    cancel: "Cancelar",
  },
  en: {
    unavailable: "This sign-in option is not available. Sign in with your number at /login.",
    invalid: "This link is not valid. Request a new code in the Telegram bot.",
    used: "This link was already used. Request a new code in the Telegram bot.",
    expired: "This link expired. Request a new code in the Telegram bot.",
    failed: "We could not sign you in. Please try again.",
    forbidden: "Open the link again and confirm from that page.",
    smsOnly: "For your security, this number can only sign in with the text message code.",
    title: "Chicken Picks · Confirm sign-in",
    heading: "Confirm sign-in",
    lead: "You are about to sign in to Chicken Picks with the number:",
    notYours:
      "If this is not your number, do not continue: someone may have sent you this link. Request your own code in the Telegram bot.",
    replacesSession: "This browser already has an open session. If you continue, that session will end.",
    submit: "Sign in with this number",
    cancel: "Cancel",
  },
} as const;

// Cookies de sesión de @supabase/ssr: sb-<ref>-auth-token, a veces en trozos .0/.1.
const SESSION_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

export async function GET(request: NextRequest) {
  const locale = localeForHost(request.headers.get("host"));
  const copy = COPY[locale];

  const config = getTelegramLoginConfig();
  if (!config) return authErrorPage(copy.unavailable, 404, locale);

  const token = request.nextUrl.searchParams.get("t")?.trim() ?? "";
  const result = await peekLoginLink(createAdminClient(), config, token);

  if (result.status !== "ok") {
    if (result.status === "error") {
      console.error("[telegram-link] lectura falló");
      return authErrorPage(copy.failed, 500, locale);
    }
    return authErrorPage(copy[result.status], 400, locale);
  }

  const hasSession = request.cookies
    .getAll()
    .some((c) => SESSION_COOKIE_RE.test(c.name));

  return authConfirmPage({
    locale,
    title: copy.title,
    heading: copy.heading,
    lead: copy.lead,
    maskedPhone: maskPhone(result.phoneE164),
    warnings: hasSession ? [copy.notYours, copy.replacesSession] : [copy.notYours],
    action: PATH,
    fields: { t: token },
    submit: copy.submit,
    cancel: copy.cancel,
  });
}

export async function POST(request: NextRequest) {
  const locale = localeForHost(request.headers.get("host"));
  const copy = COPY[locale];

  const config = getTelegramLoginConfig();
  if (!config) return authErrorPage(copy.unavailable, 404, locale);

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (
    !isSameOriginRequest(request, { requireProof: true }) ||
    !contentType.startsWith("application/x-www-form-urlencoded")
  ) {
    return authErrorPage(copy.forbidden, 403, locale);
  }

  let token = "";
  try {
    const value = (await request.formData()).get("t");
    token = typeof value === "string" ? value.trim() : "";
  } catch {
    return authErrorPage(copy.invalid, 400, locale);
  }

  const admin = createAdminClient();
  const result = await consumeLoginLink(admin, config, token);

  if (result.status !== "ok") {
    if (result.status === "error") {
      console.error("[telegram-link] canje falló");
      return authErrorPage(copy.failed, 500, locale);
    }
    return authErrorPage(copy[result.status], 400, locale);
  }

  const session = await startSessionForVerifiedPhone(result.phoneE164, "telegram-link", {
    authorize: telegramSessionAuthorizer(admin, config, result.telegramUserId),
    clientIp: getClientIp(request.headers),
  });
  if (!session.ok) {
    if (session.stage === "denied") return authErrorPage(copy.smsOnly, 409, locale);
    return authErrorPage(copy.failed, 500, locale);
  }

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
    headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
  });
}
