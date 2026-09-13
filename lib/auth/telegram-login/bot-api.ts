// lib/auth/telegram-login/bot-api.ts — Cliente mínimo de la Bot API para el
// bot de LOGIN. Separado de lib/telegram/bot.ts (admin) a propósito: otro
// token, otra superficie. fetch pelado, sin dependencias.
//
// TELEGRAM_LOGIN_API_BASE_URL permite apuntar a un servidor de pruebas local
// y SOLO se respeta fuera de producción: en prod siempre es api.telegram.org.

const DEFAULT_API = "https://api.telegram.org";

export type BotApiCall = (
  method: string,
  body: Record<string, unknown>,
) => Promise<boolean>;

function apiBase(env: Record<string, string | undefined>): string {
  const override = env.TELEGRAM_LOGIN_API_BASE_URL?.trim();
  if (override && env.NODE_ENV !== "production") {
    return override.replace(/\/+$/, "");
  }
  return DEFAULT_API;
}

export function createLoginBotApi(
  botToken: string,
  env: Record<string, string | undefined> = process.env,
): BotApiCall {
  const base = apiBase(env);
  return async (method, body) => {
    try {
      const res = await fetch(`${base}/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Telegram espera respuesta del webhook: no colgamos el request.
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
      } | null;
      if (!json?.ok) {
        // La descripción de Telegram no lleva el token; la URL sí, no se loguea.
        console.warn(`[telegram-login] ${method} falló:`, json?.description ?? res.status);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[telegram-login] ${method} error:`, (err as Error).name);
      return false;
    }
  };
}
