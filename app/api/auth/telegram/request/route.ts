// app/api/auth/telegram/request/route.ts — Solicitud de login por Telegram
// atada a este navegador (v2, migración 119).
//
// POST (JSON, mismo origen con prueba positiva): crea la solicitud, fija la
// cookie httpOnly lp_tg_req (lib/auth/telegram-login/request-cookie.ts) y
// devuelve el deep link t.me/<bot>?start=<nonce>. El nonce solo viaja en esta
// respuesta; la base guarda sha256 del nonce y del secreto de la cookie.
// Tope: 10 solicitudes / 15 min por IPv4 o por /64 de IPv6 (en la misma
// transacción del insert), sin tope global que deje a todos sin Telegram.
// La solicitud no abre sesión: solo ata el enlace del bot a este navegador.
//
// DELETE (mismo origen): botón Cancelar. Cancela la solicitud de esta cookie
// (pendiente o aprobada sin usar) y borra la cookie.
//
// Canal apagado → 404 sin tocar la base. Nunca cacheable.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { generateBrowserSecret, generateNonce } from "@/lib/auth/telegram-login/crypto";
import { telegramLoginDeepLink } from "@/lib/auth/telegram-login/deep-link";
import { localeForHost } from "@/lib/auth/telegram-login/links";
import {
  cancelLoginRequest,
  createLoginRequest,
  requesterLabel,
} from "@/lib/auth/telegram-login/requests";
import {
  clearRequestCookie,
  readRequestBrowserHash,
  setRequestCookie,
} from "@/lib/auth/telegram-login/request-cookie";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const config = getTelegramLoginConfig();
  if (!config) return json({ error: "not_available" }, 404);

  if (!isSameOriginRequest(request, { requireProof: true })) {
    return json({ error: "forbidden" }, 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  const locale = localeForHost(request.headers.get("host"));
  const nonce = generateNonce();
  const browserSecret = generateBrowserSecret();
  const created = await createLoginRequest(createAdminClient(), {
    nonce,
    browserSecret,
    locale,
    ip: getClientIp(request.headers),
    label: requesterLabel(request.headers, locale),
  });

  if (created.status === "rate_limited") return json({ error: "rate_limited" }, 429);
  if (created.status !== "ok") {
    console.error("[telegram-request] no se pudo crear la solicitud");
    return json({ error: "server_error" }, 500);
  }

  const response = json({
    deepLink: telegramLoginDeepLink(config.botUsername, nonce),
    expiresAt: created.expiresAt,
  });
  setRequestCookie(response, browserSecret);
  return response;
}

export async function DELETE(request: NextRequest) {
  const config = getTelegramLoginConfig();
  if (!config) return json({ error: "not_available" }, 404);
  if (!isSameOriginRequest(request, { requireProof: true })) {
    return json({ error: "forbidden" }, 403);
  }

  const browserHash = readRequestBrowserHash(request);
  if (browserHash) {
    await cancelLoginRequest(createAdminClient(), { browserHash });
  }
  const response = json({ ok: true });
  clearRequestCookie(response);
  return response;
}
