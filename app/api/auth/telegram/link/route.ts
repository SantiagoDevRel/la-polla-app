// app/api/auth/telegram/link/route.ts — Canje del enlace de un solo uso del
// bot de login de Telegram (v2, migración 119). Vence a los 5 minutos.
//
// El botón del bot abre la PÁGINA /login/telegram?t=… (app/(auth)/login/
// telegram/page.tsx), que se ve con el sistema de diseño y nunca abre sesión
// por sí sola. Esa página envía aquí el formulario:
//
// POST (t en el cuerpo):
//   1. Canal apagado → estado «unavailable», sin tocar la base.
//   2. Solo mismo origen con prueba positiva (Sec-Fetch-Site u Origin) y como
//      formulario.
//   3. La base canjea el hash del token en una transacción y consume la fila
//      entera: una solicitud abre UNA sola sesión.
//   4. Sesión con lib/auth/phone-session.ts (IP real) solo si la cuenta sigue
//      vinculada a esa cuenta de Telegram. Redirect 303 a /onboarding o /casa,
//      y aviso en Telegram con el dispositivo que abrió el enlace.
//   Cualquier fallo → 303 a /login/telegram?estado=… (sin token, sin sesión).
//
// Esta es la ÚNICA vía de sesión del login por Telegram: quien la usa tiene el
// token, que solo llegó al Telegram de la cuenta. La cookie lp_tg_req solo
// decide si la página confirma o entra directo.
//
// GET ?t= (enlaces emitidos con la ruta anterior) → 303 a la página. HEAD 405.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import {
  LOGIN_LINK_PATH,
  linkPageStateUrl,
  localeForHost,
  type LinkPageState,
} from "@/lib/auth/telegram-login/links";
import { notifySignedIn } from "@/lib/auth/telegram-login/notify";
import { consumeLoginLink, requesterLabel } from "@/lib/auth/telegram-login/requests";
import { readRequestBrowserHash } from "@/lib/auth/telegram-login/request-cookie";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import {
  finishTelegramSessionResponse,
  startTelegramSession,
} from "@/lib/auth/telegram-login/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toPage(request: NextRequest, pathAndQuery: string): NextResponse {
  const response = NextResponse.redirect(new URL(pathAndQuery, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function toState(request: NextRequest, state: LinkPageState): NextResponse {
  return toPage(request, linkPageStateUrl(state));
}

export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t")?.trim() ?? "";
  return toPage(
    request,
    token ? `${LOGIN_LINK_PATH}?t=${encodeURIComponent(token)}` : linkPageStateUrl("gone"),
  );
}

export async function POST(request: NextRequest) {
  const config = getTelegramLoginConfig();
  if (!config) return toState(request, "unavailable");

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (
    !isSameOriginRequest(request, { requireProof: true }) ||
    !contentType.startsWith("application/x-www-form-urlencoded")
  ) {
    return toState(request, "forbidden");
  }

  let token = "";
  try {
    const value = (await request.formData()).get("t");
    token = typeof value === "string" ? value.trim() : "";
  } catch {
    return toState(request, "gone");
  }

  const admin = createAdminClient();
  const result = await consumeLoginLink(admin, config, token, readRequestBrowserHash(request));

  if (result.status !== "ok") {
    if (result.status === "error") {
      console.error("[telegram-link] canje falló");
      return toState(request, "failed");
    }
    return toState(request, "gone");
  }

  const session = await startTelegramSession(request, admin, result.grant, "telegram-link");
  if (!session.ok) {
    return toState(request, session.stage === "denied" ? "sms_only" : "failed");
  }

  const locale = localeForHost(request.headers.get("host"));
  notifySignedIn(config, {
    telegramUserId: result.grant.telegramUserId,
    locale,
    label: requesterLabel(request.headers, locale),
  });

  const target = session.needsOnboarding ? "/onboarding" : "/casa";
  const response = finishTelegramSessionResponse(
    NextResponse.redirect(new URL(target, request.url), 303),
    session.needsOnboarding,
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  // La cookie lp_tg_req NO se borra: la pestaña que esperaba en este mismo
  // navegador la necesita para ver «consumed» con sesión y seguir (sin ella
  // vería «invalid» y diría que venció). Vence sola a los 5 minutos y ya no
  // sirve para nada: la fila quedó consumida.
  return response;
}

export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
  });
}
