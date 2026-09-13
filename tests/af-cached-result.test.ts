import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';

// Lectura de caché para /admin/discrepancias: nunca pide al proveedor y aplica
// la misma identidad que la verificación automática.
const mocks = vi.hoisted(() => ({ admin: vi.fn(), known: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/api-football/feed', () => ({ knownFootballObservation: mocks.known }));
import { cachedApiFootballResult } from '@/lib/matches/af-cached-result';

const fixture = (over: Partial<ApiFootballFixture['fixture']> = {}, league = 39): ApiFootballFixture => ({
  fixture: { id: 9001, date: '2026-09-09T18:00:00+00:00', venue: null, status: { short: 'FT', long: '', elapsed: 90 }, ...over },
  league: { id: league, name: 'Premier League', round: 'Regular Season - 4' },
  teams: { home: { id: 1, name: 'Arsenal', logo: '' }, away: { id: 2, name: 'Chelsea', logo: '' } },
  goals: { home: 2, away: 1 },
  score: { fulltime: { home: 2, away: 1 }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
});
const match = { tournament: 'premier_2025', home_team: 'Arsenal', away_team: 'Chelsea', scheduled_at: '2026-09-09T18:00:00Z',
  external_id: 'apifootball:9001', source_external_ids: [] as string[] };
const dbFetch = vi.fn<typeof fetch>();
let details: unknown = null;
let daily: unknown = null;

beforeEach(() => {
  vi.resetAllMocks();
  details = null; daily = null;
  mocks.admin.mockImplementation(() => createClient('http://localhost:54321', 'test-key',
    { auth: { persistSession: false }, global: { fetch: dbFetch } }));
  dbFetch.mockImplementation(async input => {
    const url = String(input);
    const body = url.includes('/api_football_details') ? details : url.includes('/api_football_cache') ? daily : null;
    return new Response(body === null ? '' : JSON.stringify(body), { status: body === null ? 406 : 200,
      headers: { 'content-type': 'application/json' } });
  });
});

describe('cachedApiFootballResult', () => {
  it('fila vinculada: devuelve la lectura más reciente entre feed y detalle', async () => {
    mocks.known.mockResolvedValue({ fixture: fixture(), fetchedAt: '2026-09-09T19:00:00Z' });
    details = { fixture: fixture({ status: { short: 'FT', long: 'Match Finished', elapsed: 90 } }), fetched_at: '2026-09-09T20:00:00Z' };
    const r = await cachedApiFootballResult(match);
    expect(r?.fetchedAt).toBe('2026-09-09T20:00:00Z');
    expect(mocks.known).toHaveBeenCalledWith(9001);
    expect(dbFetch.mock.calls.every(c => !String(c[0]).includes('/rpc/'))).toBe(true);
  });

  it('fila vinculada: otra competición u otro saque no cuentan', async () => {
    mocks.known.mockResolvedValue({ fixture: fixture({}, 140), fetchedAt: '2026-09-09T19:00:00Z' });
    expect(await cachedApiFootballResult(match)).toBeNull();
    mocks.known.mockResolvedValue({ fixture: fixture({ date: '2026-09-10T18:00:00+00:00' }), fetchedAt: '2026-09-09T19:00:00Z' });
    expect(await cachedApiFootballResult(match)).toBeNull();
  });

  it('dos ids en la fila no devuelven nada ni leen caché', async () => {
    expect(await cachedApiFootballResult({ ...match, source_external_ids: ['apifootball:777'] })).toBeNull();
    expect(mocks.known).not.toHaveBeenCalled();
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it('fila sin vínculo: busca en el feed del día por nombres, competición y saque', async () => {
    daily = { fixtures: [fixture()], fetched_at: '2026-09-09T20:00:00Z' };
    const unlinked = { ...match, external_id: '551234' };
    expect((await cachedApiFootballResult(unlinked))?.fixture.fixture.id).toBe(9001);
    expect(String(dbFetch.mock.calls[0][0])).toContain('fixture_date=eq.2026-09-09');
    expect(await cachedApiFootballResult({ ...unlinked, home_team: 'Manchester City' })).toBeNull();
    expect(mocks.known).not.toHaveBeenCalled();
  });
});
