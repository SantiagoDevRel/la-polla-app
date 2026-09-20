import { normalizeResultTeam } from "@/lib/matches/result-identity";
import { colombiaDateKey } from "@/lib/time/colombia";

// IDs verified against TheSportsDB lookup API, 2026-09-20. These map media
// only: this integration never creates fixtures or changes match results.
export const HIGHLIGHT_LEAGUES: Record<string, string> = {
  betplay_2026: "4497", libertadores_2026: "4501", sudamericana_2026: "4724",
  champions_2025: "4480", europa_2026: "4481", premier_2025: "4328",
  laliga_2025: "4335", seriea_2025: "4332", worldcup_2026: "4429",
};

export interface HighlightMatch {
  id: string;
  home_team: string;
  away_team: string;
  tournament: string;
  scheduled_at: string;
  scheduled_at_confirmed: boolean | null;
  status: string;
}

export interface SportsVideoEvent {
  idEvent: string;
  idLeague: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strStatus: string;
  strVideo?: string | null;
}

export interface PollaHighlight {
  matchId: string;
  title: string;
  scheduledAt: string;
  videoId: string;
  channel: string;
}

/** Never trust a provider URL as an iframe source. Rebuild from a valid ID. */
export function youtubeVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    let id: string | null = null;
    if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split("/")[2];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export function colombiaTodayWindow(now = new Date()) {
  const day = colombiaDateKey(now);
  const start = new Date(`${day}T00:00:00-05:00`);
  return { day, start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

/** TheSportsDB's unzoned timestamp is UTC, not the server's local zone. */
function kickoff(event: SportsVideoEvent): number {
  const raw = event.strTimestamp || (event.dateEvent && event.strTime ? `${event.dateEvent}T${event.strTime}` : "");
  if (!raw) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
}

export function highlightQueryDays(match: HighlightMatch): string[] {
  const at = Date.parse(match.scheduled_at);
  if (!Number.isFinite(at)) return [];
  return [...new Set([-2, 0, 2].map(h => new Date(at + h * 3_600_000).toISOString().slice(0, 10)))];
}

/** Both full team identities, league, time and a UNIQUE event must match. */
export function matchHighlightEvent(match: HighlightMatch, events: SportsVideoEvent[]): SportsVideoEvent | null {
  if (match.status !== "finished" || match.scheduled_at_confirmed === false) return null;
  const league = HIGHLIGHT_LEAGUES[match.tournament];
  const home = normalizeResultTeam(match.home_team), away = normalizeResultTeam(match.away_team);
  if (!league || !home || !away) return null;
  const candidates = [...new Map(events.filter(e =>
    e.idLeague === league && ["FT", "AET", "PEN", "AP"].includes(e.strStatus)
    && normalizeResultTeam(e.strHomeTeam) === home && normalizeResultTeam(e.strAwayTeam) === away
    && Math.abs(kickoff(e) - Date.parse(match.scheduled_at)) <= 2 * 3_600_000
  ).map(e => [e.idEvent, e])).values()];
  return candidates.length === 1 ? candidates[0] : null;
}
