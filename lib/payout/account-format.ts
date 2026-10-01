// lib/payout/account-format.ts — Formato de la cuenta de cobro por método.
// Lo usan el editor de /perfil (filtra lo que se escribe) y PATCH
// /api/users/me (rechaza lo que no cumpla). Una sola regla para los dos.
//
//   nequi        → solo dígitos (celular)
//   bancolombia  → solo dígitos (número de cuenta)
//   llave        → letras, dígitos y @ (llave Bre-B, ej: @juan123)
//   otro         → banco + cuenta, ambos alfanuméricos. Se guardan juntos
//                  en default_payout_account como «Banco · cuenta» para que
//                  todas las vistas de pago (admin, ganadores) lo muestren
//                  completo sin columnas nuevas.

export const PAYOUT_METHODS = ["nequi", "bancolombia", "llave", "otro"] as const;
export type PayoutMethodId = (typeof PAYOUT_METHODS)[number];

export const OTHER_BANK_SEPARATOR = " · ";

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function sanitizeLlave(value: string): string {
  return value.replace(/[^A-Za-z0-9ñÑ@]/g, "");
}

/** Nombre del banco: letras (con tildes), dígitos y espacios. */
export function sanitizeBankName(value: string): string {
  return value.replace(/[^\p{L}\p{N} ]/gu, "").replace(/ {2,}/g, " ");
}

/** Número de cuenta de otro banco: letras y dígitos. */
export function sanitizeBankAccount(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, "");
}

export function joinOtherBank(bank: string, account: string): string {
  return `${bank.trim()}${OTHER_BANK_SEPARATOR}${account.trim()}`;
}

export function splitOtherBank(value: string | null | undefined): { bank: string; account: string } {
  const raw = value ?? "";
  const at = raw.indexOf(OTHER_BANK_SEPARATOR);
  if (at < 0) return { bank: "", account: raw };
  return { bank: raw.slice(0, at), account: raw.slice(at + OTHER_BANK_SEPARATOR.length) };
}

/** null si la cuenta es válida para el método; si no, el mensaje de error. */
export function payoutAccountError(method: PayoutMethodId, account: string): string | null {
  switch (method) {
    case "nequi":
      return /^\d{10}$/.test(account) ? null : "El celular de Nequi debe tener 10 dígitos.";
    case "bancolombia":
      return /^\d{6,20}$/.test(account) ? null : "La cuenta de Bancolombia debe tener solo números.";
    case "llave":
      return /^[A-Za-z0-9ñÑ@]{3,60}$/.test(account)
        ? null
        : "La llave solo admite letras, números y @.";
    case "otro": {
      const { bank, account: number } = splitOtherBank(account);
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ]{1,59}$/u.test(bank)) return "Escribe el nombre del banco.";
      if (!/^[\p{L}\p{N}]{3,40}$/u.test(number)) return "La cuenta solo admite letras y números.";
      return null;
    }
  }
}
