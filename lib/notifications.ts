// lib/notifications.ts — WhatsApp notification helpers used by API routes
// and admin actions. Every public function:
//   - Wraps the WA send in try/catch (never throws to the caller).
//   - Logs failures.
//   - Is safe to call from a webhook / server action.
//
// Triggers:
//   1) notifyParticipantJoined      — creator gets pinged when someone joins.
//   5) notifyAdminPaymentSubmitted  — admin gets pinged when a participant marks "ya pagué".
//   6) notifyParticipantPaymentApproved — participant gets pinged when admin approves.
//   2) notifyMatchClosingSoon   — all participants 10 min before kickoff.
//   3) notifyMatchFinished      — all participants when a match scores.
//   4) notifyRankImprovement    — individual participant when rank improves.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "@/lib/whatsapp/bot";
import { redactPhone } from "@/lib/log";

const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://lapollacolombiana.com";

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
    console.log(`[notify:${tag}] → ${redactPhone(phone)}`);
  } catch (err) {
    console.error(`[notify:${tag}] failed for ${redactPhone(phone)}:`, err);
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
//
// Dedup contract (migration 016):
//   For every (user_id, match_id, polla_id) recipient we attempt an
//   INSERT into match_result_notifications before sending. The PK
//   enforces at-most-once semantics. If the insert conflicts we skip
//   silently (do not log, it would be noisy on every admin re-sync).
//   If the WhatsApp send fails AFTER the insert succeeded we log the
//   error but intentionally leave the dedup row in place: under-sending
//   on retry is recoverable (manual reach-out), duplicate blasting is
//   not (Santiago got hit with 48 duplicate pings before this dedup).
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
        .select("id, whatsapp_number")
        .in("id", userIds);
      const recipients = (users ?? []).filter(
        (u): u is { id: string; whatsapp_number: string } => !!u.whatsapp_number
      );
      if (!recipients.length) continue;

      const body =
        `*${m.home_team} ${m.home_score} - ${m.away_score} ${m.away_team}* — Resultados actualizados.\n` +
        `Revisa tu posición: ${pollaLink(polla.slug)}`;

      for (const u of recipients) {
        // Insert-then-send. .select() returns the inserted row(s); an empty
        // array means ON CONFLICT fired and this recipient was already
        // notified for this (user, match, polla) tuple.
        const { data: inserted, error: insertErr } = await admin
          .from("match_result_notifications")
          .upsert(
            { user_id: u.id, match_id: matchId, polla_id: polla.id },
            { onConflict: "user_id,match_id,polla_id", ignoreDuplicates: true }
          )
          .select("user_id");
        if (insertErr) {
          console.error(
            `[notify:finished] dedup insert failed for user=${u.id} match=${matchId} polla=${polla.id}:`,
            insertErr
          );
          continue;
        }
        if (!inserted || inserted.length === 0) continue; // already notified, skip silently
        await send(u.whatsapp_number, body, "finished");
      }
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

// ──────────────────────────────────────────────────────────────────────
// 5. Participant marked "ya pagué" → ping the organizer so they can approve.
//    Dedup via payment_submitted_notifications (participant_id, polla_id).
// ──────────────────────────────────────────────────────────────────────
export async function notifyAdminPaymentSubmitted(
  admin: SupabaseClient,
  pollaId: string,
  participantUserId: string
): Promise<void> {
  try {
    const { data: participant } = await admin
      .from("polla_participants")
      .select("id")
      .eq("polla_id", pollaId)
      .eq("user_id", participantUserId)
      .maybeSingle();
    if (!participant) return;

    const { data: inserted } = await admin
      .from("payment_submitted_notifications")
      .upsert(
        { participant_id: participant.id, polla_id: pollaId },
        { onConflict: "participant_id,polla_id", ignoreDuplicates: true }
      )
      .select("participant_id");
    if (!inserted || inserted.length === 0) return; // already notified

    const { data: polla } = await admin
      .from("pollas")
      .select("name, slug, created_by")
      .eq("id", pollaId)
      .maybeSingle();
    if (!polla) return;

    const { data: adminUser } = await admin
      .from("users")
      .select("whatsapp_number")
      .eq("id", polla.created_by)
      .maybeSingle();
    if (!adminUser?.whatsapp_number) return;

    const { data: payer } = await admin
      .from("users")
      .select("display_name, whatsapp_number")
      .eq("id", participantUserId)
      .maybeSingle();
    const payerName =
      payer?.display_name?.trim() || payer?.whatsapp_number || "Un participante";

    const body =
      `💸 *${payerName}* marcó como pagado en *${polla.name}*.\n` +
      `Ve a Pagos para aprobar: ${pollaLink(polla.slug)}`;
    await send(adminUser.whatsapp_number, body, "payment-submitted");
  } catch (err) {
    console.error("[notify:payment-submitted] non-fatal error:", err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// 6. Admin approved a payment → ping the participant so they know they can
//    start pronosticando. Dedup via payment_approved_notifications.
// ──────────────────────────────────────────────────────────────────────
export async function notifyParticipantPaymentApproved(
  admin: SupabaseClient,
  pollaId: string,
  participantUserId: string
): Promise<void> {
  try {
    const { data: participant } = await admin
      .from("polla_participants")
      .select("id")
      .eq("polla_id", pollaId)
      .eq("user_id", participantUserId)
      .maybeSingle();
    if (!participant) return;

    const { data: inserted } = await admin
      .from("payment_approved_notifications")
      .upsert(
        { participant_id: participant.id, polla_id: pollaId },
        { onConflict: "participant_id,polla_id", ignoreDuplicates: true }
      )
      .select("participant_id");
    if (!inserted || inserted.length === 0) return; // already notified

    const { data: polla } = await admin
      .from("pollas")
      .select("name, slug")
      .eq("id", pollaId)
      .maybeSingle();
    if (!polla) return;

    const { data: userRow } = await admin
      .from("users")
      .select("whatsapp_number")
      .eq("id", participantUserId)
      .maybeSingle();
    if (!userRow?.whatsapp_number) return;

    const body =
      `✅ Tu pago en *${polla.name}* fue aprobado.\n` +
      `Ya puedes pronosticar: ${pollaLink(polla.slug)}`;
    await send(userRow.whatsapp_number, body, "payment-approved");
  } catch (err) {
    console.error("[notify:payment-approved] non-fatal error:", err);
  }
}
