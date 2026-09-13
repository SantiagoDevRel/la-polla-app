import { createAdminClient } from '@/lib/supabase/admin';
import { apiFootballGet } from './client';
import { isValidFixture, type ApiFootballFixture } from './mappers';
import { RESULT_LEAGUES, type ResultMatch } from './results';
import { loadFootballDate } from './feed';

export interface DailyResults { fixtures: ApiFootballFixture[]; fetchedAt: string }
export const apiFootballFinalsEnabled = () => process.env.API_FOOTBALL_FINALS_ENABLED === 'true'
  && Boolean(process.env.API_FOOTBALL_KEY);

/** One shared daily feed for all nine leagues, only when a played match needs a result. */
export async function loadDailyResults(matches: ResultMatch[]): Promise<Map<string, DailyResults>> {
  if (!apiFootballFinalsEnabled()) return new Map();
  return loadResultDates(matches);
}

/**
 * 'af' mode (2026-09-13): API-Football is the only result source, so the
 * data_provider_mode switch replaces API_FOOTBALL_FINALS_ENABLED as the gate.
 * Same d-1..d window, same shared reservation and 45-minute freshness.
 */
export async function loadAfDailyResults(matches: ResultMatch[]): Promise<Map<string, DailyResults>> {
  if (!process.env.API_FOOTBALL_KEY) return new Map();
  return loadResultDates(matches);
}

async function loadResultDates(matches: ResultMatch[]): Promise<Map<string, DailyResults>> {
  const result = new Map<string, DailyResults>();
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

export interface FixtureObservation { fixture: ApiFootballFixture; fetchedAt: string }

/** API-Football accepts at most 20 ids per /fixtures?ids= request. */
export const FIXTURE_IDS_PER_REQUEST = 20;

const supportedResult = (f: ApiFootballFixture) => Object.values(RESULT_LEAGUES).includes(f.league?.id)
  && Number.isFinite(Date.parse(f.fixture.date)) && Boolean(f.score?.fulltime && f.score?.penalty);

/**
 * Fresh observations by fixture id, for linked rows outside the d-1..d daily
 * window. No new quota path: every id is reserved through the existing
 * reserve_api_football_detail (per-fixture TTL, 6,000/day cap, fixture must be
 * known from a recent calendar feed) and only reserved ids enter a batch. One
 * HTTP request can therefore count up to 20 reservations — it over-counts, it
 * never bypasses the counter. The response also refreshes the detail cache the
 * reservation just marked, so match screens do not wait an hour for new data.
 */
export async function loadFixturesByIds(ids: number[]): Promise<Map<number, FixtureObservation>> {
  const result = new Map<number, FixtureObservation>();
  const wanted = Array.from(new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0)));
  if (!process.env.API_FOOTBALL_KEY || wanted.length === 0) return result;
  const admin = createAdminClient();
  const reserved: number[] = [];
  for (const id of wanted) {
    const {data, error} = await admin.rpc('reserve_api_football_detail', {p_fixture_id: id});
    if (!error && data === true) reserved.push(id);
  }
  // Máximo 2 lotes por tick: sync-live tiene maxDuration 30 s y cada lote
  // puede esperar el timeout de 15 s. Lo reservado y no pedido espera su TTL.
  for (let i = 0; i < reserved.length && i < 2 * FIXTURE_IDS_PER_REQUEST; i += FIXTURE_IDS_PER_REQUEST) {
    const batch = reserved.slice(i, i + FIXTURE_IDS_PER_REQUEST);
    try {
      const raw = await apiFootballGet<unknown>('/fixtures', {ids: batch.join('-')}, {attempts: 1, direct: true});
      const fetchedAt = new Date().toISOString();
      for (const f of raw.filter(isValidFixture).filter(supportedResult)) {
        if (!batch.includes(f.fixture.id) || result.has(f.fixture.id)) continue;
        result.set(f.fixture.id, {fixture: f, fetchedAt});
        await admin.from('api_football_details').update({fixture: f, fetched_at: fetchedAt}).eq('fixture_id', f.fixture.id);
      }
    } catch {
      // The reservations stay counted; never log the Axios error (it carries the key).
      console.warn('[api-football] Fixture ids request unavailable; will retry after the reservation TTL.');
    }
  }
  return result;
}
