// lib/auth/phone.ts — Single source of truth for phone normalization.
// Strips +, spaces, dashes, parens. "57 311-731-2391" → "573117312391".
// Every internal lookup (public.users.whatsapp_number, otp_rate_limits
// .phone_number) must use this same form so we don't have drift between
// tables. Supabase Auth's auth.users.phone keeps its own format with
// the leading + because Supabase normalizes it internally.

export function normalizePhone(raw: string): string {
  return (raw ?? "").replace(/[\s\-()+]/g, "");
}

// Strict E.164 ("+" + 8-15 digits, no leading 0) built on normalizePhone, or
// null when the input cannot be a phone number. Used where a number comes from
// outside the web form (e.g. a contact shared in Telegram, which may arrive
// with or without "+") so both channels land on the same "+digits" shape.
export function toE164(raw: string | null | undefined): string | null {
  const digits = normalizePhone(raw ?? "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

// Email derived from a phone number for the email/password Supabase Auth
// flow. Domain is internal-only (never delivered) and the phone-derived
// local-part keeps the email unique per user without exposing PII outside
// our own infra.
export function emailForPhone(phone: string): string {
  return `${normalizePhone(phone)}@wa.lapolla.app`;
}
