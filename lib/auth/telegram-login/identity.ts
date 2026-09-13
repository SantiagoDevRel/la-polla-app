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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramLoginConfig } from "./config";

export type IdentityStatus = "new" | "linked" | "linked_other" | "unlinked";

/** Estado del teléfono para la cuenta de Telegram que pide un código. */
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

/** ¿El bot puede emitir un código a esta cuenta de Telegram para este teléfono? */
export function canIssueFor(
  status: IdentityStatus,
  config: Pick<TelegramLoginConfig, "allowExistingAccounts">,
): boolean {
  if (status === "new" || status === "linked") return true;
  if (status === "unlinked") return config.allowExistingAccounts;
  return false;
}

/**
 * Decisión que abre (o no) la sesión, después de resolver o crear la cuenta.
 * Se pasa como `authorize` a startSessionForVerifiedPhone.
 */
export function telegramSessionAuthorizer(
  db: SupabaseClient,
  config: Pick<TelegramLoginConfig, "allowExistingAccounts">,
  telegramUserId: number,
) {
  return async ({ authUserId, created }: { authUserId: string; created: boolean }) => {
    const { data, error } = await db.rpc("telegram_login_authorize", {
      p_user_id: authUserId,
      p_telegram_user_id: telegramUserId,
      p_allow_first_link: created || config.allowExistingAccounts,
    });
    if (error) {
      console.error("[telegram-login] autorización falló:", error.code);
      return false;
    }
    return data === true;
  };
}
