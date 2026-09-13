// lib/auth/telegram-login/identity.ts — Qué cuenta de Telegram puede entrar a
// qué cuenta de La Polla (migración 115, secciones 8-10).
//
// Telegram prueba que el número está asociado HOY a esa cuenta de Telegram, no
// que esa persona tenga hoy la SIM. Con un número reciclado, el dueño anterior
// puede conservarlo en Telegram mientras el dueño nuevo ya creó su cuenta de La
// Polla por SMS. Por eso:
//   - Teléfono sin cuenta → Telegram crea la cuenta y queda vinculado.
//   - Cuenta vinculada → solo entra la misma cuenta de Telegram.
//   - Cuenta existente sin vínculo → solo SMS, salvo que el dueño active
//     TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS (acepta ese riesgo). En ese caso la
//     primera cuenta de Telegram que entra queda vinculada.
//
// v2: el vínculo se crea cuando el bot recibe el contacto (antes de que el
// navegador entre), así la siguiente vez el bot ya no pide el número. La
// sesión vuelve a exigir el vínculo al consumir (telegramGrantAuthorizer).

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAccountForVerifiedPhone } from "@/lib/auth/phone-session";
import type { TelegramLoginConfig } from "./config";
import type { LoginGrant } from "./requests";

export type IdentityStatus = "new" | "linked" | "linked_other" | "unlinked";

/** Estado del teléfono para la cuenta de Telegram que comparte su contacto. */
export async function telegramIdentityStatus(
  db: SupabaseClient,
  phoneE164: string,
  telegramUserId: number,
): Promise<IdentityStatus | "error"> {
  const { data, error } = await db.rpc("telegram_login_identity_status", {
    p_phone_e164: phoneE164,
    p_telegram_user_id: telegramUserId,
  });
  if (error) return "error";
  return data === "new" || data === "linked" || data === "linked_other" || data === "unlinked"
    ? data
    : "error";
}

/** ¿Esta cuenta de Telegram puede entrar a la cuenta de este teléfono? */
export function canIssueFor(
  status: IdentityStatus,
  config: Pick<TelegramLoginConfig, "allowExistingAccounts">,
): boolean {
  if (status === "new" || status === "linked") return true;
  if (status === "unlinked") return config.allowExistingAccounts;
  return false;
}

export type LinkForContactResult =
  | { status: "ok"; grant: LoginGrant }
  | { status: "denied" }
  | { status: "error" };

/**
 * Contacto propio ya validado: busca o crea la cuenta del teléfono y la vincula
 * a esta cuenta de Telegram si las reglas lo permiten (telegram_login_authorize
 * decide y vincula de forma atómica; la primera cuenta de Telegram gana).
 */
export async function linkTelegramAccountForContact(
  db: SupabaseClient,
  config: Pick<TelegramLoginConfig, "allowExistingAccounts">,
  phoneE164: string,
  telegramUserId: number,
): Promise<LinkForContactResult> {
  const account = await resolveAccountForVerifiedPhone(phoneE164, "telegram-login", db);
  if (!account.ok) return { status: "error" };
  const { data, error } = await db.rpc("telegram_login_authorize", {
    p_user_id: account.authUserId,
    p_telegram_user_id: telegramUserId,
    p_allow_first_link: account.created || config.allowExistingAccounts,
  });
  if (error) {
    console.error("[telegram-login] autorización falló:", error.code);
    return { status: "error" };
  }
  if (data !== true) return { status: "denied" };
  return {
    status: "ok",
    grant: { userId: account.authUserId, telegramUserId, phoneE164 },
  };
}

/**
 * Decisión que abre (o no) la sesión al consumir una solicitud o un enlace.
 * El teléfono tiene que resolver a la MISMA cuenta aprobada, y esa cuenta
 * tiene que seguir aceptando la cuenta de Telegram que aprobó (sin crear
 * vínculos nuevos a esta altura). Se pasa como `authorize` a
 * startSessionForVerifiedPhone.
 */
export function telegramGrantAuthorizer(db: SupabaseClient, grant: LoginGrant) {
  return async ({ authUserId, created }: { authUserId: string; created: boolean }) => {
    if (created || authUserId !== grant.userId) return false;
    const { data, error } = await db.rpc("telegram_login_authorize", {
      p_user_id: authUserId,
      p_telegram_user_id: grant.telegramUserId,
      p_allow_first_link: false,
    });
    if (error) {
      console.error("[telegram-login] autorización falló:", error.code);
      return false;
    }
    return data === true;
  };
}
