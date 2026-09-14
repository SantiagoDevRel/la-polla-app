// app/api/cron/telegram-login-bot-profile/route.ts — Sincroniza a pedido los
// comandos y descripciones del bot PÚBLICO de login por Telegram.
//
// Normalmente no hace falta: el webhook lo hace solo después del primer update
// de cada versión (lib/auth/telegram-login/bot-profile.ts). Esta ruta existe
// para correrlo sin esperar a que alguien le escriba al bot, o para forzarlo:
//   gh workflow run telegram-login-bot-profile.yml [-f force=true]
//
// Auth: Authorization: Bearer ${CRON_SECRET} vía requireCronSecret, ANTES de
// leer la configuración o crear el admin client (el middleware exime
// /api/cron/ del gate de sesión). ?force=1 ignora la versión guardada.
//
// El body va al log PÚBLICO de Actions: solo el estado, la etapa que falló y
// la versión (un hash). Nunca el token ni respuestas de Telegram.

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { createLoginBotApi } from "@/lib/auth/telegram-login/bot-api";
import { ensureBotProfile } from "@/lib/auth/telegram-login/bot-profile";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const config = getTelegramLoginConfig();
  if (!config) {
    return NextResponse.json(
      { error: "telegram login not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const result = await ensureBotProfile({
    config,
    db: createAdminClient,
    send: createLoginBotApi(config.botToken),
    force: request.nextUrl.searchParams.get("force") === "1",
    retryNow: true,
  });

  if (result.status === "failed") {
    return NextResponse.json(
      { error: "bot profile sync failed", stage: result.stage, version: result.version },
      { status: 502, headers: NO_STORE },
    );
  }
  if (result.status === "disabled") {
    return NextResponse.json(
      { error: "telegram login not configured" },
      { status: 503, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { ok: true, status: result.status, version: result.version },
    { headers: NO_STORE },
  );
}
