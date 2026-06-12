// lib/pollas/join.ts — Shared join-by-code business logic.
//
// One function, two call sites: app/api/pollas/join-by-code/route.ts (web)
// and lib/whatsapp/flows.ts (bot). Keeping the logic here prevents the two
// surfaces from drifting on validation, rate limiting, and participant
// status semantics.
//
// The caller is responsible for supplying the phone number (used for
// rate limiting). Web gets it from users.whatsapp_number, bot gets it
// from the inbound message.

import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { recomputePollaStandings } from "@/lib/scoring";
import { validateJoinCodeFormat } from "./join-code";

export type JoinByCodeResult =
  | { ok: true; polla: { id: string; slug: string; name: string } }
  | {
      ok: false;
      code:
        | "invalid_format"
        | "rate_limited"
        | "not_found"
        | "not_active"
        | "already_member";
      retryAfter?: Date;
    };

interface JoinByCodeInput {
  userId: string;
  phone: string;
  code: string;
}

/**
 * Tries to join the caller into the polla whose join_code matches `code`.
 * Normalizes the code to uppercase, rate-limits by phone, and enforces the
 * same participant status semantics as the invite-link flow (role='player',
 * status='approved'). Returns a discriminated union so the caller can
 * translate each outcome into its own message surface (HTTP / WhatsApp).
 */
export async function joinByCode(
  input: JoinByCodeInput,
): Promise<JoinByCodeResult> {
  const normalized = (input.code ?? "").trim().toUpperCase();

  if (!validateJoinCodeFormat(normalized)) {
    return { ok: false, code: "invalid_format" };
  }

  // Rate limit BEFORE the lookup so probing the code space is throttled.
  // checkAndRecordAttempt both counts and records the attempt atomically,
  // so failed attempts count against the quota exactly as the spec asks.
  const rl = await checkAndRecordAttempt(input.phone, "join_code");
  if (rl.blocked) {
    return { ok: false, code: "rate_limited", retryAfter: rl.retryAfter };
  }

  const admin = createAdminClient();

  // Lookup polla by code.
  const { data: polla, error: lookupErr } = await admin
    .from("pollas")
    .select("id, slug, name, status, payment_mode, buy_in_amount")
    .eq("join_code", normalized)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!polla) return { ok: false, code: "not_found" };

  if (polla.status !== "active") {
    return { ok: false, code: "not_active" };
  }

  // Already a participant?
  const { data: existing, error: existingErr } = await admin
    .from("polla_participants")
    .select("id")
    .eq("polla_id", polla.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return { ok: false, code: "already_member" };

  // paid semantics per payment mode. Mirrors the invite-link join route:
  //   admin_collects + buy_in > 0 → paid=false until the organizer approves
  //                                 the comprobante.
  //   admin_collects + buy_in = 0 → paid=true (free polla, nothing to collect
  //                                 — otherwise the player is locked out).
  //   pay_winner                  → paid=true on join (nothing upfront).
  const isAdminCollects = polla.payment_mode === "admin_collects";
  const hasBuyIn = Number(polla.buy_in_amount) > 0;
  const initialPaid = !isAdminCollects || !hasBuyIn;

  const { error: insertErr } = await admin.from("polla_participants").insert({
    polla_id: polla.id,
    user_id: input.userId,
    role: "player",
    status: "approved",
    payment_status: "approved",
    paid: initialPaid,
  });
  if (insertErr) throw insertErr;

  // Recompute standings so the new participant lands at the correct rank
  // immediately. Without this, a fresh row is stamped rank=1 at insert
  // (DB-side default behaviour) and a 0-point newcomer would show as
  // "#1 · va ganando $X" above real point-holders until the next match in
  // the polla finishes and score_match re-ranks. Only paid=true rows enter
  // the leaderboard, so skip the recompute when the joiner is still unpaid
  // (admin_collects pre-approval) — the payment-approval path recomputes
  // then. Best-effort: a recompute failure must not fail the join.
  if (initialPaid) {
    try {
      await recomputePollaStandings(admin, [polla.id]);
    } catch (err) {
      console.warn("[joinByCode] recompute standings failed (non-fatal):", err);
    }
  }

  return {
    ok: true,
    polla: { id: polla.id, slug: polla.slug, name: polla.name },
  };
}
