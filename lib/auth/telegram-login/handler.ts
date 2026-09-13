// lib/auth/telegram-login/handler.ts — Lógica del webhook del bot de login.
// Vive fuera de app/api/telegram/login/route.ts porque un route.ts solo puede
// exportar handlers HTTP, y así se prueba con dependencias falsas.
//
// Un número sin cuenta recibe su código y, como en el login por SMS, la cuenta
// se crea al verificar. Una cuenta que ya existe solo acepta la cuenta de
// Telegram vinculada (identity.ts): a cualquier otra, el bot le pide usar el
// SMS sin emitir nada. Eso le confirma a quien tiene el número en Telegram que
// ese número tiene cuenta; se acepta porque solo puede consultar su propio número.

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactId, redactPhone } from "@/lib/log";
import type { TelegramLoginConfig } from "./config";
import type { BotApiCall } from "./bot-api";
import {
  generateLinkToken,
  generateLoginCode,
  hashLinkToken,
  hashLoginCode,
  LOGIN_TOKEN_TTL_SECONDS,
} from "./crypto";
import { canIssueFor, telegramIdentityStatus } from "./identity";
import { loginLinkUrl } from "./links";
import { loginBotCopy, maskPhone } from "./messages";
import { classifyLoginUpdate, type LoginLocale } from "./update";

export interface LoginHandlerDeps {
  config: TelegramLoginConfig;
  db: SupabaseClient;
  send: BotApiCall;
  env?: Record<string, string | undefined>;
}

export type LoginHandlerOutcome =
  | "ignored"
  | "prompted"
  | "foreign_contact"
  | "invalid_phone"
  | "issued"
  | "sms_only"
  | "rate_limited"
  | "failed";

function shareKeyboard(locale: LoginLocale) {
  return {
    keyboard: [[{ text: loginBotCopy(locale).shareButton, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
    is_persistent: false,
  };
}

async function readChatLocale(
  db: SupabaseClient,
  telegramUserId: number,
): Promise<LoginLocale> {
  const { data, error } = await db
    .from("telegram_login_chats")
    .select("locale")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) return "es";
  return data?.locale === "en" ? "en" : "es";
}

export async function handleLoginUpdate(
  update: unknown,
  deps: LoginHandlerDeps,
): Promise<LoginHandlerOutcome> {
  const action = classifyLoginUpdate(update);
  if (action.kind === "ignore") return "ignored";

  const { db, send, config } = deps;

  if (action.kind === "prompt") {
    let locale: LoginLocale;
    if (action.locale) {
      locale = action.locale;
      const { error } = await db.from("telegram_login_chats").upsert(
        {
          telegram_user_id: action.telegramUserId,
          locale,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_user_id" },
      );
      if (error) {
        console.warn("[telegram-login] no se guardó el idioma:", error.code);
      }
    } else {
      locale = await readChatLocale(db, action.telegramUserId);
    }
    await send("sendMessage", {
      chat_id: action.chatId,
      text: loginBotCopy(locale).prompt,
      parse_mode: "HTML",
      reply_markup: shareKeyboard(locale),
    });
    return "prompted";
  }

  const locale = await readChatLocale(db, action.telegramUserId);
  const copy = loginBotCopy(locale);

  if (action.kind === "foreign_contact" || action.kind === "invalid_phone") {
    await send("sendMessage", {
      chat_id: action.chatId,
      text: action.kind === "foreign_contact" ? copy.foreign : copy.invalidPhone,
      parse_mode: "HTML",
      reply_markup: shareKeyboard(locale),
    });
    return action.kind;
  }

  // own_contact. Antes de emitir: ¿esta cuenta de Telegram puede entrar a la
  // cuenta de ese teléfono? (identity.ts). Si no, ni código ni enlace.
  const identity = await telegramIdentityStatus(db, action.phoneE164, action.telegramUserId);
  if (identity === "error" || !canIssueFor(identity, config)) {
    if (identity === "error") {
      console.error(
        "[telegram-login] estado de identidad falló:",
        redactPhone(action.phoneE164),
        redactId(String(action.telegramUserId)),
      );
    }
    await send("sendMessage", {
      chat_id: action.chatId,
      text: identity === "error" ? copy.failure : copy.smsOnly,
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true },
    });
    return identity === "error" ? "failed" : "sms_only";
  }

  const code = generateLoginCode();
  const linkToken = generateLinkToken();
  const { data: status, error } = await db.rpc("telegram_login_issue", {
    p_phone_e164: action.phoneE164,
    p_telegram_user_id: action.telegramUserId,
    p_code_hash: hashLoginCode(config.botToken, action.phoneE164, code),
    p_link_token_hash: hashLinkToken(config.botToken, linkToken),
    p_ttl_seconds: LOGIN_TOKEN_TTL_SECONDS,
  });

  if (error || (status !== "ok" && status !== "rate_limited")) {
    console.error(
      "[telegram-login] emisión falló:",
      redactPhone(action.phoneE164),
      redactId(String(action.telegramUserId)),
      error?.code ?? status,
    );
    await send("sendMessage", {
      chat_id: action.chatId,
      text: copy.failure,
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true },
    });
    return "failed";
  }

  if (status === "rate_limited") {
    await send("sendMessage", {
      chat_id: action.chatId,
      text: copy.rateLimited,
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true },
    });
    return "rate_limited";
  }

  await send("sendMessage", {
    chat_id: action.chatId,
    text: copy.code(code, maskPhone(action.phoneE164)),
    parse_mode: "HTML",
    // Sin vista previa y sin reenvío/guardado: el código es para esta persona.
    link_preview_options: { is_disabled: true },
    protect_content: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: copy.linkButton, url: loginLinkUrl(locale, linkToken, deps.env) }],
      ],
    },
  });
  return "issued";
}
