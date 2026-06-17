// app/api/admin/scoring-survey/route.ts — Resultados de la encuesta de
// sistema de puntos (goles_v2) por polla, para el dashboard /admin.
//
// GET:  lista de TODAS las pollas con encuesta abierta (o ya en goles_v2),
//       con el tally de votos por polla (sí / no / faltan). No incluye
//       proyección de tabla: el cambio es NO retroactivo, así que aplicar no
//       altera los puntos actuales — solo cuenta desde el próximo partido.
// POST: { pollaId, action: 'apply' | 'keep' }
//   apply → scoring_mode='goles_v2' + scoring_mode_changed_at=now() + cierra
//           la encuesta. NO re-scorea el pasado (no-retroactivo): de ahí en
//           adelante los partidos de esa polla cuentan con goles_v2.
//   keep  → cierra la encuesta dejando scoring_mode='classic'.
//
// Auth: solo sesión de admin (isCurrentUserAdmin). UI-only.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();

  // Pollas con encuesta abierta o ya migradas a goles_v2.
  const { data: pollas } = await admin
    .from("pollas")
    .select("id, name, slug, scoring_mode, scoring_survey_open, scoring_mode_changed_at")
    .or("scoring_survey_open.eq.true,scoring_mode.eq.goles_v2");

  const list = pollas ?? [];
  if (list.length === 0) {
    return NextResponse.json({ surveys: [] });
  }
  const pollaIds = list.map((p) => p.id);

  // Participantes pagados por polla.
  const { data: parts } = await admin
    .from("polla_participants")
    .select("polla_id")
    .in("polla_id", pollaIds)
    .eq("paid", true);
  const participantsByPolla = new Map<string, number>();
  for (const p of parts ?? [])
    participantsByPolla.set(p.polla_id, (participantsByPolla.get(p.polla_id) ?? 0) + 1);

  // Votos por polla.
  const { data: votes } = await admin
    .from("scoring_survey_votes")
    .select("polla_id, choice")
    .in("polla_id", pollaIds);
  const siByPolla = new Map<string, number>();
  const noByPolla = new Map<string, number>();
  for (const v of votes ?? []) {
    if (v.choice === "si")
      siByPolla.set(v.polla_id, (siByPolla.get(v.polla_id) ?? 0) + 1);
    else if (v.choice === "no")
      noByPolla.set(v.polla_id, (noByPolla.get(v.polla_id) ?? 0) + 1);
  }

  const surveys = list
    .map((p) => {
      const total = participantsByPolla.get(p.id) ?? 0;
      const si = siByPolla.get(p.id) ?? 0;
      const no = noByPolla.get(p.id) ?? 0;
      return {
        pollaId: p.id,
        pollaName: (p.name ?? "").trim(),
        pollaSlug: p.slug,
        scoringMode: p.scoring_mode,
        surveyOpen: p.scoring_survey_open,
        changedAt: p.scoring_mode_changed_at,
        counts: { total, si, no, pending: Math.max(0, total - si - no) },
      };
    })
    .sort((a, b) => {
      // Abiertas primero, luego por más votos/participantes.
      if (a.surveyOpen !== b.surveyOpen) return a.surveyOpen ? -1 : 1;
      return b.counts.total - a.counts.total;
    });

  return NextResponse.json({ surveys });
}

const Body = z.object({
  pollaId: z.string().uuid(),
  action: z.enum(["apply", "keep"]),
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

  if (parsed.action === "apply") {
    // No-retroactivo: marca el modo + el momento del cambio. NO re-scorea el
    // pasado — score_match/rescore_polla solo aplican goles_v2 a partidos con
    // kickoff >= scoring_mode_changed_at. Gated a encuesta abierta para no
    // tocar otras pollas (defense-in-depth).
    const { data: updated, error: updErr } = await admin
      .from("pollas")
      .update({
        scoring_mode: "goles_v2",
        scoring_mode_changed_at: new Date().toISOString(),
        scoring_survey_open: false,
      })
      .eq("id", parsed.pollaId)
      .eq("scoring_survey_open", true)
      .select("id");
    if (updErr) {
      console.error("[admin/scoring-survey] apply update error:", updErr);
      return NextResponse.json({ error: "No se pudo aplicar" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "Esa polla no tiene una encuesta abierta" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, applied: true });
  }

  // keep — cierra la encuesta sin cambiar el modo. Gated a survey abierta.
  const { data: kept, error: keepErr } = await admin
    .from("pollas")
    .update({ scoring_survey_open: false })
    .eq("id", parsed.pollaId)
    .eq("scoring_survey_open", true)
    .select("id");
  if (keepErr) {
    console.error("[admin/scoring-survey] keep update error:", keepErr);
    return NextResponse.json({ error: "No se pudo cerrar la encuesta" }, { status: 500 });
  }
  if (!kept || kept.length === 0) {
    return NextResponse.json(
      { error: "Esa polla no tiene una encuesta abierta" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, applied: false });
}
