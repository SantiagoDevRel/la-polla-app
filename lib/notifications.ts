// lib/notifications.ts — WhatsApp notification helpers used by API routes
// and admin actions. Every public function:
//   - Wraps the WA send in try/catch (never throws to the caller).
//   - Logs failures.
//   - Is safe to call from a webhook / server action.
//
// Triggers:
//   1) notifyParticipantJoined  — creator gets pinged when someone joins.
//   2) notifyMatchClosingSoon   — all participants 10 min before kickoff.
//   3) notifyMatchFinished      — all participants when a match scores.
//   4) notifyRankImprovement    — individual participant when rank improves.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "@/lib/whatsapp/bot";

const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";

function pollaLink(slug: string): string {
  return `${APP_URL}/pollas/${slug}`;
}

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

async function send(phone: string | null | undefined, body: string, tag: string) {
  if (!phone) return;
  try {
    await sendWhatsAppMessage(phone, body);
    console.log(`[notify:${tag}] → ${phone}`);
  } catch (err) {
    console.error(`[notify:${tag}] failed for ${phone}:`, err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// 1. Participant joined → ping the creator.
// ──────────────────────────────────────────────────────────────────────
export async function notifyParticipantJoined(
  admin: SupabaseClient,
  pollaId: string,
  newUserId: string
): Promise<void> {
  try {
    const { data: polla } = await admin
      .from("pollas")
      .select("name, slug, created_by, buy_in_amount")
      .eq("id", pollaId)
      .maybeSingle();
    if (!polla || polla.created_by === newUserId) return; // don't notify creator about themselves

    const { data: creator } = await admin
      .from("users")
      .select("whatsapp_number")
      .eq("id", polla.created_by)
      .maybeSingle();
    if (!creator?.whatsapp_number) return;

    const { data: joinedUser } = await admin
      .from("users")
      .select("display_name, whatsapp_number")
      .eq("id", newUserId)
      .maybeSingle();
    const joinedName = joinedUser?.display_name?.trim() || joinedUser?.whatsapp_number || "Alguien";

    const { count } = await admin
      .from("polla_participants")
      .select("id", { head: true, count: "exact" })
      .eq("polla_id", pollaId)
      .eq("status", "approved");
    const participantCount = count ?? 0;
    const total = (polla.buy_in_amount || 0) * participantCount;

    const body =
      `*${joinedName}* se unió a tu polla *${polla.name}*.\n` +
      `Ya son ${participantCount} participantes. Pozo total: ${fmtCOP(total)}`;
    await send(creator.whatsapp_number, body, "joined");
  } catch (err) {
    console.error("[notify:joined] non-fatal error:", err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// 2. Match closing soon — fire once per match across all containing pollas.
//    Run from the admin sync action; idempotent thanks to notified_closing.
// ──────────────────────────────────────────────────────────────────────
export async function notifyMatchesClosingSoon(
  admin: SupabaseClient
): Promise<number> {
  let totalSent = 0;
  try {
    const horizon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: matches } = await admin
      .from("matches")
      .select("id, home_team, away_team, scheduled_at, status, notified_closing")
      .eq("notified_closing", false)
      .in("status", ["scheduled", "live"])
      .gte("scheduled_at", now)
      .lte("scheduled_at", horizon);
    if (!matches || matches.length === 0) return 0;

    for (const m of matches) {
      // Find every polla that includes this match.
      const { data: pollas } = await admin
        .from("pollas")
        .select("id, slug, match_ids")
        .contains("match_ids", [m.id]);
      const pollaIds = (pollas ?? []).map((p) => p.id);
      if (!pollaIds.length) {
        await admin.from("matches").update({ notified_closing: true }).eq("id", m.id);
        continue;
      }

      const { data: parts } = await admin
        .from("polla_participants")
        .select("user_id, polla_id")
        .in("polla_id", pollaIds)
        .eq("status", "approved");
      // Dedup the WA blast per phone number.
      const userIds = Array.from(new Set((parts ?? []).map((p) => p.user_id)));
      if (!userIds.length) {
        await admin.from("matches").update({ notified_closing: true }).eq("id", m.id);
        continue;
      }

      const { data: users } = await admin
        .from("users")
        .select("id, whatsapp_number")
        .in("id", userIds);
      const phones = Array.from(new Set((users ?? []).map((u) => u.whatsapp_number).filter(Boolean) as string[]));

      const body = `Último aviso: *${m.home_team} vs ${m.away_team}* empieza en menos de 10 minutos. ¡Cierre de pronósticos ya!`;
      for (const phone of phones) {
        await send(phone, body, "closing");
        totalSent++;
      }
      await admin.from("matches").update({ notified_closing: true }).eq("id", m.id);
    }
  } catch (err) {
    console.error("[notify:closing] non-fatal error:", err);
  }
  return totalSent;
}

// ──────────────────────────────────────────────────────────────────────
// 3. Match finished → notify everyone playing in any polla containing it.
// ──────────────────────────────────────────────────────────────────────
export async function notifyMatchFinished(
  admin: SupabaseClient,
  matchId: string
): Promise<void> {
  try {
    const { data: m } = await admin
      .from("matches")
      .select("home_team, away_team, home_score, away_score, status")
      .eq("id", matchId)
      .maybeSingle();
    if (!m || m.status !== "finished" || m.home_score == null || m.away_score == null) return;

    const { data: pollas } = await admin
      .from("pollas")
      .select("id, slug")
      .contains("match_ids", [matchId]);
    if (!pollas?.length) return;

    for (const polla of pollas) {
      const { data: parts } = await admin
        .from("polla_participants")
        .select("user_id")
        .eq("polla_id", polla.id)
        .eq("status", "approved");
      const userIds = (parts ?? []).map((p) => p.user_id);
      if (!userIds.length) continue;

      const { data: users } = await admin
        .from("users")
        .select("whatsapp_number")
        .in("id", userIds);
      const phones = (users ?? []).map((u) => u.whatsapp_number).filter(Boolean) as string[];

      const body =
        `*${m.home_team} ${m.home_score} - ${m.away_score} ${m.away_team}* — Resultados actualizados.\n` +
        `Revisa tu posición: ${pollaLink(polla.slug)}`;
      for (const phone of phones) await send(phone, body, "finished");
    }
  } catch (err) {
    console.error("[notify:finished] non-fatal error:", err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// 4. Rank improvement → notify the individual participant. Caller passes a
//    map of (participant_id → previous_rank). Only sends if new < previous.
// ──────────────────────────────────────────────────────────────────────
export async function notifyRankImprovements(
  admin: SupabaseClient,
  pollaId: string,
  previousRanks: Map<string, number>, // participant_id → old rank
  newStandings: Array<{ id: string; user_id: string; rank: number }>
): Promise<void> {
  try {
    const { data: polla } = await admin
      .from("pollas")
      .select("name, slug")
      .eq("id", pollaId)
      .maybeSingle();
    if (!polla) return;

    const improvedUserIds: string[] = [];
    const improvedRanks = new Map<string, number>(); // user_id → new rank
    for (const row of newStandings) {
      const prev = previousRanks.get(row.id);
      if (prev == null) continue; // brand-new participant — skip the ping
      if (row.rank < prev) {
        improvedUserIds.push(row.user_id);
        improvedRanks.set(row.user_id, row.rank);
      }
    }
    if (!improvedUserIds.length) return;

    const { data: users } = await admin
      .from("users")
      .select("id, whatsapp_number")
      .in("id", improvedUserIds);
    for (const u of users ?? []) {
      const newRank = improvedRanks.get(u.id);
      if (!u.whatsapp_number || newRank == null) continue;
      const body =
        `Subiste al puesto #${newRank} en *${polla.name}*.\n` +
        `¡Sigue así! Ver ranking: ${pollaLink(polla.slug)}`;
      await send(u.whatsapp_number, body, "rank-up");
    }
  } catch (err) {
    console.error("[notify:rank-up] non-fatal error:", err);
  }
}
