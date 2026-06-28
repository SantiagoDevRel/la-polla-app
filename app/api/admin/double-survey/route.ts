// app/api/admin/double-survey/route.ts — Resultados de la encuesta "puntos
// dobles desde octavos" por polla, para el dashboard /admin.
//
// GET:  lista de TODAS las pollas con encuesta abierta (o ya con el doble
//       activo), con el tally de votos por polla (sí / no / faltan).
// POST: { pollaId, action: 'apply' | 'keep' }
//   apply → double_from_octavos=true + double_decided_at=now() + cierra la
//           encuesta, y rescore_polla() para re-doblar cualquier octavos+ ya
//           jugado (normalmente ninguno: se vota antes de octavos).
//   keep  → cierra la encuesta dejando double_from_octavos=false.
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

  // Pollas con encuesta abierta o ya con el doble activo.
  const { data: pollas } = await admin
    .from("pollas")
    .select("id, name, slug, double_from_octavos, double_survey_open, double_decided_at")
    .or("double_survey_open.eq.true,double_from_octavos.eq.true");

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
    .from("double_survey_votes")
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
        doubleActive: p.double_from_octavos,
        surveyOpen: p.double_survey_open,
        decidedAt: p.double_decided_at,
        counts: { total, si, no, pending: Math.max(0, total - si - no) },
      };
    })
    .sort((a, b) => {
      // Abiertas primero, luego por más participantes.
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
    // Activa el doble desde octavos para ESTA polla. Gated a encuesta abierta
    // para no tocar otras (defense-in-depth). double_decided_at = sello de
    // auditoría. El doble es por FASE, así que grupos/16vos ya jugados nunca
    // se tocan; rescore_polla solo re-dobla octavos+ ya finalizados (casi
    // siempre ninguno — se vota antes de octavos).
    const { data: updated, error: updErr } = await admin
      .from("pollas")
      .update({
        double_from_octavos: true,
        double_decided_at: new Date().toISOString(),
        double_survey_open: false,
      })
      .eq("id", parsed.pollaId)
      .eq("double_survey_open", true)
      .select("id");
    if (updErr) {
      console.error("[admin/double-survey] apply update error:", updErr);
      return NextResponse.json({ error: "No se pudo aplicar" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "Esa polla no tiene una encuesta abierta" },
        { status: 409 },
      );
    }
    // Recalcular puntos de la polla (idempotente). Si octavos aún no se
    // jugaron, es no-op para el doble; deja todo consistente igualmente.
    const { error: rescoreErr } = await admin.rpc("rescore_polla", {
      p_polla_id: parsed.pollaId,
    });
    if (rescoreErr) {
      // No es fatal: el cambio ya quedó marcado y el trigger doblará octavos+
      // a medida que se finalicen. Logueamos para visibilidad.
      console.error("[admin/double-survey] rescore_polla error:", rescoreErr);
    }
    return NextResponse.json({ ok: true, applied: true });
  }

  // keep — cierra la encuesta sin activar el doble. Gated a survey abierta.
  const { data: kept, error: keepErr } = await admin
    .from("pollas")
    .update({ double_survey_open: false })
    .eq("id", parsed.pollaId)
    .eq("double_survey_open", true)
    .select("id");
  if (keepErr) {
    console.error("[admin/double-survey] keep update error:", keepErr);
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
