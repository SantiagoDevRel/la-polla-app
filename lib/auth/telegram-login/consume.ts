// lib/auth/telegram-login/consume.ts — Canje del código o del enlace. El
// servidor recalcula el HMAC y la base decide en una sola transacción
// (migración 115): un solo uso, 5 intentos por token, vencimiento a 10 min.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramLoginConfig } from "./config";
import {
  hashLinkToken,
  hashLoginCode,
  LINK_TOKEN_RE,
  LOGIN_CODE_RE,
} from "./crypto";

export type ConsumeCodeResult = "ok" | "invalid" | "error";

export async function consumeLoginCode(
  db: SupabaseClient,
  config: TelegramLoginConfig,
  phoneE164: string,
  code: string,
): Promise<ConsumeCodeResult> {
  if (!LOGIN_CODE_RE.test(code)) return "invalid";
  const { data, error } = await db.rpc("telegram_login_consume_code", {
    p_phone_e164: phoneE164,
    p_code_hash: hashLoginCode(config.botToken, phoneE164, code),
  });
  if (error) return "error";
  return data === "ok" ? "ok" : "invalid";
}

export type ConsumeLinkResult =
  | { status: "ok"; phoneE164: string }
  | { status: "used" | "expired" | "invalid" | "error" };

export async function consumeLoginLink(
  db: SupabaseClient,
  config: TelegramLoginConfig,
  token: string,
): Promise<ConsumeLinkResult> {
  if (!LINK_TOKEN_RE.test(token)) return { status: "invalid" };
  const { data, error } = await db.rpc("telegram_login_consume_link", {
    p_link_token_hash: hashLinkToken(config.botToken, token),
  });
  if (error) return { status: "error" };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { status?: string; phone_e164?: string | null }
    | null
    | undefined;
  if (row?.status === "ok" && typeof row.phone_e164 === "string") {
    return { status: "ok", phoneE164: row.phone_e164 };
  }
  if (row?.status === "used" || row?.status === "expired") {
    return { status: row.status };
  }
  return { status: "invalid" };
}
