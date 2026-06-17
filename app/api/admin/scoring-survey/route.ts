// app/api/admin/scoring-survey/route.ts — Resultados de la encuesta de
// sistema de puntos + comparativa de tabla (cómo está vs cómo quedaría con
// goles_v2) para el dashboard /admin.
//
// GET:  tally de votos por participante + tabla actual vs proyectada.
// POST: { pollaId, action: 'apply' | 'keep' }
//   apply → scoring_mode='goles_v2', cierra la encuesta y re-scorea SOLO
//           esa polla (rescore_polla). No toca ninguna otra polla.
//   keep  → deja scoring_mode='classic' y cierra la encuesta.
//
// Auth: solo sesión de admin (isCurrentUserAdmin). UI-only, sin CRON path.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { calculatePointsGolesV2 } from "@/lib/utils/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Standard competition ranking (empates comparten puesto, el siguiente
// salta). Devuelve user_id → rank.
function rankByUser(rows: { user_id: string; points: number }[]): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  const ranks = new Map<string, number>();
  let currentRank = 0;
  let lastPts = Number.NaN;
  sorted.forEach((row, i) => {
    if (row.points !== lastPts) {
      currentRank = i + 1;
      lastPts = row.points;
    }
    ranks.set(row.user_id, currentRank);
  });
  return ranks;
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();

  // Polla con encuesta abierta (o ya cerrada pero en goles_v2: para seguir
  // mostrando el resultado tras aplicar). Priorizamos la abierta.
  const { data: pollas } = await admin
    .from("pollas")
    .select("id, name, slug, scoring_mode, scoring_survey_open")
    .or("scoring_survey_open.eq.true,scoring_mode.eq.goles_v2")
    .order("scoring_survey_open", { ascending: false })
    .limit(1);

  const polla = pollas?.[0];
  if (!polla) {
    return NextResponse.json({ survey: null });
  }

  // Participantes pagados.
  const { data: parts } = await admin
    .from("polla_participants")
    .select("user_id, total_points, rank, users!inner(display_name, avatar_url)")
    .eq("polla_id", polla.id)
    .eq("paid", true);

  type PartRow = {
    user_id: string;
    total_points: number | null;
    rank: number | null;
    users: { display_name: string | null; avatar_url: string | null };
  };
  const participants = (parts ?? []) as unknown as PartRow[];

  // Predicciones de la polla.
  const { data: preds } = await admin
    .from("predictions")
    .select("user_id, match_id, predicted_home, predicted_away, points_earned")
    .eq("polla_id", polla.id);

  type PredRow = {
    user_id: string;
    match_id: string;
    predicted_home: number;
    predicted_away: number;
    points_earned: number | null;
  };
  const predictions = (preds ?? []) as PredRow[];

  // Resultados de los partidos finalizados + verificados.
  const matchIds = Array.from(new Set(predictions.map((p) => p.match_id)));
  const results = new Map<string, { h: number; a: number }>();
  if (matchIds.length > 0) {
    const { data: matches } = await admin
      .from("matches")
      .select("id, home_score, away_score, status, final_verified_at")
      .in("id", matchIds);
    for (const m of matches ?? []) {
      if (
        m.status === "finished" &&
        m.final_verified_at != null &&
        m.home_score != null &&
        m.away_score != null
      ) {
        results.set(m.id, { h: m.home_score, a: m.away_score });
      }
    }
  }

  // Proyección goles_v2 por usuario (solo partidos ya resueltos).
  const projectedByUser = new Map<string, number>();
  for (const part of participants) projectedByUser.set(part.user_id, 0);
  for (const pred of predictions) {
    const res = results.get(pred.match_id);
    if (!res) continue;
    const pts = calculatePointsGolesV2(
      { homeScore: pred.predicted_home, awayScore: pred.predicted_away },
      { homeScore: res.h, awayScore: res.a },
    );
    projectedByUser.set(
      pred.user_id,
      (projectedByUser.get(pred.user_id) ?? 0) + pts,
    );
  }

  // Votos.
  const { data: votes } = await admin
    .from("scoring_survey_votes")
    .select("user_id, choice")
    .eq("polla_id", polla.id);
  const voteByUser = new Map<string, "si" | "no">();
  for (const v of votes ?? []) voteByUser.set(v.user_id, v.choice as "si" | "no");

  // Construir filas con rank actual y proyectado.
  const currentRankByUser = rankByUser(
    participants.map((p) => ({ user_id: p.user_id, points: p.total_points ?? 0 })),
  );
  const projectedRankByUser = rankByUser(
    participants.map((p) => ({
      user_id: p.user_id,
      points: projectedByUser.get(p.user_id) ?? 0,
    })),
  );

  const rows = participants
    .map((p) => ({
      userId: p.user_id,
      name: (p.users?.display_name ?? "—").trim(),
      avatar: p.users?.avatar_url ?? null,
      currentPoints: p.total_points ?? 0,
      currentRank: currentRankByUser.get(p.user_id) ?? 0,
      projectedPoints: projectedByUser.get(p.user_id) ?? 0,
      projectedRank: projectedRankByUser.get(p.user_id) ?? 0,
      vote: voteByUser.get(p.user_id) ?? null,
    }))
    .sort((a, b) => a.currentRank - b.currentRank);

  const counts = {
    total: participants.length,
    si: rows.filter((r) => r.vote === "si").length,
    no: rows.filter((r) => r.vote === "no").length,
    pending: rows.filter((r) => r.vote === null).length,
  };

  return NextResponse.json({
    survey: {
      pollaId: polla.id,
      pollaName: (polla.name ?? "").trim(),
      pollaSlug: polla.slug,
      scoringMode: polla.scoring_mode,
      surveyOpen: polla.scoring_survey_open,
      counts,
      rows,
    },
  });
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
    // Defense-in-depth: solo se puede aplicar a una polla con encuesta
    // ABIERTA. Sin el filtro scoring_survey_open=true, un request manual o
    // bug de UI podría cambiar el modo de OTRA polla (hallazgo codex).
    const { data: updated, error: updErr } = await admin
      .from("pollas")
      .update({ scoring_mode: "goles_v2", scoring_survey_open: false })
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
    const { error: rescoreErr } = await admin.rpc("rescore_polla", {
      p_polla_id: parsed.pollaId,
    });
    if (rescoreErr) {
      console.error("[admin/scoring-survey] rescore error:", rescoreErr);
      return NextResponse.json(
        { error: "Se cambió el modo pero falló el re-cálculo. Reintenta." },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, applied: true });
  }

  // keep — cierra la encuesta sin cambiar el modo. También gated a
  // scoring_survey_open=true para no tocar pollas sin encuesta.
  const { error: keepErr } = await admin
    .from("pollas")
    .update({ scoring_survey_open: false })
    .eq("id", parsed.pollaId)
    .eq("scoring_survey_open", true);
  if (keepErr) {
    console.error("[admin/scoring-survey] keep update error:", keepErr);
    return NextResponse.json({ error: "No se pudo cerrar la encuesta" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, applied: false });
}
