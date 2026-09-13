// app/api/admin/discrepancies/[matchId]/route.ts
//
// POST — resuelve la discrepancia escogiendo la fuente del resultado.
//
// Body shape:
//   { source: 'api-football' }                            // confirma la última lectura de API-Football en caché
//   { source: 'manual', home: number, away: number }      // marcador de 90' ingresado por el admin
//
// API-Football es la única fuente de partidos desde el 2026-09-13: 'espn' y
// 'fd' ya no existen y responden 400. Con 'api-football' el servidor vuelve a
// leer la observación guardada (nunca confía en cifras del cliente) y no gasta
// cuota: si la caché no trae un final utilizable, responde 409 y queda el manual.
//
// El cierre va por finalize_verified_match_result (093), el mismo RPC con
// bloqueo de fila que usa la verificación automática; el trigger de scoring
// dispara con final_verified_at.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin, getAuthenticatedUser } from "@/lib/auth/admin";
import { cachedApiFootballResult } from "@/lib/matches/af-cached-result";
import { readFinalResult } from "@/lib/api-football/results";
import { KNOCKOUT_PHASES } from "@/lib/utils/points";

const BodySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("api-football"),
  }),
  z.object({
    source: z.literal("manual"),
    home: z.number().int().nonnegative(),
    away: z.number().int().nonnegative(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const me = await getAuthenticatedUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const matchId = (await params).matchId;

  // Obtener el match para diagnóstico + status check.
  const { data: match, error: matchErr } = await admin
    .from("matches")
    .select("id, status, home_score, away_score, final_verified_at, tournament, phase, home_team, away_team, scheduled_at, external_id, source_external_ids")
    .eq("id", matchId)
    .maybeSingle();
  if (matchErr || !match) {
    return NextResponse.json({ error: "Match no encontrado" }, { status: 404 });
  }
  if (match.status !== "finished") {
    return NextResponse.json(
      { error: `El partido no está finalizado (status=${match.status}). No se puede resolver una discrepancia que aún no terminó.` },
      { status: 409 },
    );
  }
  if (match.final_verified_at) {
    return NextResponse.json(
      { ok: true, already: true, message: "Ya estaba verificado." },
    );
  }

  const verifiedAt = new Date().toISOString();
  const adminNote = me?.display_name
    ? `manual override por ${me.display_name} (${me.id})`
    : `manual override`;
  const notes = `${adminNote} via /admin/discrepancias source=${parsed.data.source} at=${verifiedAt}`;
  const isKnockout = !!match.phase && KNOCKOUT_PHASES.has(match.phase);

  let home: number;
  let away: number;
  // Extras de knockout (migración 077). Con 'manual' quedan en null y
  // score_match cae al 90' / avance derivado del marcador decisivo.
  let fulltimeHome: number | null = null;
  let fulltimeAway: number | null = null;
  let penaltyHome: number | null = null;
  let penaltyAway: number | null = null;
  let advancer: "home" | "away" | null = null;

  if (parsed.data.source === "api-football") {
    const observation = await cachedApiFootballResult(match);
    const final = observation ? readFinalResult(observation.fixture) : null;
    if (!observation || !final) {
      return NextResponse.json(
        { error: "API-Football no tiene guardado un resultado final de este partido. Ingresa manualmente el marcador de los 90 minutos." },
        { status: 409 },
      );
    }
    if (isKnockout && (!final.fulltime || (observation.fixture.fixture.status.short === "PEN" && !final.penalty))) {
      return NextResponse.json(
        { error: "API-Football no trae el marcador completo o los penales. Ingresa manualmente el marcador de los 90 minutos." },
        { status: 409 },
      );
    }
    // Los puntos usan el marcador de los 90 minutos (Regla #4).
    home = final.home;
    away = final.away;
    if (isKnockout) {
      fulltimeHome = final.fulltime?.home ?? null;
      fulltimeAway = final.fulltime?.away ?? null;
      penaltyHome = final.penalty?.home ?? null;
      penaltyAway = final.penalty?.away ?? null;
      // Ganador del partido != clasificado por global: solo una tanda decisiva lo define.
      advancer = final.penalty && final.penalty.home !== final.penalty.away
        ? final.penalty.home > final.penalty.away ? "home" : "away"
        : null;
    }
  } else {
    home = parsed.data.home;
    away = parsed.data.away;
  }

  // The admin and automatic verification use the same row lock and scoring transaction.
  const { data: finalized, error: updErr } = await admin.rpc("finalize_verified_match_result", {
    p_match_id: match.id, p_home_score: home, p_away_score: away,
    p_notes: notes,
    p_fulltime_home: fulltimeHome,
    p_fulltime_away: fulltimeAway,
    p_penalty_home: penaltyHome,
    p_penalty_away: penaltyAway,
    p_advancer: advancer,
  });
  if (updErr) {
    console.error("[admin/discrepancies/resolve] update failed:", updErr.message);
    return NextResponse.json({ error: "No se pudo resolver" }, { status: 500 });
  }
  if (finalized !== true) {
    return NextResponse.json({error:"El partido ya fue verificado por otro proceso. Actualiza la lista."},{status:409});
  }

  return NextResponse.json({
    ok: true,
    matchId,
    finalVerifiedAt: verifiedAt,
    appliedScore: { home, away },
  });
}
