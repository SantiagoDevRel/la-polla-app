import "server-only";
import { HIGHLIGHT_LEAGUES, highlightQueryDays, matchHighlightEvent, youtubeVideoId, type HighlightMatch, type PollaHighlight, type SportsVideoEvent } from "./matching";

/** Production is opt-in and requires a paid key; free 123 is development only. */
export function highlightsApiKey(): string | null {
  if (process.env.SPORTSDB_HIGHLIGHTS_ENABLED !== "true") return null;
  const key = process.env.SPORTSDB_API_KEY?.trim();
  if (key && /^[a-zA-Z0-9_-]+$/.test(key) && key !== "123") return key;
  return process.env.NODE_ENV === "development" ? "123" : null;
}

// Coalesce simultaneous home/pool requests within one worker. Persistent
// Next fetch caching below shares public metadata across requests/users.
const pending = new Map<string, Promise<SportsVideoEvent[]>>();

async function eventsForDay(key: string, league: string, day: string, deadline: AbortSignal): Promise<SportsVideoEvent[]> {
  const cacheKey = `${league}:${day}:${key}`;
  const previous = pending.get(cacheKey);
  if (previous) return previous;
  const request = (async () => {
    const url = `https://www.thesportsdb.com/api/v1/json/${key}/eventsday.php?d=${day}&l=${league}`;
    const res = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.any([deadline, AbortSignal.timeout(7000)]) });
    if (!res.ok) throw new Error("Highlight provider unavailable"); // Never log a URL containing the key.
    const body = await res.json();
    if (body.events === null) return [];
    if (!Array.isArray(body.events)) throw new Error("Invalid highlight response");
    return body.events.filter((e: Partial<SportsVideoEvent>) => e && typeof e.idEvent === "string"
      && typeof e.idLeague === "string" && typeof e.strHomeTeam === "string" && typeof e.strAwayTeam === "string"
      && typeof e.strStatus === "string") as SportsVideoEvent[];
  })();
  pending.set(cacheKey, request);
  try { return await request; } finally { pending.delete(cacheKey); }
}

async function videoChannel(videoId: string, deadline: AbortSignal): Promise<string | null> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const response = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]) });
  if (response.status === 404 || response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Video metadata unavailable");
  const body = await response.json();
  return body.type === "video" && typeof body.author_name === "string" ? body.author_name.slice(0, 100) : null;
}

export async function fetchPollaHighlights(matches: HighlightMatch[], key: string): Promise<{ videos: PollaHighlight[]; partial: boolean }> {
  const deadline = AbortSignal.timeout(15_000);
  const queries = new Map<string, { league: string; day: string }>();
  for (const match of matches) {
    const league = HIGHLIGHT_LEAGUES[match.tournament];
    if (league) for (const day of highlightQueryDays(match)) queries.set(`${league}:${day}`, { league, day });
  }
  let partial = false;
  const events: SportsVideoEvent[] = [];
  // Two concurrent calls; querying by today's published pool fixtures bounds
  // volume. No searches per viewer, unbounded dates, cron or video proxy.
  const all = [...queries.values()];
  for (let i = 0; i < all.length; i += 2) {
    const batch = await Promise.allSettled(all.slice(i, i + 2).map(q => eventsForDay(key, q.league, q.day, deadline)));
    for (const result of batch) {
      if (result.status === "fulfilled") events.push(...result.value);
      else partial = true;
    }
  }
  const candidates = matches.flatMap(match => {
    const event = matchHighlightEvent(match, events);
    const videoId = youtubeVideoId(event?.strVideo);
    return videoId ? [{ match, videoId }] : [];
  });
  const videos: PollaHighlight[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(candidates.slice(i, i + 4).map(async ({ match, videoId }) => {
      if (seen.has(videoId)) return;
      seen.add(videoId);
      try {
        const channel = await videoChannel(videoId, deadline);
        if (channel) videos.push({ matchId: match.id, title: `${match.home_team} vs. ${match.away_team}`, scheduledAt: match.scheduled_at, videoId, channel });
      } catch { partial = true; }
    }));
  }
  videos.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt) || a.matchId.localeCompare(b.matchId));
  return { videos, partial };
}
