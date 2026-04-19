// lib/pollas/join-code.ts — 6-char join-code generation + format validation.
//
// The alphabet excludes visually ambiguous characters (0, O, I, 1) so users
// copying the code from a screenshot, a sticker, or WhatsApp do not mis-read
// it. 32^6 = ~1.07 billion combinations, which is plenty for collision-free
// generation with a handful of retries.
//
// Used by:
//   - scripts/backfill-join-codes.ts (kept standalone for portability)
//   - API routes that rotate a polla's code
//   - Future polla-creation path that assigns a code at insert time

import type { SupabaseClient } from "@supabase/supabase-js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_REGEX = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * Generates one random 6-char code from the unambiguous alphabet.
 * Does not check the DB for uniqueness; use generateUniqueJoinCode for that.
 */
export function generateJoinCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Generates a join code that is not already in use.
 * Retries on collision up to `maxAttempts` times (default 10).
 * Throws if still not unique after retries.
 */
export async function generateUniqueJoinCode(
  supabase: SupabaseClient,
  maxAttempts = 10,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateJoinCode();
    const { data, error } = await supabase
      .from("pollas")
      .select("id")
      .eq("join_code", code)
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!data) return code;
  }
  throw new Error(
    `Could not generate a unique join code after ${maxAttempts} attempts`,
  );
}

/**
 * True when `code` is exactly 6 uppercase chars from the unambiguous alphabet.
 * Lowercase input returns false — callers should normalize before validating.
 */
export function validateJoinCodeFormat(code: string): boolean {
  return typeof code === "string" && CODE_REGEX.test(code);
}

export const JOIN_CODE_ALPHABET = ALPHABET;
export const JOIN_CODE_LENGTH = CODE_LENGTH;
