// app/api/auth/telegram/link/route.ts — Enlace de un solo uso del bot de login
// de Telegram (v2, migración 119). Vence a los 5 minutos de emitido.
//
// GET ?t=<43 caracteres base64url> NUNCA abre sesión por sí solo:
//   - Si este navegador tiene la cookie lp_tg_req de ESA misma solicitud (lo
//     abrió quien tocó «Entrar con Telegram»), la página envía sola el POST.
//   - Si no, muestra «Confirma tu ingreso» con el número enmascarado y un botón
//     que hace el POST. Sin ese paso, alguien podía reenviar SU enlace y dejar a
//     otra persona dentro de la cuenta del atacante (login CSRF). Tampoco lo
//     quema un escáner de enlaces ni una vista previa.
//
// POST (formulario de esa misma página, t en el cuerpo):
//   1. Canal apagado → página de error, sin tocar la base.
//   2. Solo mismo origen con prueba positiva (Sec-Fetch-Site u Origin).
//   3. La base canjea el hash del token en una transacción: consume la fila
//      entera, así la pestaña que esperaba ya no abre otra sesión.
//   4. Sesión con lib/auth/phone-session.ts (IP real) solo si la cuenta sigue
//      vinculada a esa cuenta de Telegram. Redirect 303 a /onboarding o /casa.
//
// no-store y Referrer-Policy same-origin; HEAD responde 405 (Next derivaría
// HEAD de GET).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authAutoSubmitPage,
  authConfirmPage,
  authErrorPage,
} from "@/lib/auth/auth-error-page";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { LOGIN_LINK_PATH, localeForHost } from "@/lib/auth/telegram-login/links";
import { maskPhone } from "@/lib/auth/telegram-login/messages";
import { consumeLoginLink, peekLoginLink } from "@/lib/auth/telegram-login/requests";
import {
  clearRequestCookie,
  readRequestBrowserHash,
} from "@/lib/auth/telegram-login/request-cookie";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import {
  finishTelegramSessionResponse,
  startTelegramSession,
} from "@/lib/auth/telegram-login/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  es: {
    unavailable: "Este acceso no está disponible. Entra con tu número desde /login.",
    gone: "Este enlace ya se usó o venció. Pide uno nuevo en el bot.",
    failed: "No pudimos iniciar tu sesión. Inténtalo de nuevo.",
    forbidden: "Abre el enlace otra vez y confirma desde esa página.",
    smsOnly: "Por seguridad, con este número solo puedes entrar con el código por SMS.",
    title: "La Polla · Confirma tu ingreso",
    heading: "Confirma tu ingreso",
    lead: "Vas a entrar a La Polla con el número:",
    notYours:
      "Si este no es tu número, no continúes: alguien pudo enviarte este enlace. Pide tu propio enlace en el bot de Telegram.",
    replacesSession: "Este navegador ya tiene una sesión abierta. Si continúas, esa sesión se cierra.",
    submit: "Entrar",
    cancel: "Cancelar",
    autoTitle: "La Polla · Entrando",
    autoHeading: "Entrando a La Polla",
    autoLead: "Un momento, estamos abriendo tu sesión.",
  },
  en: {
    unavailable: "This sign-in option is not available. Sign in with your number at /login.",
    gone: "This link was already used or expired. Request a new one in the bot.",
    failed: "We could not sign you in. Please try again.",
    forbidden: "Open the link again and confirm from that page.",
    smsOnly: "For your security, this number can only sign in with the text message code.",
    title: "Chicken Picks · Confirm sign-in",
    heading: "Confirm sign-in",
    lead: "You are about to sign in to Chicken Picks with the number:",
    notYours:
      "If this is not your number, do not continue: someone may have sent you this link. Request your own link in the Telegram bot.",
    replacesSession: "This browser already has an open session. If you continue, that session will end.",
    submit: "Sign in",
    cancel: "Cancel",
    autoTitle: "Chicken Picks · Signing in",
    autoHeading: "Signing in to Chicken Picks",
    autoLead: "One moment, we are opening your session.",
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
  const result = await peekLoginLink(
    createAdminClient(),
    config,
    token,
    readRequestBrowserHash(request),
  );

  if (result.status !== "ok") {
    if (result.status === "error") {
      console.error("[telegram-link] lectura falló");
      return authErrorPage(copy.failed, 500, locale);
    }
    return authErrorPage(copy.gone, 410, locale);
  }

  if (result.sameBrowser) {
    return authAutoSubmitPage({
      locale,
      title: copy.autoTitle,
      heading: copy.autoHeading,
      lead: copy.autoLead,
      action: LOGIN_LINK_PATH,
      fields: { t: token },
      submit: copy.submit,
    });
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
    action: LOGIN_LINK_PATH,
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
    return authErrorPage(copy.gone, 410, locale);
  }

  const admin = createAdminClient();
  const result = await consumeLoginLink(admin, config, token, readRequestBrowserHash(request));

  if (result.status !== "ok") {
    if (result.status === "error") {
      console.error("[telegram-link] canje falló");
      return authErrorPage(copy.failed, 500, locale);
    }
    return authErrorPage(copy.gone, 410, locale);
  }

  const session = await startTelegramSession(request, admin, result.grant, "telegram-link");
  if (!session.ok) {
    if (session.stage === "denied") return authErrorPage(copy.smsOnly, 409, locale);
    return authErrorPage(copy.failed, 500, locale);
  }

  const target = session.needsOnboarding ? "/onboarding" : "/casa";
  const response = finishTelegramSessionResponse(
    NextResponse.redirect(new URL(target, request.url), 303),
    session.needsOnboarding,
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  // La pestaña que esperaba en este mismo navegador ya no tiene nada que hacer.
  if (result.sameBrowser) clearRequestCookie(response);
  return response;
}

export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
  });
}
