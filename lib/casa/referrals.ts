// lib/casa/referrals.ts — invitaciones del lado del servidor (migración 135).
//
// Las tablas de invitaciones son de solo lectura para service_role: toda
// escritura pasa por las funciones SQL. El llamador ya validó la sesión (web)
// o la cuenta vinculada (Telegram) y pasa el user_id.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyReferralGiftByTelegram } from "@/lib/telegram-player/notify";
import { validReferralCode } from "./referrals-shared";
import type { ReferralInviteeState, ReferralPerson, ReferralPollaView, ReferralProfile } from "./types";

export type ReferralVia = "enlace" | "codigo" | "telegram";

export type SetReferrerResult =
  | { ok: true; changed: boolean; locked: boolean; referrer: ReferralPerson | null }
  | { ok: false; error: string; referrer?: ReferralPerson | null };

/** La polla vista por esta persona: su código, su avance y quién la invitó. Null si falla. */
export async function getReferralPollaView(userId: string, pollaId: string): Promise<ReferralPollaView | null> {
  const { data, error } = await createAdminClient().rpc("casa_referral_polla_view_v1", {
    p_user_id: userId, p_polla_id: pollaId,
  });
  if (error) {
    console.warn("[casa/referrals] polla view unavailable:", error.message);
    return null;
  }
  return data as ReferralPollaView;
}

/** Quién invitó a esta persona y, si todavía puede elegir, a quién apunta el enlace abierto. */
export async function getReferralInvitee(userId: string, hint: string | null): Promise<ReferralInviteeState | null> {
  const { data, error } = await createAdminClient().rpc("casa_referral_invitee_v1", {
    p_user_id: userId, p_hint: hint,
  });
  if (error) {
    console.warn("[casa/referrals] invitee state unavailable:", error.message);
    return null;
  }
  return data as ReferralInviteeState;
}

export async function getReferralProfile(userId: string): Promise<ReferralProfile | null> {
  const { data, error } = await createAdminClient().rpc("casa_referral_profile_v1", { p_user_id: userId });
  if (error) {
    console.warn("[casa/referrals] profile unavailable:", error.message);
    return null;
  }
  return data as ReferralProfile;
}

export async function setReferrer(
  userId: string,
  code: string,
  via: ReferralVia,
  db: SupabaseClient = createAdminClient(),
): Promise<SetReferrerResult> {
  const { data, error } = await db.rpc("casa_set_referrer_v1", { p_user_id: userId, p_code: code, p_via: via });
  if (error) throw error;
  return data as SetReferrerResult;
}

/**
 * Respuestas con las que el código del enlace ya no le sirve a esta persona.
 * REFERRAL_RATE_LIMITED no está: pasada la hora, el enlace válido todavía vincula.
 */
const FINAL_RESULTS = new Set([
  "REFERRAL_CODE_NOT_FOUND",
  "SELF_REFERRAL",
  "REFERRAL_EXISTS",
  "REFERRAL_LOCKED",
  "NOT_NEW_USER",
]);

/**
 * Vincula con el código del enlace (cookie lp_ref) si la persona todavía no
 * tiene invitador. Nunca lanza: el pago o el perfil siguen aunque falle.
 * `clearCookie` indica si la cookie ya cumplió su función.
 */
export async function linkReferralFromCookie(
  userId: string,
  cookieValue: string | undefined,
): Promise<{ linked: boolean; clearCookie: boolean }> {
  if (!cookieValue) return { linked: false, clearCookie: false };
  const code = validReferralCode(cookieValue);
  if (!code) return { linked: false, clearCookie: true };
  try {
    const result = await setReferrer(userId, code, "enlace");
    if (result.ok) return { linked: true, clearCookie: true };
    return { linked: false, clearCookie: FINAL_RESULTS.has(result.error) };
  } catch (error) {
    console.warn("[casa/referrals] link from cookie failed:", (error as { message?: string }).message);
    return { linked: false, clearCookie: false };
  }
}

interface GiftNotice {
  event_id: string;
  polla_id: string;
  user_id: string;
  entry_id: string;
  detail: { invitados?: number } | null;
}

/**
 * Avisa por Telegram los cupos de regalo recién creados. Cada aviso se reclama
 * una sola vez en SQL; es mejor esfuerzo y nunca rompe la revisión del pago.
 */
export async function notifyReferralGifts(db: SupabaseClient = createAdminClient()): Promise<void> {
  try {
    const { data, error } = await db.rpc("casa_referral_claim_gift_notices_v1", { p_limit: 20 });
    if (error || !Array.isArray(data)) return;
    for (const notice of data as GiftNotice[]) {
      const [{ data: entry }, { data: polla }] = await Promise.all([
        db.from("casa_entries").select("entry_number, status")
          .eq("id", notice.entry_id).eq("user_id", notice.user_id).maybeSingle(),
        db.from("casa_pollas").select("name, slug").eq("id", notice.polla_id).maybeSingle(),
      ]);
      if (!entry || entry.status !== "pagada" || entry.entry_number == null || !polla) continue;
      await notifyReferralGiftByTelegram(db, {
        userId: notice.user_id,
        pollaName: polla.name,
        pollaSlug: polla.slug,
        entryNumber: entry.entry_number,
        invited: Number(notice.detail?.invitados ?? 0),
      });
    }
  } catch (error) {
    console.warn("[casa/referrals] gift notices not sent:", (error as { name?: string }).name);
  }
}
