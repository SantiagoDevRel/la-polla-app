import { createAdminClient } from '@/lib/supabase/admin';
import { apiFootballGet } from './client';
import { isValidFixture, type ApiFootballFixture } from './mappers';
import { RESULT_LEAGUES, type ResultMatch } from './results';

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
  const admin = createAdminClient();
  for (const date of dates) {
    try {
      const {data: reserved, error: reserveError} = await admin.rpc('reserve_api_football_request', {p_fixture_date: date});
      if (reserveError) throw new Error('Quota reservation unavailable');
      if (reserved === true) {
        // Direct API-Sports, exactly ONE billed request; HTTP failures consume their reservation.
        const raw = await apiFootballGet<unknown>('/fixtures', {date}, {attempts: 1, direct: true});
        const fixtures = raw.filter(isValidFixture).filter(f => Object.values(RESULT_LEAGUES).includes(f.league?.id));
        const fetchedAt = new Date().toISOString();
        const {error} = await admin.from('api_football_cache').update({fixtures, fetched_at: fetchedAt}).eq('fixture_date', date);
        if (error) throw new Error('Result cache write failed');
        result.set(date, {fixtures, fetchedAt});
        continue;
      }
      const {data, error} = await admin.from('api_football_cache').select('fixtures,fetched_at').eq('fixture_date', date).maybeSingle();
      if (error) throw new Error('Result cache read failed');
      // Old responses cannot veto newer sources indefinitely after an outage/quota exhaustion.
      if (data?.fetched_at && now - Date.parse(data.fetched_at) <= 45 * 60000 && Array.isArray(data.fixtures)) {
        result.set(date, {fixtures: data.fixtures.filter(isValidFixture), fetchedAt: data.fetched_at});
      }
    } catch {
      // Never log Axios objects: they carry the secret in request headers.
      console.warn('[api-football] Daily results unavailable; existing verification remains active.');
    }
  }
  return result;
}
