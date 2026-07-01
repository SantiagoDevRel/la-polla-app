// app/api/admin/discrepancies/[matchId]/route.ts
//
// POST — resuelve la discrepancia escogiendo qué fuente es la
// verdadera (o pasando un score manual).
//
// Body shape:
//   { source: 'espn',     home: number, away: number }   // confirma ESPN
//   { source: 'fd' }                                      // mantiene los scores actuales (de football-data)
//   { source: 'manual',   home: number, away: number }   // override manual
//
// Importante: el trigger SQL de scoring dispara en UPDATE OF status,
// final_verified_at — al setear final_verified_at=NOW() se ejecuta
// trigger_score_predictions automáticamente, así que no hace falta
// llamar nada adicional. Si los scores cambian, el trigger ya los lee
// del row updated.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin, getAuthenticatedUser } from "@/lib/auth/admin";
import { fetchKnockoutExtras } from "@/lib/espn/knockout-extras";
import { KNOCKOUT_PHASES } from "@/lib/utils/points";

const BodySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("espn"),
    home: z.number().int().nonnegative(),
    away: z.number().int().nonnegative(),
  }),
  z.object({
    source: z.literal("fd"),
  }),
  z.object({
    source: z.literal("manual"),
    home: z.number().int().nonnegative(),
    away: z.number().int().nonnegative(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: { matchId: string } },
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

  // Obtener el match para diagnóstico + status check.
  const { data: match, error: matchErr } = await admin
    .from("matches")
    .select("id, status, home_score, away_score, final_verified_at, final_verification_notes, tournament, phase, home_team, away_team, scheduled_at, espn_id")
    .eq("id", params.matchId)
    .maybeSingle();
  if (matchErr || !match) {
    return NextResponse.json({ error: "Match no encontrado" }, { status: 404 });
  }
  if (match.status !== "finished") {
    return NextResponse.json(
      { error: `El match no está finished (status=${match.status}). No se puede resolver una discrepancia que aún no terminó.` },
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

  const updates: {
    final_verified_at: string;
    final_verification_notes: string;
    home_score?: number;
    away_score?: number;
    fulltime_home_score?: number | null;
    fulltime_away_score?: number | null;
    penalty_home?: number | null;
    penalty_away?: number | null;
    advancer?: "home" | "away" | null;
  } = {
    final_verified_at: verifiedAt,
    final_verification_notes: `${adminNote} via /admin/discrepancias source=${parsed.data.source} at=${verifiedAt}`,
  };

  if (parsed.data.source === "espn" || parsed.data.source === "manual") {
    updates.home_score = parsed.data.home;
    updates.away_score = parsed.data.away;
  }
  // source === 'fd' → no tocamos scores, ya están escritos.

  // Knockout: el 120'/penales/avance (para score_match, disparado por
  // final_verified_at) se resuelve según la fuente que eligió el admin.
  // Migración 077.
  if (match.phase && KNOCKOUT_PHASES.has(match.phase)) {
    if (parsed.data.source === "espn") {
      // El admin CONFIRMÓ ESPN → capturamos sus extras (par atómico; si falla
      // el scorer degrada al 90'/avance derivado).
      const extras = await fetchKnockoutExtras(match.tournament, {
        espn_id: match.espn_id,
        scheduled_at: match.scheduled_at,
        home_team: match.home_team,
        away_team: match.away_team,
      });
      if (extras) {
        if (
          extras.fulltime_home_score !== null &&
          extras.fulltime_away_score !== null
        ) {
          updates.fulltime_home_score = extras.fulltime_home_score;
          updates.fulltime_away_score = extras.fulltime_away_score;
        }
        if (extras.penalty_home !== null && extras.penalty_away !== null) {
          updates.penalty_home = extras.penalty_home;
          updates.penalty_away = extras.penalty_away;
        }
        if (extras.advancer !== null) updates.advancer = extras.advancer;
      }
    } else {
      // 'manual'/'fd': el admin RECHAZÓ ESPN. Limpiamos cualquier extra de ESPN
      // que verify-final haya escrito ANTES de la discrepancia — si no, el
      // scorer usaría un 120'/avance stale de ESPN en vez de la fuente elegida.
      // Cae al 90'/avance derivado del marcador. (codex)
      updates.fulltime_home_score = null;
      updates.fulltime_away_score = null;
      updates.penalty_home = null;
      updates.penalty_away = null;
      updates.advancer = null;
    }
  }

  const { error: updErr } = await admin
    .from("matches")
    .update(updates)
    .eq("id", params.matchId);
  if (updErr) {
    console.error("[admin/discrepancies/resolve] update failed:", updErr);
    return NextResponse.json({ error: "No se pudo resolver" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    matchId: params.matchId,
    finalVerifiedAt: verifiedAt,
    appliedScore: {
      home: updates.home_score ?? match.home_score,
      away: updates.away_score ?? match.away_score,
    },
  });
}
