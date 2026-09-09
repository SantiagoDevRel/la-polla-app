import { type ApiFootballFixture } from './mappers';
import { RESULT_LEAGUES, type ResultMatch } from './results';
import { loadFootballDate } from './feed';

export interface DailyResults { fixtures: ApiFootballFixture[]; fetchedAt: string }
export const apiFootballFinalsEnabled = () => process.env.API_FOOTBALL_FINALS_ENABLED === 'true'
  && Boolean(process.env.API_FOOTBALL_KEY);

/** One shared daily feed for all nine leagues, only when a played match needs a result. */
export async function loadDailyResults(matches: ResultMatch[]): Promise<Map<string, DailyResults>> {
  const result = new Map<string, DailyResults>();
  if (!apiFootballFinalsEnabled()) return result;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
  const dates = Array.from(new Set(matches.filter(m => RESULT_LEAGUES[m.tournament])
    .map(m => new Date(m.scheduled_at).toISOString().slice(0, 10))))
    .filter(d => d === today || d === yesterday).sort();
  for (const date of dates) {
    try {
      const feed=await loadFootballDate(date);
      if (feed && now-Date.parse(feed.fetchedAt)<=45*60000) result.set(date,feed);
    } catch {
      // Never log Axios objects: they carry the secret in request headers.
      console.warn('[api-football] Daily results unavailable; existing verification remains active.');
    }
  }
  return result;
}
