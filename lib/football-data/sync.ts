// lib/football-data/sync.ts — Sync de partidos desde football-data.org a Supabase
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCompetitionMatches, rateLimitDelay, FDMatch } from "./client";

// Competiciones activas — slug must match what crear polla + pollas table use
const COMPETITIONS = [
  { id: 2001, tournament: "champions_2025", label: "Champions League" },
  { id: 2000, tournament: "worldcup_2026", label: "FIFA World Cup 2026" },
  { id: 2014, tournament: "laliga_2025", label: "La Liga" },
  { id: 2021, tournament: "premier_2025", label: "Premier League" },
  { id: 2019, tournament: "seriea_2025", label: "Serie A" },
];

function mapStatus(fdStatus: string): "scheduled" | "live" | "finished" | "cancelled" {
  switch (fdStatus) {
    case "SCHEDULED":
    case "TIMED":
      return "scheduled";
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    case "FINISHED":
    case "AWARDED":
      return "finished";
    case "POSTPONED":
    case "CANCELLED":
    case "SUSPENDED":
      return "cancelled";
    default:
      return "scheduled";
  }
}

function mapPhase(stage: string): string {
  const map: Record<string, string> = {
    GROUP_STAGE: "group_stage",
    LEAGUE_STAGE: "league_stage",
    ROUND_OF_16: "round_of_16",
    QUARTER_FINALS: "quarter_finals",
    SEMI_FINALS: "semi_finals",
    FINAL: "final",
    THIRD_PLACE: "third_place",
    LAST_16: "round_of_16",
    LAST_32: "round_of_32",
    PLAYOFF: "playoff",
    REGULAR_SEASON: "regular_season",
  };
  return map[stage] || stage.toLowerCase().replace(/[\s-]+/g, "_");
}

function mapMatchToRow(match: FDMatch, tournament: string) {
  return {
    external_id: String(match.id),
    tournament,
    match_day: match.matchday,
    phase: mapPhase(match.stage),
    home_team: match.homeTeam.name,
    away_team: match.awayTeam.name,
    home_team_flag: match.homeTeam.crest || null,
    away_team_flag: match.awayTeam.crest || null,
    scheduled_at: match.utcDate,
    venue: match.venue || null,
    home_score: match.score?.fullTime?.home ?? null,
    away_score: match.score?.fullTime?.away ?? null,
    status: mapStatus(match.status),
    // Current minute while the match is live. football-data serves
    // this at the top level on IN_PLAY / PAUSED states; null otherwise.
    elapsed: match.minute ?? null,
  };
}

export async function syncCompetition(
  competitionId: number,
  tournament: string,
  statusFilter?: string,
  dateFrom?: string,
  dateTo?: string
): Promise<{ synced: number; errors: number; total: number }> {
  console.log(`[sync] Sincronizando competition=${competitionId} → tournament="${tournament}"`);

  let matches: FDMatch[];
  try {
    matches = await fetchCompetitionMatches(competitionId, statusFilter, dateFrom, dateTo);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sync] Error fetching competition ${competitionId}: ${msg}`);
    return { synced: 0, errors: 1, total: 0 };
  }

  if (matches.length === 0) {
    console.warn(`[sync] No hay partidos para competition ${competitionId}`);
    return { synced: 0, errors: 0, total: 0 };
  }

  const supabase = createAdminClient();
  let synced = 0;
  let errors = 0;

  for (const match of matches) {
    const row = mapMatchToRow(match, tournament);

    try {
      // Usamos la función Postgres `upsert_match_safe` que respeta el
      // candado live_updated_at. Si ESPN escribió hace <10 min, los
      // campos status/home_score/away_score/elapsed se preservan y
      // football-data solo refresca metadata (teams, flags, kickoff,
      // phase). En INSERT nuevo o cuando ESPN está silencioso, escribe
      // todo normal. Migration 027 define la función.
      const { error } = await supabase.rpc("upsert_match_safe", {
        p_external_id: row.external_id,
        p_tournament: row.tournament,
        p_match_day: row.match_day,
        p_phase: row.phase,
        p_home_team: row.home_team,
        p_away_team: row.away_team,
        p_home_team_flag: row.home_team_flag,
        p_away_team_flag: row.away_team_flag,
        p_scheduled_at: row.scheduled_at,
        p_venue: row.venue,
        p_home_score: row.home_score,
        p_away_score: row.away_score,
        p_status: row.status,
        p_elapsed: row.elapsed,
      });

      if (error) {
        console.error(`[sync] Error upsert match ${row.external_id}: ${error.message}`);
        errors++;
      } else {
        synced++;
      }
    } catch (err) {
      console.error(`[sync] Error inesperado match ${row.external_id}:`, err);
      errors++;
    }
  }

  console.log(`[sync] Competition ${competitionId}: ${synced} synced, ${errors} errors, ${matches.length} total`);
  return { synced, errors, total: matches.length };
}

export async function syncAllCompetitions(): Promise<
  Record<string, { synced: number; errors: number; total: number }>
> {
  const results: Record<string, { synced: number; errors: number; total: number }> = {};

  for (const comp of COMPETITIONS) {
    try {
      results[comp.tournament] = await syncCompetition(comp.id, comp.tournament);
    } catch (err) {
      console.error(`[sync] Error fatal syncing ${comp.label}:`, err);
      results[comp.tournament] = { synced: 0, errors: 1, total: 0 };
    }
    await rateLimitDelay();
  }

  return results;
}

/**
 * Sync "recent" window only: partidos con fecha entre (now - hoursBack) y (now + hoursAhead).
 * Usa el filtro dateFrom/dateTo de football-data para mantener el payload chico.
 * Pensado para correr lazy cuando un usuario activo pide leaderboard o predicciones.
 */
export async function syncRecentCompetitions(
  hoursBack = 3,
  hoursAhead = 1
): Promise<Record<string, { synced: number; errors: number; total: number }>> {
  const now = new Date();
  const from = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  const to = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  // football-data acepta dateFrom/dateTo en formato YYYY-MM-DD.
  // Redondeamos al dia UTC para cubrir la ventana completa.
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const results: Record<string, { synced: number; errors: number; total: number }> = {};

  for (const comp of COMPETITIONS) {
    try {
      results[comp.tournament] = await syncCompetition(
        comp.id,
        comp.tournament,
        undefined,
        fromDate,
        toDate
      );
    } catch (err) {
      console.error(`[sync-recent] Error fatal syncing ${comp.label}:`, err);
      results[comp.tournament] = { synced: 0, errors: 1, total: 0 };
    }
    await rateLimitDelay();
  }

  return results;
}

export { COMPETITIONS };
