// lib/pollas/rotate-code.ts
// Rotates a polla's join code. Generates a new unique code and
// persists it. Shared between the web rotate-code route and the
// WhatsApp bot rotate flow so that both paths stay DB-identical.
//
// DOES NOT check admin permission. Callers MUST verify
// polla_participants.role === 'admin' for (user, polla) before calling.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateUniqueJoinCode } from "@/lib/pollas/join-code";

export type RotateJoinCodeResult =
  | { ok: true; code: string }
  | { ok: false; reason: "generation_failed" | "update_failed" };

/**
 * Rotate the join code for a polla.
 *
 * @param admin  Supabase admin client (service role).
 * @param pollaId UUID of the polla whose code should be rotated.
 * @returns RotateJoinCodeResult with the new code on success.
 */
export async function rotateJoinCode(
  admin: SupabaseClient,
  pollaId: string,
): Promise<RotateJoinCodeResult> {
  let code: string;
  try {
    code = await generateUniqueJoinCode(admin);
  } catch {
    return { ok: false, reason: "generation_failed" };
  }

  const { error } = await admin
    .from("pollas")
    .update({ join_code: code })
    .eq("id", pollaId);

  if (error) {
    return { ok: false, reason: "update_failed" };
  }

  return { ok: true, code };
}
