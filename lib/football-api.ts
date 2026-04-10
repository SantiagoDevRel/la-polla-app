// lib/football-api.ts — Football-data.org API client for live/today matches
// Base URL: https://api.football-data.org/v4
// Uses FOOTBALL_DATA_API_KEY from environment

const BASE_URL = "https://api.football-data.org/v4";

// Map our tournament IDs to football-data.org competition codes
const TOURNAMENT_TO_CODE: Record<string, string> = {
  worldcup_2026: "WC",
  champions_2025: "CL",
  premier_league: "PL",
  la_liga_2025: "PD",
  seria_a: "SA",
};

// Reverse map: competition code → our tournament ID
const CODE_TO_TOURNAMENT: Record<string, string> = {};
for (const [key, val] of Object.entries(TOURNAMENT_TO_CODE)) {
  CODE_TO_TOURNAMENT[val] = key;
}

export interface FootballMatch {
  id: string;
  home_team: string;
  away_team: string;
  home_team_tla: string;
  away_team_tla: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  status: "live" | "finished" | "scheduled";
  elapsed: number | null;
  tournament: string;
  match_date: string;
}

function mapStatus(apiStatus: string): "live" | "finished" | "scheduled" {
  switch (apiStatus) {
    case "IN_PLAY":
    case "PAUSED":
    case "LIVE":
      return "live";
    case "FINISHED":
      return "finished";
    default:
      return "scheduled";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMatch(m: any): FootballMatch {
  return {
    id: String(m.id),
    home_team: m.homeTeam?.name || "TBD",
    away_team: m.awayTeam?.name || "TBD",
    home_team_tla: m.homeTeam?.tla || "???",
    away_team_tla: m.awayTeam?.tla || "???",
    home_team_flag: m.homeTeam?.crest || null,
    away_team_flag: m.awayTeam?.crest || null,
    home_score: m.score?.fullTime?.home ?? null,
    away_score: m.score?.fullTime?.away ?? null,
    status: mapStatus(m.status),
    elapsed: m.minute ?? null,
    tournament: CODE_TO_TOURNAMENT[m.competition?.code] || m.competition?.code || "unknown",
    match_date: m.utcDate,
  };
}

async function fetchFromApi(endpoint: string): Promise<FootballMatch[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    console.log("[football-api] No API key configured, returning empty");
    return [];
  }

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { "X-Auth-Token": apiKey },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error(`[football-api] ${res.status}: ${res.statusText} for ${endpoint}`);
      return [];
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.matches || []).map((m: any) => mapMatch(m));
  } catch (err) {
    console.error("[football-api] Fetch error:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get currently live matches for given competition codes.
 */
export async function getLiveMatches(tournamentIds: string[]): Promise<FootballMatch[]> {
  const codes = tournamentIds
    .map((t) => TOURNAMENT_TO_CODE[t])
    .filter(Boolean);

  if (codes.length === 0) return [];

  const matches = await fetchFromApi(`/matches?status=LIVE&competitions=${codes.join(",")}`);
  return matches.filter((m) => m.status === "live");
}

/**
 * Get today's matches for given competition codes.
 */
export async function getTodayMatches(tournamentIds: string[]): Promise<FootballMatch[]> {
  const codes = tournamentIds
    .map((t) => TOURNAMENT_TO_CODE[t])
    .filter(Boolean);

  if (codes.length === 0) return [];

  const today = new Date().toISOString().split("T")[0];
  return fetchFromApi(`/matches?dateFrom=${today}&dateTo=${today}&competitions=${codes.join(",")}`);
}

/**
 * Get matches for a specific competition within a date range.
 */
export async function getCompetitionMatches(
  tournamentId: string,
  dateFrom: string,
  dateTo: string
): Promise<FootballMatch[]> {
  const code = TOURNAMENT_TO_CODE[tournamentId];
  if (!code) return [];

  return fetchFromApi(`/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`);
}

export { TOURNAMENT_TO_CODE, CODE_TO_TOURNAMENT };
