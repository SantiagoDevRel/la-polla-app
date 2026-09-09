import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiFootballGet } from './client';
import { apiFootballProActive } from './account';
import { isValidFixture, type ApiFootballFixture } from './mappers';
import { RESULT_LEAGUES, findResultFixture, type ResultMatch } from './results';

export interface FootballFeed {fixtures: ApiFootballFixture[]; fetchedAt: string; stale: boolean}
const supported = (f: ApiFootballFixture) => Object.values(RESULT_LEAGUES).includes(f.league?.id)
  && Number.isSafeInteger(f.teams.home.id) && Number.isSafeInteger(f.teams.away.id)
  && Number.isFinite(Date.parse(f.fixture.date)) && Boolean(f.score?.fulltime && f.score?.penalty);

/** Every screen and result check uses the same date feed and atomic quota reservation. */
export async function loadFootballDate(date: string): Promise<FootballFeed | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return null;
  if (Math.abs(Date.parse(date) - Date.parse(new Date().toISOString().slice(0,10))) > 7*86400000) return null;
  await apiFootballProActive();
  const admin = createAdminClient();
  const {data: reserved, error} = await admin.rpc('reserve_api_football_request', {p_fixture_date: date});
  if (error) return null;
  if (reserved === true) {
    try {
      const raw = await apiFootballGet<unknown>('/fixtures', {date}, {attempts: 1, direct: true});
      const fixtures = raw.filter(isValidFixture).filter(supported);
      const fetchedAt = new Date().toISOString();
      const {error: writeError} = await admin.from('api_football_cache')
        .update({fixtures, fetched_at: fetchedAt}).eq('fixture_date', date);
      if (!writeError) return {fixtures, fetchedAt, stale: false};
    } catch { /* A failed request consumed its reservation; keep a clearly dated cached response. */ }
  }
  const {data} = await admin.from('api_football_cache').select('fixtures,fetched_at').eq('fixture_date', date).maybeSingle();
  if (!data?.fetched_at || !Array.isArray(data.fixtures)) return null;
  return {fixtures: data.fixtures.filter(isValidFixture).filter(supported), fetchedAt: data.fetched_at,
    stale: Date.now() - Date.parse(data.fetched_at) > 180_000};
}

export async function findFootballFixture(match: ResultMatch): Promise<ApiFootballFixture | null> {
  const date = new Date(match.scheduled_at).toISOString().slice(0,10);
  const feed = await loadFootballDate(date);
  return feed ? findResultFixture(match, feed.fixtures) : null;
}

export async function knownFootballFixture(id: number): Promise<ApiFootballFixture | null> {
  return (await knownFootballObservation(id))?.fixture??null;
}

export async function knownFootballObservation(id: number): Promise<{fixture:ApiFootballFixture;fetchedAt:string}|null> {
  const admin = createAdminClient();
  const from = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const {data} = await admin.from('api_football_cache').select('fixtures,fetched_at')
    .gte('fixture_date', from).contains('fixtures', JSON.stringify([{fixture: {id}}]))
    .order('fetched_at', {ascending: false}).limit(1).maybeSingle();
  const {data: club}=await admin.from('api_football_teams').select('matches,fetched_at')
    .contains('matches',JSON.stringify([{fixture:{id}}])).gte('fetched_at',new Date(Date.now()-2*86400000).toISOString())
    .order('fetched_at',{ascending:false}).limit(1).maybeSingle();
  const observations=[{fixtures:data?.fixtures,fetchedAt:data?.fetched_at},{fixtures:club?.matches,fetchedAt:club?.fetched_at}]
    .filter(d=>d.fetchedAt&&Array.isArray(d.fixtures)).sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt));
  for(const observation of observations){
    const fixture=observation.fixtures.filter(isValidFixture).find((f:ApiFootballFixture)=>f.fixture.id===id&&supported(f));
    if(fixture)return {fixture,fetchedAt:observation.fetchedAt};
  }
  return null;
}
