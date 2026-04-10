// lib/football-data/sync.ts — Sync de partidos desde football-data.org a Supabase
// Reemplaza el sync de API-Football para obtener fixtures
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCompetitionMatches, rateLimitDelay, FDMatch } from "./client";

// Competiciones activas en produccion
const COMPETITIONS = [
  { id: 2001, tournament: "champions_2025", label: "Champions League" },
  { id: 2000, tournament: "worldcup_2026", label: "FIFA World Cup 2026" },
  { id: 2014, tournament: "la_liga_2025", label: "La Liga" },
  { id: 2021, tournament: "premier_league", label: "Premier League" },
  { id: 2019, tournament: "seria_a", label: "Serie A" },
];

// Mapeo de status de football-data.org a nuestro schema
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

// Mapeo de stage a nuestro formato de phase
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
  };
}

/**
 * Sincroniza todos los partidos de una competicion de football-data.org a Supabase.
 * Usa upsert con external_id como campo de conflicto.
 */
export async function syncCompetition(
  competitionId: number,
  tournament: string,
  statusFilter?: string
): Promise<{ synced: number; errors: number; total: number }> {
  console.log(`[sync] Sincronizando competition=${competitionId} → tournament="${tournament}"`);

  let matches: FDMatch[];
  try {
    matches = await fetchCompetitionMatches(competitionId, statusFilter);
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
      const { error } = await supabase
        .from("matches")
        .upsert(row, { onConflict: "external_id" });

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

/**
 * Sincroniza todas las competiciones activas.
 */
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
    // Rate limit delay between competitions
    await rateLimitDelay();
  }

  return results;
}

export { COMPETITIONS };
