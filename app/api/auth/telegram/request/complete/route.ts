// app/api/auth/telegram/request/complete/route.ts — La pestaña de /login
// entra cuando su solicitud de Telegram quedó aprobada.
//
// POST JSON, mismo origen con prueba positiva (Sec-Fetch-Site u Origin) y la
// cookie lp_tg_req de la solicitud. La base consume la solicitud en una
// transacción (aprobada → consumida): una solicitud abre UNA sola sesión y el
// enlace que mandó el bot deja de servir. La sesión sale del mecanismo único
// de lib/auth/phone-session.ts con la IP real, y solo si la cuenta sigue
// vinculada a la cuenta de Telegram que aprobó.
//
//   200 { ok, newUser }         sesión en cookies; se borra lp_tg_req
//   409 { error: not_approved } todavía pendiente (la cookie sigue)
//   409 { error: sms_only }     la cuenta ya no acepta esa cuenta de Telegram
//   410 { error: <estado> }     vencida, cancelada, usada o inexistente
//
// Después de entrar, el bot avisa en Telegram desde dónde se entró
// (lib/auth/telegram-login/notify.ts).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { notifySignedIn } from "@/lib/auth/telegram-login/notify";
import { consumeLoginRequest } from "@/lib/auth/telegram-login/requests";
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

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function terminal(body: Record<string, unknown>, status: number) {
  const response = json(body, status);
  clearRequestCookie(response);
  return response;
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

  const browserHash = readRequestBrowserHash(request);
  if (!browserHash) return terminal({ error: "invalid" }, 410);

  const admin = createAdminClient();
  const consumed = await consumeLoginRequest(admin, browserHash);
  if (consumed.status === "error") {
    console.error("[telegram-request] consumo falló");
    return json({ error: "server_error" }, 500);
  }
  if (consumed.status === "pending") return json({ error: "not_approved" }, 409);
  if (consumed.status !== "ok") return terminal({ error: consumed.status }, 410);

  const session = await startTelegramSession(request, admin, consumed.grant, "telegram-request");
  if (!session.ok) {
    if (session.stage === "denied") return terminal({ error: "sms_only" }, 409);
    return terminal({ error: "session_failed" }, 500);
  }

  notifySignedIn(config, {
    telegramUserId: consumed.grant.telegramUserId,
    locale: consumed.locale,
    label: consumed.label,
  });

  const response = finishTelegramSessionResponse(
    json({ ok: true, newUser: session.needsOnboarding }),
    session.needsOnboarding,
  );
  clearRequestCookie(response);
  return response;
}
