// app/api/cron/match-reminders/route.ts — Recordatorio diario de pronósticos.
//
// Disparado por GitHub Actions a las 13:00 UTC (8am Bogotá). Para cada
// persona inscrita (pagada, o en revisión con comprobante) en una polla Casa
// de partidos con partidos HOY (Bogotá) que todavía se pueden pronosticar y
// que no tienen pronóstico en esa participación, manda la plantilla
// «lp_pronosticos_hoy» con el botón a /polla/<slug>. Un solo mensaje por persona
// al día: si le faltan pronósticos en varias pollas, va la que tiene más
// partidos pendientes (empate: la que juega primero).
//
// (2026-09-26) Antes leía el modelo P2P viejo (pollas/predictions) con la
// plantilla match_reminder_daily; Casa es donde se juega ahora.
//
// Idempotente: una persona que ya recibió «lp_pronosticos_hoy» hoy (Bogotá) no
// recibe otro, aunque el cron corra dos veces.
//
// Auth: header Authorization: Bearer ${CRON_SECRET}, vía requireCronSecret
// (el middleware exime /api/cron/ del gate de sesión).

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappOutboundEnabled } from "@/lib/whatsapp/outbound";
import { canEditCasaMatch } from "@/lib/casa/match-rules";
import { isLiveEntry } from "@/lib/casa/types";
import {
  RecipientBudget,
  loadRecipients,
  selectAllPages,
  sendAviso,
} from "@/lib/whatsapp/avisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TEMPLATE = "lp_pronosticos_hoy" as const;

interface Pending { pollaId: string; slug: string; name: string; count: number; firstKickoff: string }

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  if (!whatsappOutboundEnabled()) {
    return NextResponse.json({ ok: true, disabled: true, sent: 0 });
  }

  const db = createAdminClient();
  const now = Date.now();

  // ─── «Hoy» en Bogotá (UTC-5, sin horario de verano) ───
  const bogotaNow = new Date(now - 5 * 60 * 60 * 1000);
  const dayStart = new Date(Date.UTC(
    bogotaNow.getUTCFullYear(), bogotaNow.getUTCMonth(), bogotaNow.getUTCDate(), 5, 0, 0,
  ));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // ─── 1. Pollas Casa de partidos, publicadas y que aceptan pronósticos ───
  const { data: pollaRows, error: pollasErr } = await db
    .from("casa_pollas")
    .select("id, slug, name")
    .eq("kind", "partidos")
    .in("status", ["abierta", "cerrada"])
    .is("archived_at", null)
    .neq("publication_mode", "oculta")
    .lte("opens_at", new Date(now).toISOString());
  if (pollasErr) return fail("pollas", pollasErr.message);
  const pollas = new Map((pollaRows ?? []).map((p) => [p.id, p]));
  if (pollas.size === 0) return done("Sin pollas activas");

  // ─── 2. Partidos de hoy de esas pollas que todavía se pueden pronosticar ───
  const links = await selectAllPages<{ polla_id: string; match_id: string }>((from, to) =>
    db.from("casa_polla_matches").select("polla_id, match_id")
      .in("polla_id", [...pollas.keys()]).is("voided_at", null).range(from, to));
  const matchIds = [...new Set(links.map((l) => l.match_id))];
  if (matchIds.length === 0) return done("Sin partidos en pollas activas");

  const { data: matchRows, error: matchesErr } = await db
    .from("matches")
    .select("id, scheduled_at, status, elapsed, final_verified_at")
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString());
  if (matchesErr) return fail("matches", matchesErr.message);
  // Se filtra por fecha en SQL y por pertenencia aquí: la lista de ids de todas
  // las pollas activas no cabe en la URL.
  const inPollas = new Set(matchIds);
  const editable = new Map(
    (matchRows ?? [])
      .filter((m) => inPollas.has(m.id) && canEditCasaMatch({ ...m, voided_at: null }, now))
      .map((m) => [m.id, m.scheduled_at as string]),
  );
  if (editable.size === 0) return done("Sin partidos pronosticables hoy");

  const todayByPolla = new Map<string, string[]>();
  for (const l of links) {
    if (!editable.has(l.match_id)) continue;
    todayByPolla.set(l.polla_id, [...(todayByPolla.get(l.polla_id) ?? []), l.match_id]);
  }

  // ─── 3. Participaciones vivas en esas pollas ───
  const entries = (await selectAllPages<{ id: string; polla_id: string; user_id: string; status: "pendiente" | "pagada" | "rechazada" | "anulada"; proof_path: string | null }>((from, to) =>
    db.from("casa_entries").select("id, polla_id, user_id, status, proof_path")
      .in("polla_id", [...todayByPolla.keys()]).in("status", ["pagada", "pendiente"])
      .is("ticket_number", null).range(from, to)))
    .filter(isLiveEntry);
  if (entries.length === 0) return done("Nadie inscrito en pollas con partidos hoy");

  // ─── 4. Pronósticos ya hechos para los partidos de hoy ───
  // Por lotes de 200 ids: la lista entera de uuids no cabe en la URL de PostgREST.
  const picked = new Set<string>();
  for (let i = 0; i < entries.length; i += 200) {
    const batch = entries.slice(i, i + 200).map((e) => e.id);
    const picks = await selectAllPages<{ entry_id: string; match_id: string }>((from, to) =>
      db.from("casa_picks").select("entry_id, match_id")
        .in("entry_id", batch).in("match_id", [...editable.keys()]).range(from, to));
    for (const p of picks) picked.add(`${p.entry_id}|${p.match_id}`);
  }

  // ─── 5. Por persona: la polla con más partidos sin pronóstico ───
  const best = new Map<string, Pending>();
  for (const entry of entries) {
    const polla = pollas.get(entry.polla_id);
    const today = todayByPolla.get(entry.polla_id) ?? [];
    const missing = today.filter((mid) => !picked.has(`${entry.id}|${mid}`));
    if (!polla || missing.length === 0) continue;
    const firstKickoff = missing.map((mid) => editable.get(mid)!).sort()[0];
    const candidate: Pending = { pollaId: polla.id, slug: polla.slug, name: polla.name, count: missing.length, firstKickoff };
    const current = best.get(entry.user_id);
    if (!current || candidate.count > current.count
      || (candidate.count === current.count && candidate.firstKickoff < current.firstKickoff)) {
      best.set(entry.user_id, candidate);
    }
  }
  if (best.size === 0) return done("Todos ya pronosticaron los partidos de hoy");

  // ─── 6. Enviar (sin repetir en el día, respetando bajas y el tope diario) ───
  const recipients = await loadRecipients(db, [...best.keys()]);
  const { data: sentToday, error: sentErr } = await db
    .from("wa_template_sends").select("user_id")
    .eq("template_name", TEMPLATE).gte("created_at", dayStart.toISOString());
  if (sentErr) return fail("wa_template_sends", sentErr.message);
  const alreadySent = new Set((sentToday ?? []).map((r) => r.user_id));
  const budget = await RecipientBudget.load(db, now);

  let sent = 0, skipped = 0, failed = 0, capped = 0;
  const errors: string[] = [];
  const ordered = [...best.entries()].sort((a, b) => a[1].firstKickoff.localeCompare(b[1].firstKickoff));
  for (const [userId, pending] of ordered) {
    const recipient = recipients.get(userId);
    if (!recipient || alreadySent.has(userId)) { skipped++; continue; }
    if (!budget.canSend(recipient.phone)) { capped++; continue; }
    const result = await sendAviso(db, {
      recipient,
      template: TEMPLATE,
      bodyParams: [recipient.firstName, pending.name, String(pending.count)],
      pollaSlug: pending.slug,
      variables: { pollaId: pending.pollaId, slug: pending.slug, count: pending.count },
    });
    if (result.optedOut) skipped++;
    else if (result.ok) { sent++; budget.markSent(recipient.phone); }
    else { failed++; errors.push((result.error ?? "unknown").slice(0, 120)); }
  }

  return NextResponse.json({
    ok: true, sent, skipped, failed, capped,
    total_candidates: best.size,
    bogota_day_window: { start: dayStart.toISOString(), end: dayEnd.toISOString() },
    errors: errors.slice(0, 5),
  });
}

function done(message: string) {
  return NextResponse.json({ ok: true, message, sent: 0, skipped: 0 });
}

function fail(what: string, detail: string) {
  return NextResponse.json({ error: `${what} query failed`, detail }, { status: 500 });
}
