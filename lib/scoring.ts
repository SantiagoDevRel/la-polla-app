// lib/scoring.ts — Motor de puntajes en TS.
//
// El trigger `on_match_finished()` en Postgres ya calcula puntos cuando un
// partido pasa a 'finished'. Esto es un reescaneo idempotente en application
// code, útil para:
//   1. Recuperar pollas sembradas/migradas que nunca dispararon el trigger.
//   2. Correr manualmente tras un admin sync (belt-and-suspenders).
//   3. Scripts offline que no van por el trigger.
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculatePoints } from "@/lib/utils/points";

interface MatchRow {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

interface PredictionRow {
  id: string;
  polla_id: string;
  user_id: string;
  predicted_home: number;
  predicted_away: number;
}

interface PollaScoringRow {
  id: string;
  points_exact: number | null;
  points_goal_diff: number | null;
  points_correct_result: number | null;
  points_one_team: number | null;
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
    .select("id, status, home_score, away_score")
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

  const result = { homeScore: match.home_score, awayScore: match.away_score };

  const { data: predictions, error: predErr } = await admin
    .from("predictions")
    .select("id, polla_id, user_id, predicted_home, predicted_away")
    .eq("match_id", matchId)
    .returns<PredictionRow[]>();
  if (predErr) throw predErr;

  if (!predictions || predictions.length === 0) {
    return { matchId, predictionsScored: 0, pollasRecomputed: 0 };
  }

  const pollaIds = Array.from(new Set(predictions.map((p) => p.polla_id)));
  const { data: pollas, error: pollaErr } = await admin
    .from("pollas")
    .select("id, points_exact, points_goal_diff, points_correct_result, points_one_team")
    .in("id", pollaIds)
    .returns<PollaScoringRow[]>();
  if (pollaErr) throw pollaErr;
  const pollaScoring = new Map<string, PollaScoringRow>();
  for (const p of pollas ?? []) pollaScoring.set(p.id, p);

  // 1) Escribir points_earned + visible=true para cada predicción.
  for (const pred of predictions) {
    const scoring = pollaScoring.get(pred.polla_id);
    const pts = calculatePoints(
      { homeScore: pred.predicted_home, awayScore: pred.predicted_away },
      result,
      {
        pointsExact: scoring?.points_exact ?? undefined,
        pointsGoalDiff: scoring?.points_goal_diff ?? undefined,
        pointsCorrectResult: scoring?.points_correct_result ?? undefined,
        pointsOneTeam: scoring?.points_one_team ?? undefined,
      }
    );
    const { error: updErr } = await admin
      .from("predictions")
      .update({ points_earned: pts, visible: true })
      .eq("id", pred.id);
    if (updErr) throw updErr;
  }

  // 2) Recomputar total_points + rank por polla afectada.
  await recomputePollaStandings(admin, pollaIds);

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

    const { data: parts, error: partsErr } = await admin
      .from("polla_participants")
      .select("id, user_id")
      .eq("polla_id", pollaId)
      .returns<{ id: string; user_id: string }[]>();
    if (partsErr) throw partsErr;

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
