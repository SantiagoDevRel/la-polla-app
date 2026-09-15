// lib/auth/telegram-login/webhook-updates.ts — Que el webhook del bot público
// reciba los toques de botones (callback_query).
//
// v2 registró el webhook con allowed_updates=["message"] y el token solo vive
// en Vercel (sensitive), así que no se puede volver a correr el script a mano
// sin rotar secretos. El bot de jugadores necesita callback_query: después de
// un update AUTENTICADO, el servidor lee getWebhookInfo y, si falta ese tipo,
// vuelve a llamar setWebhook con:
//   - la MISMA url que Telegram ya tiene (nunca una construida aquí: un preview
//     o un entorno local no puede robarse el webhook de producción);
//   - el secreto de la variable de entorno (el mismo que acaba de validar el
//     request que disparó esto);
//   - sin drop_pending_updates (no se pierde ningún mensaje en cola).
// Una vez por instancia. Sin webhook registrado, o con una url que no es la de
// este endpoint, no hace nada.

import type { BotApiResultCall } from "./bot-api";
import type { TelegramLoginConfig } from "./config";

export const REQUIRED_UPDATES = ["message", "callback_query"] as const;
export const WEBHOOK_PATH = "/api/telegram/login";

export type WebhookUpdatesSync = "disabled" | "current" | "updated" | "skipped" | "failed";

let confirmed = false;

/** Solo para pruebas. */
export function resetWebhookUpdatesStateForTests(): void {
  confirmed = false;
}

interface WebhookInfo {
  url?: string;
  allowed_updates?: string[];
  max_connections?: number;
}

export async function ensureWebhookUpdates(deps: {
  config: Pick<TelegramLoginConfig, "botToken" | "webhookSecret"> | null;
  call: BotApiResultCall;
}): Promise<WebhookUpdatesSync> {
  if (!deps.config?.botToken || !deps.config.webhookSecret) return "disabled";
  if (confirmed) return "current";

  const info = await deps.call<WebhookInfo>("getWebhookInfo", {});
  if (!info.ok) return "failed";
  const url = typeof info.result?.url === "string" ? info.result.url : "";
  let matches = false;
  try {
    const parsed = new URL(url);
    matches = parsed.protocol === "https:" && parsed.pathname === WEBHOOK_PATH;
  } catch {
    matches = false;
  }
  if (!matches) {
    // Sin webhook o apuntando a otra parte: nada que corregir desde aquí.
    confirmed = true;
    return "skipped";
  }

  // Sin allowed_updates Telegram usa su lista por defecto, que ya incluye
  // callback_query.
  const allowed = Array.isArray(info.result.allowed_updates) ? info.result.allowed_updates : null;
  if (!allowed || REQUIRED_UPDATES.every((type) => allowed.includes(type))) {
    confirmed = true;
    return "current";
  }

  const merged = Array.from(new Set([...allowed, ...REQUIRED_UPDATES]));
  const set = await deps.call("setWebhook", {
    url,
    secret_token: deps.config.webhookSecret,
    allowed_updates: merged,
    max_connections: typeof info.result.max_connections === "number" ? info.result.max_connections : 20,
  });
  if (!set.ok) return "failed";
  confirmed = true;
  return "updated";
}
