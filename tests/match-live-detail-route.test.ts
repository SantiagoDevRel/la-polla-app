import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// /api/matches/[id]/live (detalle por UUID para pollas y LiveMatchPopup) solo
// desde API-Football, 2026-09-13. Auth primero; forma compatible con sus dos
// consumidores: FootballMatchDetail (match + summary) y LiveMatchPopup (summary).
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), detail: vi.fn(), feed: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/api-football/details', () => ({ loadFootballDetail: mocks.detail }));
vi.mock('@/lib/api-football/feed', () => ({ loadFootballDate: mocks.feed }));
import { GET } from '@/app/api/matches/[id]/live/route';

const ID = '00000000-0000-4000-8000-000001635643';
const call = (id = ID) => GET(new NextRequest(`http://localhost/api/matches/${id}/live`), { params: Promise.resolve({ id }) });
const selects: string[] = [];
const row = (over: Record<string, unknown> = {}) => ({
  id: ID, tournament: 'champions_2025', home_team: 'Club Brugge KV', away_team: 'Aston Villa',
  scheduled_at: '2026-09-08T16:45:00+00:00', external_id: 'apifootball:1635643', source_external_ids: [], ...over,
});
const withRow = (data: unknown) => mocks.from.mockReturnValue({
  select: (cols: string) => { selects.push(cols); return { eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }; },
});
const detail = (tournament = 'champions_2025') => ({
  match: { id: 1635643, tournament, home: { id: 569, name: 'Club Brugge KV', logo: '' }, away: { id: 66, name: 'Aston Villa', logo: '' } },
  summary: { timeline: [], stats: [{ key: 'totalShots', label: 'Total Shots', home: '5', away: '7' }], lineups: [] },
  players: { home: [], away: [] }, coaches: { home: null, away: null }, fetchedAt: '2026-09-08T18:00:00Z', stale: false, source: 'api-football',
});
const fixture = (id: number, league = 2) => ({
  fixture: { id, date: '2026-09-08T16:45:00+00:00' }, league: { id: league },
  teams: { home: { id: 569, name: 'Club Brugge KV' }, away: { id: 66, name: 'Aston Villa' } },
});

beforeEach(() => {
  vi.clearAllMocks(); selects.length = 0;
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in detail tests'); }));
});

describe('GET /api/matches/[id]/live', () => {
  it('rejects anonymous users before reading the match', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await call()).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('validates the match UUID before touching the database', async () => {
    expect((await call('not-a-uuid')).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('reads explicit columns and returns 404 for an unknown match', async () => {
    withRow(null);
    expect((await call()).status).toBe(404);
    expect(selects[0]).not.toContain('*');
    expect(selects[0]).toContain('source_external_ids');
  });

  it('serves the linked fixture detail with match and summary, never cached', async () => {
    withRow(row());
    mocks.detail.mockResolvedValue(detail());
    const res = await call();
    expect(mocks.detail).toHaveBeenCalledWith(1635643);
    expect(mocks.feed).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.match.home.name).toBe('Club Brugge KV');
    expect(body.summary.stats[0].key).toBe('totalShots');
    expect(body.source).toBe('api-football');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the link stored in source_external_ids for rows written by an older provider', async () => {
    withRow(row({ external_id: 'espn:740001', source_external_ids: ['espn:740001', 'apifootball:1635643'] }));
    mocks.detail.mockResolvedValue(detail());
    await call();
    expect(mocks.detail).toHaveBeenCalledWith(1635643);
  });

  it('discovers an uncached linked fixture through its date feed', async () => {
    withRow(row());
    mocks.detail.mockResolvedValueOnce(null).mockResolvedValueOnce(detail());
    mocks.feed.mockResolvedValue({ fixtures: [fixture(1635643)], fetchedAt: '', stale: false });
    const body = await (await call()).json();
    expect(mocks.feed).toHaveBeenCalledWith('2026-09-08');
    expect(mocks.detail).toHaveBeenLastCalledWith(1635643);
    expect(body.match.id).toBe(1635643);
  });

  it('matches an unlinked row only by strict team, competition and kickoff identity', async () => {
    withRow(row({ external_id: 'legacy-1', home_team: 'Club Brugge KV', away_team: 'Aston Villa' }));
    mocks.feed.mockResolvedValue({ fixtures: [fixture(1635643, 3), fixture(1635650)], fetchedAt: '', stale: false });
    mocks.detail.mockResolvedValue(detail());
    await call();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.detail).toHaveBeenCalledWith(1635650);
  });

  it('shows nothing for a row linked to two different fixtures', async () => {
    withRow(row({ source_external_ids: ['apifootball:1'] }));
    expect(await (await call()).json()).toEqual({ summary: null, source: null });
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it('discards a detail from another competition and degrades to the empty contract on errors', async () => {
    withRow(row());
    mocks.detail.mockResolvedValue(detail('europa_2026'));
    mocks.feed.mockResolvedValue(null);
    expect(await (await call()).json()).toEqual({ summary: null, source: null });
    mocks.detail.mockRejectedValue(new Error('provider down'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: null, source: null });
  });
});
