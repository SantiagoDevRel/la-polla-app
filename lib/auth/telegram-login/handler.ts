// lib/auth/telegram-login/handler.ts — Lógica del webhook del bot de login (v2).
// Vive fuera de app/api/telegram/login/route.ts porque un route.ts solo puede
// exportar handlers HTTP, y así se prueba con dependencias falsas.
//
// Flujo:
//   - Cuenta de Telegram YA vinculada: no se pide el número. Se manda un
//     enlace de un solo uso (5 min). Con /start <nonce> el enlace queda en la
//     fila de esa solicitud, así abierto en el mismo navegador entra sin
//     confirmar.
//   - Sin vínculo: se pide el número UNA vez (botón de mini app pegado al
//     mensaje + teclado persistente de respaldo). Al llegar
//     el contacto propio se busca o crea la cuenta, se vincula si las reglas lo
//     permiten (identity.ts) y se manda el enlace (ligado a la solicitud
//     pendiente si la hay).
//   - La sesión SOLO sale del enlace, que llega a este chat. Aprobar una
//     solicitud no le da nada al navegador que la creó: si alguien hace llegar
//     su deep link a otra persona, esa persona recibe SU enlace y nadie más
//     entra (phishing tipo device code). Vincular una cuenta existente desde un
//     nonce ajeno tampoco le da nada a quien lo creó.
//   - Nunca se mandan códigos. allowed_updates sigue siendo ["message"]: nada
//     depende de callback_query.

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactId, redactPhone } from "@/lib/log";
import type { TelegramLoginConfig } from "./config";
import type { BotApiCall } from "./bot-api";
import { generateLinkToken } from "./crypto";
import { canIssueFor, linkTelegramAccountForContact, telegramIdentityStatus } from "./identity";
import { loginLinkOrigin, loginLinkUrl } from "./links";
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
  /**
   * Bot de jugadores (lib/telegram-player): cuando el contacto llega SIN una
   * solicitud del navegador, la persona vino a usar el bot, no a entrar a la
   * web. En vez de un enlace suelto, el bot sigue con su bienvenida (perfil y
   * menú). El vínculo ya quedó creado con las mismas reglas de identity.ts.
   */
  onLinked?: (input: { chatId: number; telegramUserId: number; grant: LoginGrant; locale: LoginLocale }) => Promise<LoginHandlerOutcome>;
  /** Presentación antes de pedir el número (solo sin solicitud del navegador). */
  promptLead?: string;
}

export type LoginHandlerOutcome =
  | "ignored"
  | "approved"
  | "linked"
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

/** Mini app que abre la ventana nativa de Telegram para compartir el número. */
export const SHARE_PHONE_PAGE_PATH = "/telegram/numero.html";

/**
 * URL de la mini app, o null si el origen no es https (Telegram rechaza el
 * mensaje entero con un botón web_app sin https, p. ej. localhost).
 */
export function sharePhonePageUrl(
  locale: LoginLocale,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const origin = loginLinkOrigin(locale, env);
  if (!origin.startsWith("https://")) return null;
  return `${origin}${SHARE_PHONE_PAGE_PATH}${locale === "en" ? "?lang=en" : ""}`;
}

/** Botón pegado al mensaje: a diferencia del teclado, se ve en todos los clientes. */
function sharePhoneButton(copy: Copy, url: string) {
  return { inline_keyboard: [[{ text: copy.shareButton, web_app: { url } }]] };
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
 * La cuenta ya se sabe (vinculada o recién vinculada): manda el enlace. Si hay
 * una solicitud del navegador usable, el enlace queda en su fila (así el mismo
 * navegador entra sin confirmar); si no, un enlace suelto.
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
      // Un solo camino: el botón del enlace. La pestaña que pidió no entra por
      // la aprobación; entra solo si el enlace se abre en ese mismo navegador.
      const approvedCopy = loginBotCopy(approved.locale);
      const sent = await deliverLink(send, {
        chatId,
        copy: approvedCopy,
        lead: input.defaultLead,
        linkText: approvedCopy.linkOnly,
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

  // (2026-09-15) Pedido del dueño: todo en español. El idioma de la app de
  // Telegram ya no decide; solo una solicitud de chickenpicks.app (la del nonce
  // o la que sigue pendiente en el chat) mantiene el inglés.
  const locale: LoginLocale = request?.locale ?? (chat.pendingRequestId ? chat.locale : null) ?? "es";
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
  // El bot de jugadores presenta el servicio a quien llega por /start sin venir
  // de la web: en el mismo mensaje, para que el botón no quede debajo de otro.
  const lead = !recentlyPrompted && !action.nonce && deps.promptLead ? deps.promptLead : null;
  const stale = staleRequest ? copy.requestExpired : null;
  const pageUrl = sharePhonePageUrl(locale, deps.env);
  let keyboardSent = false;
  if (!pageUrl) {
    keyboardSent = await sendPlain(send, chatId, [stale, lead, prompt].filter(Boolean).join("\n\n"), shareKeyboard(copy));
  } else if (recentlyPrompted) {
    // El teclado de respaldo ya se mandó hace menos de dos minutos.
    await sendPlain(send, chatId, [stale, copy.promptTap].filter(Boolean).join("\n\n"), sharePhoneButton(copy, pageUrl));
  } else {
    // (2026-09-15) «Toca Compartir mi número y no encuentro ningún botón»: el
    // teclado vive escondido tras un ícono en Telegram Web/Desktop. El botón
    // va en el ÚLTIMO mensaje, pegado a él; el teclado queda en el primero.
    keyboardSent = await sendPlain(send, chatId, [stale, lead, copy.promptIntro].filter(Boolean).join("\n\n"), shareKeyboard(copy));
    await sendPlain(send, chatId, copy.promptTap, sharePhoneButton(copy, pageUrl));
  }
  await saveChat(db, telegramUserId, {
    locale,
    pending_request_id: pendingRequestId,
    contact_prompted_at: new Date(now).toISOString(),
    ...(keyboardSent ? { reply_keyboard_open: true } : {}),
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

  if (!chat.pendingRequestId && deps.onLinked) {
    return deps.onLinked({ chatId, telegramUserId, grant: linked.grant, locale });
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
    const text = action.kind === "foreign_contact" ? copy.foreign : copy.invalidPhone;
    const pageUrl = sharePhonePageUrl(locale, deps.env);
    // Quien mandó un contacto ajeno suele venir del clip de adjuntos: el botón
    // pegado al mensaje le muestra el camino correcto.
    const sent = await sendPlain(deps.send, action.chatId, text, pageUrl ? sharePhoneButton(copy, pageUrl) : shareKeyboard(copy));
    await saveChat(deps.db, action.telegramUserId, { locale, ...(sent && !pageUrl ? { reply_keyboard_open: true } : {}) });
    return action.kind;
  }

  return handleOwnContact(deps, action, chat);
}
