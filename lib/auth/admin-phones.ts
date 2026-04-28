// lib/auth/admin-phones.ts — Lista de phones admin que pueden usar el
// OTP bypass. Las phones viven en env var (no hardcoded) para no
// exponer números personales en el código público.
//
// Setup:
//   vercel env add ADMIN_BYPASS_PHONES production
//   → "351934255581,573117312391" (sin +, comma-separated)
//
// Si la env var no está seteada, el bypass está deshabilitado para
// todos los phones — la app cae al flow normal de Twilio OTP. Eso
// asegura que no haya bypass accidental por mis-config.

/** Lee la lista de phones admin desde env. Server-only. */
function getAdminPhones(): string[] {
  const raw = process.env.ADMIN_BYPASS_PHONES?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\D/g, ""))
    .filter((s) => s.length >= 8);
}

/** Helper que normaliza el input y chequea contra la lista del env. */
export function isAdminBypassPhone(phoneInput: string | null | undefined): boolean {
  if (!phoneInput) return false;
  const digits = phoneInput.replace(/\D/g, "");
  return getAdminPhones().includes(digits);
}
