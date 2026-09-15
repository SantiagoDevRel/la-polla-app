// lib/auth/telegram-login/bot-api.ts — Cliente mínimo de la Bot API para el
// bot PÚBLICO (login + jugadores). Separado de lib/telegram/bot.ts (admin) a
// propósito: otro token, otra superficie. fetch pelado, sin dependencias.
//
// TELEGRAM_LOGIN_API_BASE_URL permite apuntar a un servidor de pruebas local
// y SOLO se respeta fuera de producción: en prod siempre es api.telegram.org.

const DEFAULT_API = "https://api.telegram.org";

export type BotApiCall = (
  method: string,
  body: Record<string, unknown>,
) => Promise<boolean>;

export type BotApiResult<T> = { ok: true; result: T } | { ok: false; description: string | null };

/** Igual que BotApiCall pero devuelve el resultado (getFile, editMessageText…). */
export type BotApiResultCall = <T = unknown>(
  method: string,
  body: Record<string, unknown>,
) => Promise<BotApiResult<T>>;

export interface LoginBotClient {
  send: BotApiCall;
  call: BotApiResultCall;
  /**
   * Descarga un archivo que la persona le mandó al bot (getFile + /file/). Solo
   * devuelve bytes si no pasan de maxBytes; nunca registra la URL (lleva el
   * token del bot).
   */
  download: (fileId: string, maxBytes: number) => Promise<Buffer | "too_large" | null>;
}

function apiBase(env: Record<string, string | undefined>): string {
  const override = env.TELEGRAM_LOGIN_API_BASE_URL?.trim();
  if (override && env.NODE_ENV !== "production") {
    return override.replace(/\/+$/, "");
  }
  return DEFAULT_API;
}

/** Espera máxima por llamada. Telegram espera la respuesta del webhook. */
export const BOT_API_TIMEOUT_MS = 8000;
/** Espera máxima para bajar una foto (hasta 8 MB). */
export const BOT_FILE_TIMEOUT_MS = 20_000;

export function createLoginBotClient(
  botToken: string,
  env: Record<string, string | undefined> = process.env,
  options: { timeoutMs?: number } = {},
): LoginBotClient {
  const base = apiBase(env);
  const timeoutMs = options.timeoutMs ?? BOT_API_TIMEOUT_MS;

  const call: BotApiResultCall = async <T,>(method: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`${base}/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Telegram espera respuesta del webhook: no colgamos el request.
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: T;
        description?: string;
      } | null;
      if (!json?.ok) {
        const description = json?.description ?? null;
        // «message is not modified» es normal al repetir un tap: no es un fallo.
        if (!description?.includes("message is not modified")) {
          // La descripción de Telegram no lleva el token; la URL sí, no se loguea.
          console.warn(`[telegram-login] ${method} falló:`, description ?? res.status);
        }
        return { ok: false, description };
      }
      return { ok: true, result: json.result as T };
    } catch (err) {
      console.warn(`[telegram-login] ${method} error:`, (err as Error).name);
      return { ok: false, description: null };
    }
  };

  const send: BotApiCall = async (method, body) => (await call(method, body)).ok;

  const download: LoginBotClient["download"] = async (fileId, maxBytes) => {
    const info = await call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
    if (!info.ok || typeof info.result.file_path !== "string") return null;
    if (typeof info.result.file_size === "number" && info.result.file_size > maxBytes) return "too_large";
    // file_path lo arma Telegram ("photos/file_12.jpg"); igual se valida.
    if (!/^[A-Za-z0-9_./-]{1,200}$/.test(info.result.file_path) || info.result.file_path.includes("..")) return null;
    try {
      const res = await fetch(`${base}/file/bot${botToken}/${info.result.file_path}`, {
        signal: AbortSignal.timeout(BOT_FILE_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) return null;
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) return "too_large";
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maxBytes) return "too_large";
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } catch (err) {
      console.warn("[telegram-login] descarga de archivo falló:", (err as Error).name);
      return null;
    }
  };

  return { send, call, download };
}

export function createLoginBotApi(
  botToken: string,
  env: Record<string, string | undefined> = process.env,
  options: { timeoutMs?: number } = {},
): BotApiCall {
  return createLoginBotClient(botToken, env, options).send;
}
