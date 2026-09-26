// app/api/cron/polla-avisos/route.ts — Avisos de pollas nuevas y de cierre.
//
// Disparado cada hora por GitHub Actions (.github/workflows/polla-avisos.yml).
// Público: los «jugadores» = quienes ya tuvieron una participación viva en
// alguna polla Casa (pagada o en revisión). Nunca se le escribe a quien ya
// está inscrito en esa polla, ni a quien respondió BAJA.
//
//   1. lp_polla_cierra — pollas abiertas cuyo cierre de inscripciones cae
//      entre 15 min y 3 h desde ahora. Una vez por persona y polla.
//   2. lp_polla_nueva — pollas publicadas en las últimas 48 h que siguen
//      abiertas por más de 3 h. Una vez por persona y polla, y como mucho una
//      polla nueva por persona cada 20 h (si se publican tres juntas, va la
//      que cierra primero; las demás le llegan en corridas siguientes).
//
// Auth: header Authorization: Bearer ${CRON_SECRET}, vía requireCronSecret.

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappOutboundEnabled } from "@/lib/whatsapp/outbound";
import { isLiveEntry } from "@/lib/casa/types";
import {
  RecipientBudget,
  formatTimeLeft,
  loadRecipients,
  selectAllPages,
  sendAviso,
  type AvisoTemplate,
} from "@/lib/whatsapp/avisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HOUR = 60 * 60_000;
const CLOSING_MIN_MS = 15 * 60_000;
const CLOSING_MAX_MS = 3 * HOUR;
const NEW_WINDOW_MS = 48 * HOUR;
const NEW_PER_USER_GAP_MS = 20 * HOUR;

interface PollaRow { id: string; slug: string; name: string; opens_at: string; closes_at: string }
type EntryRow = { polla_id: string; user_id: string; status: "pendiente" | "pagada" | "rechazada" | "anulada"; proof_path: string | null };

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  if (!whatsappOutboundEnabled()) {
    return NextResponse.json({ ok: true, disabled: true, sent: 0 });
  }

  const db = createAdminClient();
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  // ─── Pollas abiertas y publicadas que siguen recibiendo gente ───
  const { data: pollaRows, error: pollasErr } = await db
    .from("casa_pollas")
    .select("id, slug, name, opens_at, closes_at")
    .eq("status", "abierta")
    .is("archived_at", null)
    .neq("publication_mode", "oculta")
    .lte("opens_at", iso(now))
    .gt("closes_at", iso(now + CLOSING_MIN_MS));
  if (pollasErr) return NextResponse.json({ error: "pollas query failed", detail: pollasErr.message }, { status: 500 });
  const pollas = (pollaRows ?? []) as PollaRow[];

  const closing = pollas.filter((p) => Date.parse(p.closes_at) <= now + CLOSING_MAX_MS);
  const fresh = pollas
    .filter((p) => Date.parse(p.opens_at) >= now - NEW_WINDOW_MS && Date.parse(p.closes_at) > now + CLOSING_MAX_MS)
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at));
  if (closing.length === 0 && fresh.length === 0) {
    return NextResponse.json({ ok: true, message: "Sin pollas por avisar", sent: 0 });
  }

  // ─── Jugadores y en qué pollas ya están ───
  const entries = (await selectAllPages<EntryRow>((from, to) =>
    db.from("casa_entries").select("polla_id, user_id, status, proof_path")
      .in("status", ["pagada", "pendiente"]).range(from, to)))
    .filter(isLiveEntry);
  const joined = new Set(entries.map((e) => `${e.user_id}|${e.polla_id}`));
  const players = [...new Set(entries.map((e) => e.user_id))];
  const recipients = await loadRecipients(db, players);

  // ─── Lo ya enviado (una vez por persona y polla) ───
  const history = await selectAllPages<{ user_id: string; template_name: string; variables: { pollaId?: string } | null; created_at: string }>((from, to) =>
    db.from("wa_template_sends").select("user_id, template_name, variables, created_at")
      .in("template_name", ["lp_polla_cierra", "lp_polla_nueva"])
      .eq("status", "sent")
      .gte("created_at", iso(now - 14 * 24 * HOUR)).range(from, to));
  const sentFor = new Set(history.map((h) => `${h.template_name}|${h.user_id}|${h.variables?.pollaId ?? ""}`));
  const lastNew = new Map<string, number>();
  for (const h of history) {
    if (h.template_name !== "lp_polla_nueva") continue;
    lastNew.set(h.user_id, Math.max(lastNew.get(h.user_id) ?? 0, Date.parse(h.created_at)));
  }

  const budget = await RecipientBudget.load(db, now);
  const stats = { sent: 0, skipped: 0, failed: 0, capped: 0 };
  const errors: string[] = [];

  async function send(template: AvisoTemplate, polla: PollaRow, userId: string, extra: string[]) {
    const recipient = recipients.get(userId);
    if (!recipient || joined.has(`${userId}|${polla.id}`) || sentFor.has(`${template}|${userId}|${polla.id}`)) {
      stats.skipped++;
      return false;
    }
    if (!budget.canSend(recipient.phone)) { stats.capped++; return false; }
    const result = await sendAviso(db, {
      recipient,
      template,
      bodyParams: [recipient.firstName, polla.name, ...extra],
      pollaSlug: polla.slug,
      variables: { pollaId: polla.id, slug: polla.slug },
    });
    if (result.optedOut) { stats.skipped++; return false; }
    if (!result.ok) { stats.failed++; errors.push((result.error ?? "unknown").slice(0, 120)); return false; }
    stats.sent++;
    budget.markSent(recipient.phone);
    sentFor.add(`${template}|${userId}|${polla.id}`);
    return true;
  }

  // 1. Cierres (más urgentes: van primero en el cupo diario).
  for (const polla of closing) {
    const timeLeft = formatTimeLeft(Date.parse(polla.closes_at) - now);
    for (const userId of recipients.keys()) await send("lp_polla_cierra", polla, userId, [timeLeft]);
  }

  // 2. Pollas nuevas: como mucho una por persona cada 20 h.
  for (const userId of recipients.keys()) {
    if (now - (lastNew.get(userId) ?? 0) < NEW_PER_USER_GAP_MS) continue;
    for (const polla of fresh) {
      if (await send("lp_polla_nueva", polla, userId, [])) break;
    }
  }

  return NextResponse.json({
    ok: true,
    ...stats,
    total_candidates: recipients.size,
    closing: closing.length,
    fresh: fresh.length,
    errors: errors.slice(0, 5),
  });
}
