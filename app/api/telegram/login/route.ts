// app/api/telegram/login/route.ts — Webhook del bot PÚBLICO de login.
// Distinto del panel de admin (/api/telegram/webhook): otro bot, otro token,
// otro secreto. Toda la lógica está en lib/auth/telegram-login/handler.ts.
//
// Orden de seguridad:
//   1. Sin configuración completa → 503, sin leer el body ni tocar la base.
//   2. Header X-Telegram-Bot-Api-Secret-Token comparado en tiempo constante
//      ANTES de leer una sola línea del body → 401 si no coincide.
//   3. Solo después se parsea el update. Siempre 200 hacia Telegram (si no,
//      reintenta en bucle).
//   4. Después de responder (after), y solo con un update autenticado: deja
//      comandos y descripciones del bot al día, una vez por versión
//      (lib/auth/telegram-login/bot-profile.ts). Nunca demora la respuesta.
//
// Exento del gate de sesión en lib/supabase/middleware.ts: quien llama es
// Telegram, no un navegador.

import { NextRequest, NextResponse } from "next/server";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { secretHeaderMatches } from "@/lib/auth/telegram-login/crypto";
import { createLoginBotApi } from "@/lib/auth/telegram-login/bot-api";
import { BOT_PROFILE_TIMEOUT_MS, ensureBotProfile } from "@/lib/auth/telegram-login/bot-profile";
import { handleLoginUpdate } from "@/lib/auth/telegram-login/handler";
import { runAfterResponse } from "@/lib/auth/telegram-login/notify";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const config = getTelegramLoginConfig();
  if (!config) {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }

  if (
    !secretHeaderMatches(
      req.headers.get("x-telegram-bot-api-secret-token"),
      config.webhookSecret,
    )
  ) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const db = createAdminClient();
  try {
    await handleLoginUpdate(update, {
      config,
      db,
      send: createLoginBotApi(config.botToken),
    });
  } catch (err) {
    console.error("[telegram-login] update falló:", (err as Error).message);
  }

  runAfterResponse(() =>
    ensureBotProfile({
      config,
      db,
      send: createLoginBotApi(config.botToken, process.env, { timeoutMs: BOT_PROFILE_TIMEOUT_MS }),
    }),
  );

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
