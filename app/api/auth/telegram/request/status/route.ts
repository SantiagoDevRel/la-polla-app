// app/api/auth/telegram/request/status/route.ts — Estado de la solicitud de
// login por Telegram de ESTE navegador (cookie lp_tg_req). La pestaña de
// /login lo consulta cada 2 s mientras está visible.
//
// Solo devuelve { status, expiresAt }: nunca datos de la cuenta. Sin cookie →
// "invalid". Canal apagado → 404 sin tocar la base. no-store.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { getLoginRequestStatus } from "@/lib/auth/telegram-login/requests";
import { readRequestBrowserHash } from "@/lib/auth/telegram-login/request-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const config = getTelegramLoginConfig();
  if (!config) return json({ error: "not_available" }, 404);

  const browserHash = readRequestBrowserHash(request);
  if (!browserHash) return json({ status: "invalid", expiresAt: null });

  const result = await getLoginRequestStatus(createAdminClient(), browserHash);
  if (result.status === "error") return json({ error: "server_error" }, 500);
  return json({ status: result.status, expiresAt: result.expiresAt });
}
