// lib/football-data/client.ts — Cliente para football-data.org API v4
// Free tier: 10 requests/min, covers UCL and La Liga
import axios from "axios";

const BASE_URL = "https://api.football-data.org/v4";

function getHeaders() {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error("Falta FOOTBALL_DATA_API_KEY en variables de entorno");
  return { "X-Auth-Token": key };
}

export interface FDMatch {
  id: number;
  utcDate: string;
  status: string; // SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, POSTPONED, CANCELLED, SUSPENDED, AWARDED
  matchday: number | null;
  stage: string; // GROUP_STAGE, ROUND_OF_16, QUARTER_FINALS, etc.
  homeTeam: { id: number; name: string; crest: string };
  awayTeam: { id: number; name: string; crest: string };
  score: {
    fullTime: { home: number | null; away: number | null };
  };
  competition: { id: number; name: string };
  venue: string | null;
}

interface FDResponse {
  matches: FDMatch[];
  resultSet?: { count: number };
}

/**
 * Fetch matches from football-data.org for a competition.
 * Respects rate limits with a built-in delay.
 */
export async function fetchCompetitionMatches(
  competitionId: number,
  status?: string,
  dateFrom?: string,
  dateTo?: string
): Promise<FDMatch[]> {
  const params: Record<string, string> = {};
  if (status) params.status = status;
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;

  const tag = [
    status ? `status=${status}` : null,
    dateFrom ? `dateFrom=${dateFrom}` : null,
    dateTo ? `dateTo=${dateTo}` : null,
  ].filter(Boolean).join(" ");
  console.log(`[football-data] Fetching competition ${competitionId}${tag ? ` (${tag})` : ""}...`);

  try {
    const { data } = await axios.get<FDResponse>(
      `${BASE_URL}/competitions/${competitionId}/matches`,
      { headers: getHeaders(), params, timeout: 15000 }
    );

    console.log(`[football-data] Competition ${competitionId}: ${data.matches?.length || 0} partidos`);
    return data.matches || [];
  } catch (err) {
    const axiosErr = err as { response?: { status?: number; data?: unknown } };
    console.error(`[football-data] Error fetching competition ${competitionId}:`, axiosErr.response?.status, JSON.stringify(axiosErr.response?.data));
    throw err;
  }
}

/** 200ms delay to respect rate limits */
export function rateLimitDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}
