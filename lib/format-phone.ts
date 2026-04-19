/**
 * Format a raw phone number string to readable form.
 * Colombian format: +57 XXX XXX XXXX (country code 57, 10-digit mobile).
 * For non-Colombian or non-phone strings, returns input unchanged.
 *
 * Examples:
 *   formatPhone("573146167334")  → "+57 314 616 7334"
 *   formatPhone("+573146167334") → "+57 314 616 7334"
 *   formatPhone("Santiago")      → "Santiago"
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 12)}`;
  }
  return raw;
}
