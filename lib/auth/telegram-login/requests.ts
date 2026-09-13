// lib/auth/telegram-login/requests.ts — Envoltorios de las RPC de la
// migración 119 (solicitud del navegador + enlace de un solo uso). La base
// decide todo estado en una transacción; aquí solo se calculan hashes y se
// normalizan las respuestas. Sin select("*"): todo pasa por funciones.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDeviceLabel } from "@/lib/auth/user-agent";
import type { TelegramLoginConfig } from "./config";
import { hashLinkToken, LINK_TOKEN_RE, NONCE_RE, sha256Hex } from "./crypto";
import type { LoginLocale } from "./update";

type Row = Record<string, unknown> | null | undefined;

function firstRow(data: unknown): Row {
  return (Array.isArray(data) ? data[0] : data) as Row;
}

function positiveInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function localeOf(raw: unknown): LoginLocale {
  return raw === "en" ? "en" : "es";
}

/** Cuenta de La Polla a la que se va a entrar. */
export interface LoginGrant {
  userId: string;
  telegramUserId: number;
  phoneE164: string;
}

function grantOf(row: Row): LoginGrant | null {
  const userId = str(row?.user_id);
  const telegramUserId = positiveInt(row?.telegram_user_id);
  const phoneE164 = str(row?.phone_e164);
  if (!userId || !telegramUserId || !phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    return null;
  }
  return { userId, telegramUserId, phoneE164 };
}

/**
 * "Windows en Bogotá, CO": se guarda con la solicitud para que la persona
 * reconozca en Telegram desde dónde se pidió el ingreso. Sin IP ni navegador
 * exacto: el mismo nivel de detalle que /avisos.
 */
export function requesterLabel(
  headers: { get(name: string): string | null },
  locale: LoginLocale,
): string {
  let device = parseDeviceLabel(headers.get("user-agent"));
  if (locale === "en") {
    if (device === "dispositivo desconocido") device = "an unknown device";
    else if (device === "otro dispositivo") device = "another device";
  }
  let city: string | null = null;
  const cityRaw = headers.get("x-vercel-ip-city");
  if (cityRaw) {
    try {
      city = decodeURIComponent(cityRaw);
    } catch {
      city = cityRaw;
    }
  }
  const country = headers.get("x-vercel-ip-country");
  const where = locale === "en" ? "in" : "en";
  const place = city && country ? ` ${where} ${city}, ${country}` : country ? ` (${country})` : "";
  return `${device}${place}`.slice(0, 80);
}

// ── Navegador ────────────────────────────────────────────────────────────
export type CreateRequestResult =
  | { status: "ok"; expiresAt: string }
  | { status: "rate_limited" | "error" };

export async function createLoginRequest(
  db: SupabaseClient,
  input: {
    nonce: string;
    browserSecret: string;
    locale: LoginLocale;
    ip: string | null;
    label: string | null;
  },
): Promise<CreateRequestResult> {
  const { data, error } = await db.rpc("telegram_login_request_create", {
    p_nonce_hash: sha256Hex(input.nonce),
    p_browser_hash: sha256Hex(input.browserSecret),
    p_locale: input.locale,
    p_requester_ip: input.ip,
    p_requester_label: input.label,
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  if (row?.status === "ok" && str(row.expires_at)) {
    return { status: "ok", expiresAt: row.expires_at as string };
  }
  if (row?.status === "rate_limited") return { status: "rate_limited" };
  return { status: "error" };
}

export const REQUEST_STATUSES = [
  "invalid",
  "pending",
  "approved",
  "consumed",
  "expired",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

function requestStatusOf(raw: unknown): RequestStatus | null {
  return (REQUEST_STATUSES as readonly unknown[]).includes(raw) ? (raw as RequestStatus) : null;
}

export async function getLoginRequestStatus(
  db: SupabaseClient,
  browserHash: string,
): Promise<{ status: RequestStatus; expiresAt: string | null } | { status: "error" }> {
  const { data, error } = await db.rpc("telegram_login_request_status", {
    p_browser_hash: browserHash,
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  const status = requestStatusOf(row?.status);
  if (!status) return { status: "error" };
  return { status, expiresAt: str(row?.expires_at) };
}

export type ConsumeRequestResult =
  | { status: "ok"; grant: LoginGrant; locale: LoginLocale; label: string | null }
  | { status: Exclude<RequestStatus, "approved"> | "error" };

export async function consumeLoginRequest(
  db: SupabaseClient,
  browserHash: string,
): Promise<ConsumeRequestResult> {
  const { data, error } = await db.rpc("telegram_login_request_consume", {
    p_browser_hash: browserHash,
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  if (row?.status === "ok") {
    const grant = grantOf(row);
    return grant
      ? { status: "ok", grant, locale: localeOf(row.locale), label: str(row.requester_label) }
      : { status: "error" };
  }
  const status = requestStatusOf(row?.status);
  return status && status !== "approved" ? { status } : { status: "error" };
}

export async function cancelLoginRequest(
  db: SupabaseClient,
  by: { browserHash: string } | { requestId: string },
): Promise<boolean> {
  const { data, error } = await db.rpc(
    "telegram_login_request_cancel",
    "browserHash" in by ? { p_browser_hash: by.browserHash } : { p_request_id: by.requestId },
  );
  return !error && data === true;
}

// ── Bot ──────────────────────────────────────────────────────────────────
export interface FoundRequest {
  id: string;
  status: Exclude<RequestStatus, "invalid">;
  telegramUserId: number | null;
  locale: LoginLocale;
  label: string | null;
}

export async function findLoginRequestByNonce(
  db: SupabaseClient,
  nonce: string,
): Promise<FoundRequest | null | "error"> {
  if (!NONCE_RE.test(nonce)) return null;
  const { data, error } = await db.rpc("telegram_login_request_find", {
    p_nonce_hash: sha256Hex(nonce),
  });
  if (error) return "error";
  const row = firstRow(data);
  const id = str(row?.request_id);
  const status = requestStatusOf(row?.status);
  if (!id || !status || status === "invalid") return null;
  return {
    id,
    status,
    telegramUserId: positiveInt(row?.telegram_user_id),
    locale: localeOf(row?.locale),
    label: str(row?.requester_label),
  };
}

export type LinkedAccount =
  | { kind: "linked"; userId: string; phoneE164: string }
  | { kind: "none" | "ambiguous" | "error" };

/** Cuenta de La Polla vinculada a esta cuenta de Telegram (115 + 119). */
export async function linkedAccountFor(
  db: SupabaseClient,
  telegramUserId: number,
): Promise<LinkedAccount> {
  const { data, error } = await db.rpc("telegram_login_linked_accounts", {
    p_telegram_user_id: telegramUserId,
  });
  if (error) return { kind: "error" };
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  if (rows.length === 0) return { kind: "none" };
  if (rows.length > 1) return { kind: "ambiguous" };
  const userId = str(rows[0]?.user_id);
  const phoneE164 = str(rows[0]?.phone_e164);
  // Sin teléfono utilizable no se puede abrir sesión: se pide el número.
  if (!userId || !phoneE164) return { kind: "ambiguous" };
  return { kind: "linked", userId, phoneE164 };
}

export type ApproveResult =
  | { status: "ok"; expiresAt: string; locale: LoginLocale; label: string | null }
  | { status: "invalid" | "expired" | "unavailable" | "not_linked" | "rate_limited" | "error" };

export async function approveLoginRequest(
  db: SupabaseClient,
  config: Pick<TelegramLoginConfig, "botToken">,
  requestId: string,
  grant: LoginGrant,
  linkToken: string,
): Promise<ApproveResult> {
  const { data, error } = await db.rpc("telegram_login_request_approve", {
    p_request_id: requestId,
    p_telegram_user_id: grant.telegramUserId,
    p_user_id: grant.userId,
    p_phone_e164: grant.phoneE164,
    p_link_token_hash: hashLinkToken(config.botToken, linkToken),
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  if (row?.status === "ok" && str(row.expires_at)) {
    return {
      status: "ok",
      expiresAt: row.expires_at as string,
      locale: localeOf(row.locale),
      label: str(row.requester_label),
    };
  }
  const s = row?.status;
  if (s === "invalid" || s === "expired" || s === "unavailable" || s === "not_linked" || s === "rate_limited") {
    return { status: s };
  }
  return { status: "error" };
}

export async function issueBotLink(
  db: SupabaseClient,
  config: Pick<TelegramLoginConfig, "botToken">,
  grant: LoginGrant,
  linkToken: string,
  locale: LoginLocale,
): Promise<"ok" | "not_linked" | "rate_limited" | "error"> {
  const { data, error } = await db.rpc("telegram_login_link_issue", {
    p_telegram_user_id: grant.telegramUserId,
    p_user_id: grant.userId,
    p_phone_e164: grant.phoneE164,
    p_link_token_hash: hashLinkToken(config.botToken, linkToken),
    p_locale: locale,
  });
  if (error) return "error";
  const s = firstRow(data)?.status;
  return s === "ok" || s === "not_linked" || s === "rate_limited" ? s : "error";
}

// ── Enlace ───────────────────────────────────────────────────────────────
export type PeekLinkResult =
  | { status: "ok"; phoneE164: string; sameBrowser: boolean }
  | { status: "used" | "expired" | "invalid" | "error" };

/** Estado del enlace SIN canjearlo. */
export async function peekLoginLink(
  db: SupabaseClient,
  config: Pick<TelegramLoginConfig, "botToken">,
  token: string,
  browserHash: string | null,
): Promise<PeekLinkResult> {
  if (!LINK_TOKEN_RE.test(token)) return { status: "invalid" };
  const { data, error } = await db.rpc("telegram_login_link_peek", {
    p_link_token_hash: hashLinkToken(config.botToken, token),
    p_browser_hash: browserHash,
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  if (row?.status === "ok" && str(row.phone_e164)) {
    return { status: "ok", phoneE164: row.phone_e164 as string, sameBrowser: row.same_browser === true };
  }
  if (row?.status === "used" || row?.status === "expired") return { status: row.status };
  return { status: "invalid" };
}

export type ConsumeLinkResult =
  | { status: "ok"; grant: LoginGrant; sameBrowser: boolean }
  | { status: "used" | "expired" | "invalid" | "error" };

export async function consumeLoginLink(
  db: SupabaseClient,
  config: Pick<TelegramLoginConfig, "botToken">,
  token: string,
  browserHash: string | null,
): Promise<ConsumeLinkResult> {
  if (!LINK_TOKEN_RE.test(token)) return { status: "invalid" };
  const { data, error } = await db.rpc("telegram_login_link_consume", {
    p_link_token_hash: hashLinkToken(config.botToken, token),
    p_browser_hash: browserHash,
  });
  if (error) return { status: "error" };
  const row = firstRow(data);
  if (row?.status === "ok") {
    const grant = grantOf(row);
    return grant ? { status: "ok", grant, sameBrowser: row.same_browser === true } : { status: "error" };
  }
  if (row?.status === "used" || row?.status === "expired") return { status: row.status };
  return { status: "invalid" };
}
