// lib/telegram/bot.ts — cliente minimo de la Bot API de Telegram.
//
// Solo lo que necesita el panel de admin: mandar texto, mandar la foto del
// comprobante con botones, y responder el tap de un boton. Sin dependencias
// nuevas: fetch pelado contra api.telegram.org.

const API = "https://api.telegram.org";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN no esta configurado");
  return t;
}

async function call<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await fetch(`${API}/bot${token()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // El bot no puede colgar una request de un usuario: si Telegram tarda,
      // se corta y seguimos. La fila en DB ya quedo guardada.
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.warn(`[telegram] ${method} fallo:`, json.description);
      return null;
    }
    return json.result ?? null;
  } catch (err) {
    console.warn(`[telegram] ${method} exploto:`, (err as Error).message);
    return null;
  }
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export function sendMessage(
  chatId: number | string,
  text: string,
  buttons?: InlineButton[][],
) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export function sendPhoto(
  chatId: number | string,
  photoUrl: string,
  caption: string,
  buttons?: InlineButton[][],
) {
  return call<{ message_id: number }>("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Apaga el "relojito" del boton. Telegram lo exige tras cada callback. */
export function answerCallback(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

/** Quita los botones de un mensaje ya resuelto, para que no se toque dos veces. */
export function clearButtons(chatId: number | string, messageId: number) {
  return call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

export function editCaption(
  chatId: number | string,
  messageId: number,
  caption: string,
) {
  return call("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [] },
  });
}

export function setWebhook(url: string, secret: string) {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

/** Escapa lo que va dentro de HTML de Telegram (nombres de gente, notas). */
export function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
