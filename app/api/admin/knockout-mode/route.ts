// app/api/admin/knockout-mode/route.ts — Flip del modo "120' + avance" por
// polla (migración 077), para el dashboard /admin. SIN encuesta: top-down.
//
// GET:  pollas ACTIVAS del Mundial (single o combinada) con >=2 pagados, o
//       cualquiera que ya tenga el modo activo, con su estado actual.
// POST: { pollaId, action: 'enable' | 'disable' }
//   enable  → score_120=true + advance_bonus=true + kc_mode_changed_at=now()
//             y rescore_polla() (aplica el 120' + bonus a knockouts >= cutoff).
//   disable → score_120=false + advance_bonus=false + kc_mode_changed_at=null
//             y rescore_polla() (revierte a 90' sin bonus).
//
// El flip solo afecta a ESA polla. kc_mode_changed_at=now() hace que el cambio
// sea NO retroactivo: solo cuenta para partidos con kickoff >= ese momento.
//
// Auth: solo sesión de admin (isCurrentUserAdmin). UI-only.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Mañana 00:00 hora Bogotá (UTC-5)" en ISO UTC. El +1 de avance arranca
// mañana: quien ya pronosticó hoy no tuvo chance de elegir ganador, así que el
// bonus no aplica al partido de hoy. El 120' sí arranca ya (kc_mode_changed_at).
function tomorrowBogotaMidnightISO(): string {
  const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowBogota = new Date(Date.now() - BOGOTA_OFFSET_MS);
  const y = nowBogota.getUTCFullYear();
  const m = nowBogota.getUTCMonth();
  const d = nowBogota.getUTCDate();
  // mañana 00:00 Bogotá = ese instante en UTC (medianoche -05 → +5h en UTC).
  return new Date(Date.UTC(y, m, d + 1, 5, 0, 0)).toISOString();
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();

  const { data: pollas } = await admin
    .from("pollas")
    .select("id, name, slug, score_120, advance_bonus, kc_mode_changed_at, advance_bonus_from, tournament, tournaments")
    .eq("status", "active");

  // Solo Mundial (single o combinada) — es el único torneo con knockouts hoy.
  const wc = (pollas ?? []).filter(
    (p) =>
      p.tournament === "worldcup_2026" ||
      (Array.isArray(p.tournaments) && p.tournaments.includes("worldcup_2026")),
  );
  if (wc.length === 0) {
    return NextResponse.json({ pollas: [] });
  }
  const ids = wc.map((p) => p.id);

  // Pagados por polla (un voto que valga = participante real).
  const { data: parts } = await admin
    .from("polla_participants")
    .select("polla_id")
    .in("polla_id", ids)
    .eq("paid", true);
  const paidBy = new Map<string, number>();
  for (const p of parts ?? [])
    paidBy.set(p.polla_id, (paidBy.get(p.polla_id) ?? 0) + 1);

  const list = wc
    .map((p) => {
      const modeActive = !!p.score_120 || !!p.advance_bonus;
      return {
        pollaId: p.id,
        pollaName: (p.name ?? "").trim(),
        pollaSlug: p.slug,
        score120: !!p.score_120,
        advanceBonus: !!p.advance_bonus,
        modeActive,
        changedAt: p.kc_mode_changed_at,
        advanceFrom: p.advance_bonus_from,
        paid: paidBy.get(p.id) ?? 0,
      };
    })
    .filter((p) => p.paid >= 2 || p.modeActive)
    .sort((a, b) => {
      if (a.modeActive !== b.modeActive) return a.modeActive ? -1 : 1;
      return b.paid - a.paid;
    });

  return NextResponse.json({ pollas: list });
}

const Body = z.object({
  pollaId: z.string().uuid(),
  action: z.enum(["enable", "disable"]),
});

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const enable = parsed.action === "enable";

  const { data: updated, error: updErr } = await admin
    .from("pollas")
    .update(
      enable
        ? {
            score_120: true,
            advance_bonus: true,
            kc_mode_changed_at: new Date().toISOString(),
            advance_bonus_from: tomorrowBogotaMidnightISO(),
          }
        : {
            score_120: false,
            advance_bonus: false,
            kc_mode_changed_at: null,
            advance_bonus_from: null,
          },
    )
    .eq("id", parsed.pollaId)
    .select("id");
  if (updErr) {
    console.error("[admin/knockout-mode] update error:", updErr);
    return NextResponse.json({ error: "No se pudo aplicar" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  // Recalcular puntos de la polla con el nuevo modo (idempotente). Para los
  // knockouts aún no jugados es no-op; al verificarse cada uno el trigger
  // score_match ya aplica el 120'/bonus.
  const { error: rescoreErr } = await admin.rpc("rescore_polla", {
    p_polla_id: parsed.pollaId,
  });
  if (rescoreErr) {
    console.error("[admin/knockout-mode] rescore_polla error:", rescoreErr);
  }

  return NextResponse.json({ ok: true, enabled: enable });
}
