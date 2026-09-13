// lib/auth/telegram-login/consume.ts — Canje del código o del enlace. El
// servidor recalcula el HMAC y la base decide en una sola transacción
// (migración 115): un solo uso, 5 intentos por token, vencimiento a 10 min.
//
// Un canje correcto devuelve también la cuenta de Telegram que pidió el token:
// la sesión solo se abre si esa cuenta está autorizada (identity.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramLoginConfig } from "./config";
import {
  hashLinkToken,
  hashLoginCode,
  LINK_TOKEN_RE,
  LOGIN_CODE_RE,
} from "./crypto";

type Row = Record<string, unknown> | null | undefined;

function firstRow(data: unknown): Row {
  return (Array.isArray(data) ? data[0] : data) as Row;
}

function telegramUserIdOf(row: Row): number | null {
  const raw = row?.telegram_user_id;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export type ConsumeCodeResult =
  | { status: "ok"; telegramUserId: number }
  | { status: "invalid" | "error" };

export async function consumeLoginCode(
  db: SupabaseClient,
  config: TelegramLoginConfig,
  phoneE164: string,
  code: string,
): Promise<ConsumeCodeResult> {
  if (!LOGIN_CODE_RE.test(code)) return { status: "invalid" };
  const { data, error } = await db.rpc("telegram_login_redeem_code", {
    p_phone_e164: phoneE164,
    p_code_hash: hashLoginCode(config.botToken, phoneE164, code),
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  const telegramUserId = telegramUserIdOf(row);
  if (row?.status === "ok" && telegramUserId) {
    return { status: "ok", telegramUserId };
  }
  return { status: "invalid" };
}

export type ConsumeLinkResult =
  | { status: "ok"; phoneE164: string; telegramUserId: number }
  | { status: "used" | "expired" | "invalid" | "error" };

export async function consumeLoginLink(
  db: SupabaseClient,
  config: TelegramLoginConfig,
  token: string,
): Promise<ConsumeLinkResult> {
  if (!LINK_TOKEN_RE.test(token)) return { status: "invalid" };
  const { data, error } = await db.rpc("telegram_login_redeem_link", {
    p_link_token_hash: hashLinkToken(config.botToken, token),
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  const telegramUserId = telegramUserIdOf(row);
  if (row?.status === "ok" && typeof row.phone_e164 === "string" && telegramUserId) {
    return { status: "ok", phoneE164: row.phone_e164, telegramUserId };
  }
  if (row?.status === "used" || row?.status === "expired") {
    return { status: row.status };
  }
  return { status: "invalid" };
}

export type PeekLinkResult =
  | { status: "ok"; phoneE164: string }
  | { status: "used" | "expired" | "invalid" | "error" };

/** Estado del enlace SIN canjearlo: el GET solo muestra a qué número entraría. */
export async function peekLoginLink(
  db: SupabaseClient,
  config: TelegramLoginConfig,
  token: string,
): Promise<PeekLinkResult> {
  if (!LINK_TOKEN_RE.test(token)) return { status: "invalid" };
  const { data, error } = await db.rpc("telegram_login_peek_link", {
    p_link_token_hash: hashLinkToken(config.botToken, token),
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  if (row?.status === "ok" && typeof row.phone_e164 === "string") {
    return { status: "ok", phoneE164: row.phone_e164 };
  }
  if (row?.status === "used" || row?.status === "expired") {
    return { status: row.status };
  }
  return { status: "invalid" };
}
