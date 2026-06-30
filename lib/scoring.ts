// lib/scoring.ts — Motor de puntajes en TS.
//
// El trigger `on_match_finished()` en Postgres ya calcula puntos cuando un
// partido pasa a 'finished'. Esto es un reescaneo idempotente en application
// code, útil para:
//   1. Recuperar pollas sembradas/migradas que nunca dispararon el trigger.
//   2. Correr manualmente tras un admin sync (belt-and-suspenders).
//   3. Scripts offline que no van por el trigger.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculatePoints,
  phaseScoreMultiplier,
  effectiveResult,
  advanceBonus,
  type ScoringMode,
  type MatchOutcome,
  type KnockoutScoring,
} from "@/lib/utils/points";
import { notifyMatchFinished, notifyRankImprovements } from "@/lib/notifications";

interface MatchRow {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string | null;
  phase: string | null;
  fulltime_home_score: number | null;
  fulltime_away_score: number | null;
  advancer: "home" | "away" | null;
}

interface PredictionRow {
  id: string;
  polla_id: string;
  user_id: string;
  predicted_home: number;
  predicted_away: number;
  advance_pick: "home" | "away" | null;
}

interface PollaScoringRow {
  id: string;
  points_exact: number | null;
  points_goal_diff: number | null;
  points_correct_result: number | null;
  points_one_team: number | null;
  scoring_mode: string | null;
  scoring_mode_changed_at: string | null;
  double_from_octavos: boolean | null;
  score_120: boolean | null;
  advance_bonus: boolean | null;
  kc_mode_changed_at: string | null;
  advance_bonus_from: string | null;
}

export interface ScoreMatchResult {
  matchId: string;
  predictionsScored: number;
  pollasRecomputed: number;
  skipped?: string;
}

export async function scoreMatch(
  matchId: string,
  admin: SupabaseClient
): Promise<ScoreMatchResult> {
  const { data: match, error: matchErr } = await admin
    .from("matches")
    .select("id, status, home_score, away_score, scheduled_at, phase, fulltime_home_score, fulltime_away_score, advancer")
    .eq("id", matchId)
    .maybeSingle<MatchRow>();
  if (matchErr) throw matchErr;

  if (!match) return { matchId, predictionsScored: 0, pollasRecomputed: 0, skipped: "not_found" };
  if (match.status !== "finished") {
    return { matchId, predictionsScored: 0, pollasRecomputed: 0, skipped: `status=${match.status}` };
  }
  if (match.home_score == null || match.away_score == null) {
    return { matchId, predictionsScored: 0, pollasRecomputed: 0, skipped: "null_score" };
  }

  // matchOutcome lleva 90' + 120' + avance; el marcador efectivo a usar
  // depende del modo de CADA polla (score_120 es por-polla), así que se
  // resuelve dentro del loop por predicción. Ver lib/utils/points.ts.
  const matchOutcome: MatchOutcome = {
    homeScore: match.home_score,
    awayScore: match.away_score,
    fulltimeHome: match.fulltime_home_score,
    fulltimeAway: match.fulltime_away_score,
    advancer: match.advancer,
    scheduledAt: match.scheduled_at,
    phase: match.phase,
  };

  const { data: predictions, error: predErr } = await admin
    .from("predictions")
    .select("id, polla_id, user_id, predicted_home, predicted_away, advance_pick")
    .eq("match_id", matchId)
    .returns<PredictionRow[]>();
  if (predErr) throw predErr;

  if (!predictions || predictions.length === 0) {
    return { matchId, predictionsScored: 0, pollasRecomputed: 0 };
  }

  const pollaIds = Array.from(new Set(predictions.map((p) => p.polla_id)));
  const { data: pollas, error: pollaErr } = await admin
    .from("pollas")
    .select("id, points_exact, points_goal_diff, points_correct_result, points_one_team, scoring_mode, scoring_mode_changed_at, double_from_octavos, score_120, advance_bonus, kc_mode_changed_at, advance_bonus_from")
    .in("id", pollaIds)
    .returns<PollaScoringRow[]>();
  if (pollaErr) throw pollaErr;
  const pollaScoring = new Map<string, PollaScoringRow>();
  for (const p of pollas ?? []) pollaScoring.set(p.id, p);

  // 1) Escribir points_earned + visible=true para cada predicción.
  for (const pred of predictions) {
    const scoring = pollaScoring.get(pred.polla_id);
    // No-retroactivo: goles_v2 solo si el kickoff del match es >= el momento
    // en que la polla cambió de modo. El pasado conserva su puntaje classic.
    const useV2 =
      scoring?.scoring_mode === "goles_v2" &&
      !!scoring.scoring_mode_changed_at &&
      !!match.scheduled_at &&
      new Date(match.scheduled_at) >= new Date(scoring.scoring_mode_changed_at);
    // Modo 120' + avance (migración 077): score_120 cambia la fuente del
    // marcador (120' vs 90'); advance_bonus suma +1 plano. Por-polla.
    const kc: KnockoutScoring = {
      score120: scoring?.score_120,
      advanceBonus: scoring?.advance_bonus,
      kcModeChangedAt: scoring?.kc_mode_changed_at,
      advanceBonusFrom: scoring?.advance_bonus_from,
    };
    const basePts = calculatePoints(
      { homeScore: pred.predicted_home, awayScore: pred.predicted_away },
      effectiveResult(matchOutcome, kc),
      {
        pointsExact: scoring?.points_exact ?? undefined,
        pointsGoalDiff: scoring?.points_goal_diff ?? undefined,
        pointsCorrectResult: scoring?.points_correct_result ?? undefined,
        pointsOneTeam: scoring?.points_one_team ?? undefined,
      },
      (useV2 ? "goles_v2" : "classic") as ScoringMode
    );
    // Doble desde octavos: envuelve el scorer base (octavos+ = base x2 si la
    // polla aprobó la encuesta 074). El +1 de avance va POR FUERA del x2
    // (plano). Debe coincidir con public.score_match (migración 077).
    const pts =
      basePts * phaseScoreMultiplier(match.phase, scoring?.double_from_octavos) +
      advanceBonus(pred.advance_pick, matchOutcome, kc);
    const { error: updErr } = await admin
      .from("predictions")
      .update({ points_earned: pts, visible: true })
      .eq("id", pred.id);
    if (updErr) throw updErr;
  }

  // 2) Recomputar total_points + rank por polla afectada (con notificación
  //    de subidas de ranking incluida).
  await recomputePollaStandings(admin, pollaIds);

  // 3) Notificar a los participantes de que el partido finalizó.
  await notifyMatchFinished(admin, matchId);

  return {
    matchId,
    predictionsScored: predictions.length,
    pollasRecomputed: pollaIds.length,
  };
}

export async function recomputePollaStandings(
  admin: SupabaseClient,
  pollaIds: string[]
): Promise<void> {
  for (const pollaId of pollaIds) {
    const { data: preds, error: predErr } = await admin
      .from("predictions")
      .select("user_id, points_earned")
      .eq("polla_id", pollaId)
      .returns<{ user_id: string; points_earned: number }[]>();
    if (predErr) throw predErr;

    const totals = new Map<string, number>();
    for (const p of preds ?? []) {
      totals.set(p.user_id, (totals.get(p.user_id) ?? 0) + (p.points_earned ?? 0));
    }

    // Universal paid=true filter for standings. For pay_winner every row is
    // paid=true by default so this is a no-op; for admin_collects paid=true
    // means the organizer approved the comprobante. Unpaid rows must never
    // appear in the leaderboard because they have not really joined yet.
    const { data: parts, error: partsErr } = await admin
      .from("polla_participants")
      .select("id, user_id, rank")
      .eq("polla_id", pollaId)
      .eq("paid", true)
      .returns<{ id: string; user_id: string; rank: number | null }[]>();
    if (partsErr) throw partsErr;

    // Snapshot previous ranks for rank-up notifications. Skip null/0 so
    // brand-new participants don't trigger a "you moved up" ping.
    const previousRanks = new Map<string, number>();
    for (const p of parts ?? []) {
      if (p.rank && p.rank > 0) previousRanks.set(p.id, p.rank);
    }

    interface Standing { id: string; total_points: number; rank: number; }
    const sorted: Standing[] = (parts ?? [])
      .map((p) => ({ id: p.id, total_points: totals.get(p.user_id) ?? 0, rank: 0 }))
      .sort((a, b) => b.total_points - a.total_points);

    // Rank: standard competition ranking (ties share, next skips).
    let currentRank = 0;
    let lastPts = Number.NaN;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].total_points !== lastPts) {
        currentRank = i + 1;
        lastPts = sorted[i].total_points;
      }
      sorted[i].rank = currentRank;
    }

    for (const row of sorted) {
      const { error: upErr } = await admin
        .from("polla_participants")
        .update({ total_points: row.total_points, rank: row.rank })
        .eq("id", row.id);
      if (upErr) throw upErr;
    }

    // Map standings back to user_id for the notification.
    const userIdById = new Map<string, string>();
    for (const p of parts ?? []) userIdById.set(p.id, p.user_id);
    const newStandings = sorted.map((s) => ({
      id: s.id,
      user_id: userIdById.get(s.id) ?? "",
      rank: s.rank,
    }));
    await notifyRankImprovements(admin, pollaId, previousRanks, newStandings);
  }
}

/**
 * Idempotent backfill: scoreMatch for every finished match that has at
 * least one prediction. Used by the admin "Sync" button and the CLI script.
 * Safe to call repeatedly — recomputes from scratch.
 */
export async function scoreAllFinishedMatches(
  admin: SupabaseClient
): Promise<ScoreMatchResult[]> {
  const { data: finishedMatches, error: mErr } = await admin
    .from("matches")
    .select("id")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .returns<{ id: string }[]>();
  if (mErr) throw mErr;

  const out: ScoreMatchResult[] = [];
  for (const m of finishedMatches ?? []) {
    const { count } = await admin
      .from("predictions")
      .select("id", { head: true, count: "exact" })
      .eq("match_id", m.id);
    if ((count ?? 0) === 0) continue;
    out.push(await scoreMatch(m.id, admin));
  }
  return out;
}
