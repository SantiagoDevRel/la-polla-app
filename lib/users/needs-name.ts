// lib/users/needs-name.ts
// Shared heuristic for "does this user still need to set their real name?"
// Triggers true when display_name is missing OR looks like the raw phone
// number the user authenticated with. Used by /onboarding (web) and by
// the WhatsApp bot main menu greeting.

const PHONE_SHAPE = /^\d{8,15}$/;

/**
 * True when the stored display_name is missing, blank, or phone-shaped.
 *
 * Phone-shape variants covered:
 *  - Raw digits: "573146167334"
 *  - With plus:  "+573146167334"
 *  - E.164 with or without spaces are not currently stored; add here
 *    if that changes.
 */
export function needsName(displayName: string | null | undefined): boolean {
  if (!displayName) return true;
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return true;
  const stripped = trimmed.replace(/^\+/, "");
  return PHONE_SHAPE.test(stripped);
}

/**
 * Validation bounds for a submitted display_name.
 * Kept alongside needsName so the two stay in sync.
 * Upper bound matches the zod schema in app/api/users/me.
 */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 50;

/**
 * True when a candidate new name is acceptable (length + not itself
 * phone-shaped). Used server-side to reject "update my name to my phone
 * number again" and similar.
 */
export function isValidDisplayName(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < DISPLAY_NAME_MIN) return false;
  if (trimmed.length > DISPLAY_NAME_MAX) return false;
  if (needsName(trimmed)) return false;
  return true;
}
