// lib/auth/telegram-login/handler.ts — Lógica del webhook del bot de login (v2).
// Vive fuera de app/api/telegram/login/route.ts porque un route.ts solo puede
// exportar handlers HTTP, y así se prueba con dependencias falsas.
//
// Flujo:
//   - Cuenta de Telegram YA vinculada: no se pide el número. Con /start <nonce>
//     se aprueba la solicitud del navegador (entra solo) y se manda además un
//     enlace de un solo uso; sin nonce, solo el enlace.
//   - Sin vínculo: se pide el número UNA vez (teclado persistente). Al llegar
//     el contacto propio se busca o crea la cuenta, se vincula si las reglas lo
//     permiten (identity.ts) y se aprueba la solicitud pendiente o se manda el
//     enlace.
//   - Nunca se mandan códigos. allowed_updates sigue siendo ["message"]: nada
//     depende de callback_query.

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactId, redactPhone } from "@/lib/log";
import type { TelegramLoginConfig } from "./config";
import type { BotApiCall } from "./bot-api";
import { generateLinkToken } from "./crypto";
import { canIssueFor, linkTelegramAccountForContact, telegramIdentityStatus } from "./identity";
import { loginLinkUrl } from "./links";
import { loginBotCopy } from "./messages";
import {
  approveLoginRequest,
  cancelLoginRequest,
  findLoginRequestByNonce,
  issueBotLink,
  linkedAccountFor,
  type FoundRequest,
  type LoginGrant,
} from "./requests";
import { classifyLoginUpdate, type LoginLocale, type LoginUpdateAction } from "./update";

export interface LoginHandlerDeps {
  config: TelegramLoginConfig;
  db: SupabaseClient;
  send: BotApiCall;
  env?: Record<string, string | undefined>;
  /** Reloj inyectable para las pruebas. */
  now?: () => number;
}

export type LoginHandlerOutcome =
  | "ignored"
  | "approved"
  | "link_sent"
  | "prompted"
  | "foreign_contact"
  | "invalid_phone"
  | "sms_only"
  | "rate_limited"
  | "failed";

/** No repetir el mensaje largo de «Compartir mi número» antes de esto. */
export const PROMPT_REPEAT_MS = 2 * 60_000;

type Copy = ReturnType<typeof loginBotCopy>;

interface ChatState {
  exists: boolean;
  locale: LoginLocale | null;
  pendingRequestId: string | null;
  contactPromptedAt: number | null;
  keyboardOpen: boolean;
}

function shareKeyboard(copy: Copy) {
  return {
    keyboard: [[{ text: copy.shareButton, request_contact: true }]],
    // Persistente: en Telegram Web/Desktop un teclado no persistente queda
    // escondido detrás de un ícono y la persona no encuentra el botón.
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: copy.sharePlaceholder,
  };
}

async function readChat(db: SupabaseClient, telegramUserId: number): Promise<ChatState> {
  const { data, error } = await db
    .from("telegram_login_chats")
    .select("locale, pending_request_id, contact_prompted_at, reply_keyboard_open")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error || !data) {
    // Sin fila (o sin lectura) no sabemos si quedó un teclado viejo: se quita.
    return {
      exists: false,
      locale: null,
      pendingRequestId: null,
      contactPromptedAt: null,
      keyboardOpen: true,
    };
  }
  const prompted = data.contact_prompted_at ? Date.parse(String(data.contact_prompted_at)) : NaN;
  return {
    exists: true,
    locale: data.locale === "en" ? "en" : data.locale === "es" ? "es" : null,
    pendingRequestId: typeof data.pending_request_id === "string" ? data.pending_request_id : null,
    contactPromptedAt: Number.isFinite(prompted) ? prompted : null,
    keyboardOpen: data.reply_keyboard_open !== false,
  };
}

async function saveChat(
  db: SupabaseClient,
  telegramUserId: number,
  patch: {
    locale: LoginLocale;
    pending_request_id?: string | null;
    contact_prompted_at?: string | null;
    reply_keyboard_open?: boolean;
  },
): Promise<void> {
  const { error } = await db.from("telegram_login_chats").upsert(
    { telegram_user_id: telegramUserId, updated_at: new Date().toISOString(), ...patch },
    { onConflict: "telegram_user_id" },
  );
  if (error) console.warn("[telegram-login] no se guardó el chat:", error.code);
}

async function sendPlain(
  send: BotApiCall,
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<boolean> {
  return send("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/**
 * Mensaje con el botón del enlace. Un mensaje admite un solo reply_markup: si
 * hay que quitar un teclado viejo, primero va el texto con remove_keyboard y
 * después el botón en un segundo mensaje.
 */
async function deliverLink(
  send: BotApiCall,
  input: {
    chatId: number;
    copy: Copy;
    lead: string | null;
    linkText: string;
    url: string;
    removeKeyboard: boolean;
  },
): Promise<boolean> {
  const { chatId, copy, lead, linkText, url, removeKeyboard } = input;
  const withButton = {
    chat_id: chatId,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    // Sin reenvío ni guardado: el enlace es para esta persona.
    protect_content: true,
    reply_markup: { inline_keyboard: [[{ text: copy.linkButton, url }]] },
  };
  if (removeKeyboard) {
    await sendPlain(send, chatId, lead ?? copy.linkedReady, { remove_keyboard: true });
    return send("sendMessage", { ...withButton, text: linkText });
  }
  return send("sendMessage", { ...withButton, text: lead ? `${lead}\n\n${linkText}` : linkText });
}

async function answerRemovingKeyboard(
  deps: LoginHandlerDeps,
  chatId: number,
  telegramUserId: number,
  locale: LoginLocale,
  text: string,
  extra: { pending_request_id?: null } = {},
): Promise<void> {
  const sent = await sendPlain(deps.send, chatId, text, { remove_keyboard: true });
  await saveChat(deps.db, telegramUserId, {
    locale,
    ...extra,
    ...(sent ? { reply_keyboard_open: false } : {}),
  });
}

/**
 * La cuenta ya se sabe (vinculada o recién vinculada): aprueba la solicitud
 * del navegador si hay una usable y manda el enlace; si no, solo el enlace.
 */
async function grantAccess(
  deps: LoginHandlerDeps,
  input: {
    chatId: number;
    chat: ChatState;
    locale: LoginLocale;
    grant: LoginGrant;
    requestId: string | null;
    staleRequest: boolean;
    defaultLead: string | null;
    removeKeyboard: boolean;
  },
): Promise<LoginHandlerOutcome> {
  const { db, send, config } = deps;
  const { chatId, locale, grant, removeKeyboard } = input;
  const copy = loginBotCopy(locale);
  const tg = grant.telegramUserId;
  let stale = input.staleRequest;

  if (input.requestId) {
    const linkToken = generateLinkToken();
    const approved = await approveLoginRequest(db, config, input.requestId, grant, linkToken);
    if (approved.status === "ok") {
      const approvedCopy = loginBotCopy(approved.locale);
      const sent = await deliverLink(send, {
        chatId,
        copy: approvedCopy,
        lead: approvedCopy.approved(approved.label),
        linkText: approvedCopy.linkAfterApproval,
        url: loginLinkUrl(approved.locale, linkToken, deps.env),
        removeKeyboard,
      });
      await saveChat(db, tg, {
        locale: approved.locale,
        pending_request_id: null,
        ...(sent ? { reply_keyboard_open: false } : {}),
      });
      return "approved";
    }
    if (approved.status === "rate_limited") {
      await answerRemovingKeyboard(deps, chatId, tg, locale, copy.rateLimited);
      return "rate_limited";
    }
    if (approved.status === "error" || approved.status === "not_linked") {
      console.error(
        "[telegram-login] aprobación falló:",
        redactId(String(tg)),
        approved.status,
      );
      await answerRemovingKeyboard(deps, chatId, tg, locale, copy.failure, { pending_request_id: null });
      return "failed";
    }
    // invalid | expired | unavailable: se sigue con un enlace suelto.
    stale = true;
  }

  const linkToken = generateLinkToken();
  const issued = await issueBotLink(db, config, grant, linkToken, locale);
  if (issued === "rate_limited") {
    await answerRemovingKeyboard(deps, chatId, tg, locale, copy.rateLimited, { pending_request_id: null });
    return "rate_limited";
  }
  if (issued !== "ok") {
    console.error("[telegram-login] emisión de enlace falló:", redactId(String(tg)), issued);
    await answerRemovingKeyboard(deps, chatId, tg, locale, copy.failure, { pending_request_id: null });
    return "failed";
  }
  const sent = await deliverLink(send, {
    chatId,
    copy,
    lead: stale ? copy.requestExpired : input.defaultLead,
    linkText: copy.linkOnly,
    url: loginLinkUrl(locale, linkToken, deps.env),
    removeKeyboard,
  });
  await saveChat(db, tg, {
    locale,
    pending_request_id: null,
    ...(sent ? { reply_keyboard_open: false } : {}),
  });
  return "link_sent";
}

async function handleMessage(
  deps: LoginHandlerDeps,
  action: Extract<LoginUpdateAction, { kind: "message" }>,
  chat: ChatState,
): Promise<LoginHandlerOutcome> {
  const { db, send } = deps;
  const { chatId, telegramUserId } = action;
  const now = deps.now?.() ?? Date.now();

  let request: FoundRequest | null = null;
  if (action.nonce) {
    const found = await findLoginRequestByNonce(db, action.nonce);
    if (found === "error") {
      await answerRemovingKeyboard(deps, chatId, telegramUserId, chat.locale ?? "es", loginBotCopy(chat.locale ?? "es").failure);
      return "failed";
    }
    request = found;
  }

  const locale: LoginLocale = request?.locale ?? action.locale ?? chat.locale ?? "es";
  const copy = loginBotCopy(locale);
  const usable =
    request &&
    (request.status === "pending" ||
      (request.status === "approved" && request.telegramUserId === telegramUserId))
      ? request
      : null;
  const staleRequest = Boolean(action.nonce) && !usable;

  const linked = await linkedAccountFor(db, telegramUserId);
  if (linked.kind === "error") {
    console.error("[telegram-login] lectura de vínculo falló:", redactId(String(telegramUserId)));
    await answerRemovingKeyboard(deps, chatId, telegramUserId, locale, copy.failure);
    return "failed";
  }

  if (linked.kind === "linked") {
    return grantAccess(deps, {
      chatId,
      chat,
      locale,
      grant: { userId: linked.userId, telegramUserId, phoneE164: linked.phoneE164 },
      requestId: usable?.id ?? null,
      staleRequest,
      defaultLead: null,
      removeKeyboard: chat.keyboardOpen,
    });
  }

  // Sin vínculo: pedir el número una vez. La solicitud pendiente queda en el
  // chat hasta que llegue el contacto (que no trae payload).
  const pendingRequestId = action.nonce
    ? usable?.status === "pending"
      ? usable.id
      : null
    : chat.pendingRequestId;
  const recentlyPrompted =
    chat.contactPromptedAt !== null &&
    now - chat.contactPromptedAt < PROMPT_REPEAT_MS &&
    pendingRequestId === chat.pendingRequestId;
  const prompt = recentlyPrompted ? copy.promptShort : copy.promptLong;
  await sendPlain(
    send,
    chatId,
    staleRequest ? `${copy.requestExpired}\n\n${prompt}` : prompt,
    shareKeyboard(copy),
  );
  await saveChat(db, telegramUserId, {
    locale,
    pending_request_id: pendingRequestId,
    contact_prompted_at: new Date(now).toISOString(),
    reply_keyboard_open: true,
  });
  return "prompted";
}

async function handleOwnContact(
  deps: LoginHandlerDeps,
  action: Extract<LoginUpdateAction, { kind: "own_contact" }>,
  chat: ChatState,
): Promise<LoginHandlerOutcome> {
  const { db, config } = deps;
  const { chatId, telegramUserId, phoneE164 } = action;
  const locale: LoginLocale = chat.locale ?? "es";
  const copy = loginBotCopy(locale);

  const identity = await telegramIdentityStatus(db, phoneE164, telegramUserId);
  if (identity === "error") {
    console.error(
      "[telegram-login] estado de identidad falló:",
      redactPhone(phoneE164),
      redactId(String(telegramUserId)),
    );
    await answerRemovingKeyboard(deps, chatId, telegramUserId, locale, copy.failure);
    return "failed";
  }

  const smsOnly = async () => {
    // La pestaña que esperaba deja de esperar y muestra que use el SMS.
    if (chat.pendingRequestId) {
      await cancelLoginRequest(db, { requestId: chat.pendingRequestId });
    }
    await answerRemovingKeyboard(deps, chatId, telegramUserId, locale, copy.smsOnly, {
      pending_request_id: null,
    });
    return "sms_only" as const;
  };

  if (!canIssueFor(identity, config)) return smsOnly();

  const linked = await linkTelegramAccountForContact(db, config, phoneE164, telegramUserId);
  if (linked.status === "denied") return smsOnly();
  if (linked.status === "error") {
    console.error(
      "[telegram-login] vínculo falló:",
      redactPhone(phoneE164),
      redactId(String(telegramUserId)),
    );
    await answerRemovingKeyboard(deps, chatId, telegramUserId, locale, copy.failure);
    return "failed";
  }

  return grantAccess(deps, {
    chatId,
    chat,
    locale,
    grant: linked.grant,
    requestId: chat.pendingRequestId,
    staleRequest: false,
    defaultLead: copy.contactConfirmed,
    // El teclado de «Compartir mi número» sigue ahí: se quita siempre.
    removeKeyboard: true,
  });
}

export async function handleLoginUpdate(
  update: unknown,
  deps: LoginHandlerDeps,
): Promise<LoginHandlerOutcome> {
  const action = classifyLoginUpdate(update);
  if (action.kind === "ignore") return "ignored";

  const chat = await readChat(deps.db, action.telegramUserId);

  if (action.kind === "message") return handleMessage(deps, action, chat);

  if (action.kind === "foreign_contact" || action.kind === "invalid_phone") {
    const locale = chat.locale ?? "es";
    const copy = loginBotCopy(locale);
    await sendPlain(
      deps.send,
      action.chatId,
      action.kind === "foreign_contact" ? copy.foreign : copy.invalidPhone,
      shareKeyboard(copy),
    );
    await saveChat(deps.db, action.telegramUserId, { locale, reply_keyboard_open: true });
    return action.kind;
  }

  return handleOwnContact(deps, action, chat);
}
