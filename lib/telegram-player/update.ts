// lib/telegram-player/update.ts — Clasifica un update para el bot de jugadores.
// Función pura. Las mismas reglas de lib/auth/telegram-login/update.ts: solo
// chats privados, nunca bots, y el id del chat tiene que ser el de quien escribe.
//
// Texto, foto y botones son DATO: se comparan contra comandos y formatos
// conocidos, nunca se interpretan como instrucciones.

export interface PlayerPhoto {
  fileId: string;
  fileUniqueId: string;
  /** Tamaño que declara Telegram (puede faltar). */
  size: number | null;
  /** "photo" = Telegram ya la convirtió a JPEG; "document" = archivo tal cual. */
  source: "photo" | "document";
  mime: string | null;
}

export type PlayerUpdate =
  | { kind: "ignore" }
  | {
      kind: "callback";
      callbackId: string;
      chatId: number;
      telegramUserId: number;
      messageId: number | null;
      data: string;
    }
  | {
      kind: "message";
      chatId: number;
      telegramUserId: number;
      messageId: number | null;
      text: string | null;
      photo: PlayerPhoto | null;
      /** Mandó un documento que no es imagen, un sticker, un audio… */
      otherMedia: boolean;
      hasContact: boolean;
    };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

function str(v: unknown, max = 256): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

function largestPhoto(sizes: unknown): PlayerPhoto | null {
  if (!Array.isArray(sizes)) return null;
  let best: { fileId: string; fileUniqueId: string; size: number | null; area: number } | null = null;
  for (const s of sizes) {
    if (!isObj(s)) continue;
    const fileId = str(s.file_id);
    const fileUniqueId = str(s.file_unique_id, 64);
    if (!fileId || !fileUniqueId) continue;
    const area = (positiveInt(s.width) ?? 0) * (positiveInt(s.height) ?? 0);
    if (!best || area > best.area) best = { fileId, fileUniqueId, size: positiveInt(s.file_size), area };
  }
  return best ? { fileId: best.fileId, fileUniqueId: best.fileUniqueId, size: best.size, source: "photo", mime: "image/jpeg" } : null;
}

export function classifyPlayerUpdate(update: unknown): PlayerUpdate {
  if (!isObj(update)) return { kind: "ignore" };

  const query = update.callback_query;
  if (isObj(query)) {
    const from = query.from;
    const message = query.message;
    const chat = isObj(message) ? message.chat : null;
    const callbackId = str(query.id, 128);
    const data = str(query.data, 64);
    if (!callbackId || !isObj(from) || !isObj(message) || !isObj(chat)) return { kind: "ignore" };
    if (chat.type !== "private" || from.is_bot === true) return { kind: "ignore" };
    const chatId = positiveInt(chat.id);
    const telegramUserId = positiveInt(from.id);
    if (!chatId || !telegramUserId || chatId !== telegramUserId || !data) return { kind: "ignore" };
    return { kind: "callback", callbackId, chatId, telegramUserId, messageId: positiveInt(message.message_id), data };
  }

  const message = update.message;
  if (!isObj(message)) return { kind: "ignore" };
  const chat = message.chat;
  const from = message.from;
  if (!isObj(chat) || !isObj(from)) return { kind: "ignore" };
  if (chat.type !== "private" || from.is_bot === true) return { kind: "ignore" };
  const chatId = positiveInt(chat.id);
  const telegramUserId = positiveInt(from.id);
  if (!chatId || !telegramUserId || chatId !== telegramUserId) return { kind: "ignore" };

  const text = typeof message.text === "string" ? message.text.trim().slice(0, 500) : null;
  let photo = largestPhoto(message.photo);
  let otherMedia = false;
  if (!photo && isObj(message.document)) {
    const doc = message.document;
    const mime = str(doc.mime_type, 100);
    const fileId = str(doc.file_id);
    const fileUniqueId = str(doc.file_unique_id, 64);
    if (fileId && fileUniqueId && mime && /^image\//i.test(mime)) {
      photo = { fileId, fileUniqueId, size: positiveInt(doc.file_size), source: "document", mime: mime.toLowerCase() };
    } else {
      otherMedia = true;
    }
  } else if (!photo && !text && message.contact === undefined) {
    otherMedia = true;
  }

  return {
    kind: "message",
    chatId,
    telegramUserId,
    messageId: positiveInt(message.message_id),
    text: text || null,
    photo,
    otherMedia,
    hasContact: message.contact !== undefined,
  };
}

/** Quita emojis, signos y mayúsculas para comparar botones del teclado. */
export function normalizeCommandText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
