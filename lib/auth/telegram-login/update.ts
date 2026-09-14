// lib/auth/telegram-login/update.ts — Clasifica un update de Telegram para el
// bot de login. Función pura: no toca red ni base, así se prueba sola.
//
// Prueba de propiedad del teléfono: el bot NUNCA acepta un número escrito. Solo
// sirve un mensaje con `contact` en un chat privado donde contact.user_id es el
// mismo from.id que envía el mensaje. Telegram llena user_id solo cuando el
// contacto es una cuenta de Telegram; el botón request_contact comparte el de
// la propia cuenta. Un contacto de otra persona (o reenviado) no pasa.
//
// El contenido del mensaje es DATO: solo se compara contra comandos conocidos.
// v2: "/start <nonce>" trae la solicitud del navegador; "/start", "/login" o
// cualquier otro texto se atienden igual pero sin solicitud.

import { toE164 } from "@/lib/auth/phone";
import { NONCE_RE } from "./crypto";

export type LoginLocale = "es" | "en";

export type LoginUpdateAction =
  | { kind: "ignore" }
  | {
      kind: "message";
      chatId: number;
      telegramUserId: number;
      /** Nonce de la solicitud del navegador (solo desde /start <nonce>). */
      nonce?: string;
      /** Idioma de un deep link viejo (/start login | login_en). */
      locale?: LoginLocale;
    }
  | { kind: "foreign_contact"; chatId: number; telegramUserId: number }
  | { kind: "invalid_phone"; chatId: number; telegramUserId: number }
  | {
      kind: "own_contact";
      chatId: number;
      telegramUserId: number;
      phoneE164: string;
    };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

export function classifyLoginUpdate(update: unknown): LoginUpdateAction {
  if (!isObj(update)) return { kind: "ignore" };
  // edited_message, channel_post, callback_query, etc. no se atienden.
  const message = update.message;
  if (!isObj(message)) return { kind: "ignore" };

  const chat = message.chat;
  const from = message.from;
  if (!isObj(chat) || !isObj(from)) return { kind: "ignore" };
  if (chat.type !== "private") return { kind: "ignore" };
  if (from.is_bot === true) return { kind: "ignore" };

  const chatId = positiveInt(chat.id);
  const telegramUserId = positiveInt(from.id);
  // En un chat privado el id del chat es el del usuario. Si no coincide, algo
  // raro pasa y no respondemos.
  if (!chatId || !telegramUserId || chatId !== telegramUserId) {
    return { kind: "ignore" };
  }

  if (message.contact !== undefined) {
    const contact = message.contact;
    const forwarded =
      message.forward_origin !== undefined ||
      message.forward_from !== undefined ||
      message.forward_sender_name !== undefined ||
      message.forward_date !== undefined;
    if (
      !isObj(contact) ||
      forwarded ||
      positiveInt(contact.user_id) !== telegramUserId
    ) {
      return { kind: "foreign_contact", chatId, telegramUserId };
    }
    const phoneE164 =
      typeof contact.phone_number === "string"
        ? toE164(contact.phone_number)
        : null;
    if (!phoneE164) return { kind: "invalid_phone", chatId, telegramUserId };
    return { kind: "own_contact", chatId, telegramUserId, phoneE164 };
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/i.exec(text);
  const payload = start?.[1];
  if (payload && NONCE_RE.test(payload)) {
    // El nonce distingue mayúsculas: se conserva tal cual.
    return { kind: "message", chatId, telegramUserId, nonce: payload };
  }
  const legacy = payload?.toLowerCase();
  if (legacy === "login" || legacy === "login_en") {
    return {
      kind: "message",
      chatId,
      telegramUserId,
      locale: legacy === "login_en" ? "en" : "es",
    };
  }

  // /start sin payload, /login, cualquier texto, stickers, fotos.
  return { kind: "message", chatId, telegramUserId };
}
