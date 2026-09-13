import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Plantel de la ficha de equipo (2026-09-13): Mundial horneado y clubes desde
// API-Football. Cero ESPN: ni fetch en runtime ni escudos remotos de ESPN.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), observation: vi.fn(), team: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/api-football/feed', () => ({ knownFootballObservation: mocks.observation }));
vi.mock('@/lib/api-football/teams', () => ({ loadFootballTeam: mocks.team }));
import { GET } from '@/app/api/teams/roster/route';

const request = (query: string) => GET(new NextRequest(`http://localhost/api/teams/roster?${query}`));
type Row = Record<string, unknown>;
// Builder de supabase-js: guarda filtros y resuelve por lado (home/away) o por tabla.
const tables = (matches: { home: Row[]; away: Row[] }, squad: unknown = null) => {
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, value: unknown) => { filters[col] = value; return q; };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: table === 'api_football_teams' ? { squad } : null, error: null });
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
      data: 'home_team' in filters ? matches.home : matches.away, error: null,
    }).then(resolve);
    return q;
  });
};
const fixture = (id: number, homeId: number, awayId: number, league = 239) => ({
  fixture: { id }, league: { id: league }, teams: { home: { id: homeId }, away: { id: awayId } },
});
const afPlayer = { id: 50, name: 'Arquero Titular', age: 31, number: 1, position: 'Goalkeeper', photo: 'https://media.api-sports.io/football/players/50.png' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in roster tests'); }));
});

describe('GET /api/teams/roster', () => {
  it('rejects anonymous users before reading any data', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await request('tournament=betplay_2026&team=Millonarios');
    expect(res.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.team).not.toHaveBeenCalled();
  });

  it.each(['team=Millonarios', 'tournament=betplay_2026', 'tournament=../x&team=A', `tournament=betplay_2026&team=${'a'.repeat(121)}`])(
    'validates parameters: %s', async (query) => {
      expect((await request(query)).status).toBe(400);
      expect(mocks.from).not.toHaveBeenCalled();
    });

  it('serves the baked World Cup squad with local club crests only', async () => {
    const res = await request('tournament=worldcup_2026&team=Colombia');
    expect(res.status).toBe(200);
    const { players } = await res.json();
    expect(players.length).toBe(26);
    expect(players[0]).toMatchObject({ name: 'David Ospina', club: 'Atlético Nacional', line: 'GK' });
    for (const p of players) {
      if (p.clubCrest !== null) expect(p.clubCrest).toMatch(/^\/(team-crests|flags)\//);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never falls back to a provider for an unbaked World Cup team', async () => {
    const res = await request('tournament=worldcup_2026&team=W73');
    expect(await res.json()).toEqual({ players: [] });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('resolves the API-Football team from the linked fixture side and maps the squad', async () => {
    tables({ home: [], away: [{ home_team: 'Junior', away_team: 'Millonarios', home_team_flag: null, away_team_flag: null,
      external_id: 'apifootball:900', source_external_ids: [], scheduled_at: new Date().toISOString() }] });
    mocks.observation.mockResolvedValue({ fixture: fixture(900, 1140, 1125), fetchedAt: new Date().toISOString() });
    mocks.team.mockResolvedValue({ players: [afPlayer, { id: 51, name: 'Sin Datos', age: null, number: null, position: 'Coach', photo: null }] });
    const res = await request('tournament=betplay_2026&team=Millonarios');
    expect(mocks.team).toHaveBeenCalledWith(1125);
    const { players } = await res.json();
    expect(players).toEqual([
      { name: 'Arquero Titular', jersey: '1', pos: 'G', line: 'GK', age: 31, headshot: afPlayer.photo, club: null, clubCrest: null },
      { name: 'Sin Datos', jersey: null, pos: 'Coach', line: 'OTH', age: null, headshot: null, club: null, clubCrest: null },
    ]);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('refuses a fixture from another competition and uses the API-Football crest on the row', async () => {
    tables({ home: [{ home_team: 'Millonarios', away_team: 'Junior', home_team_flag: 'https://media.api-sports.io/football/teams/1125.png',
      away_team_flag: null, external_id: 'apifootball:901', source_external_ids: [], scheduled_at: new Date().toISOString() }], away: [] });
    mocks.observation.mockResolvedValue({ fixture: fixture(901, 999, 1140, 13), fetchedAt: new Date().toISOString() });
    mocks.team.mockResolvedValue({ players: [afPlayer] });
    await request('tournament=betplay_2026&team=Millonarios');
    expect(mocks.team).toHaveBeenCalledWith(1125);
  });

  it('shows no squad when the linked fixtures disagree on the team identity', async () => {
    const row = (id: number) => ({ home_team: 'Millonarios', away_team: 'X', home_team_flag: null, away_team_flag: null,
      external_id: `apifootball:${id}`, source_external_ids: [], scheduled_at: new Date().toISOString() });
    tables({ home: [row(1), row(2)], away: [] });
    mocks.observation.mockImplementation(async (id: number) => ({ fixture: fixture(id, id === 1 ? 1125 : 7777, 1), fetchedAt: '' }));
    const res = await request('tournament=betplay_2026&team=Millonarios');
    expect(await res.json()).toEqual({ players: [] });
    expect(mocks.team).not.toHaveBeenCalled();
  });

  it('falls back to the baked league inventory by exact normalized name and to the cached squad', async () => {
    tables({ home: [], away: [] }, [afPlayer]);
    mocks.team.mockResolvedValue(null);
    const res = await request('tournament=betplay_2026&team=Deportivo%20Pasto');
    expect(mocks.team).toHaveBeenCalledWith(1126);
    expect((await res.json()).players[0]).toMatchObject({ name: 'Arquero Titular', pos: 'G' });
  });

  it('returns an empty squad for unsupported competitions without calling API-Football', async () => {
    const res = await request('tournament=copa_inventada&team=Millonarios');
    expect(await res.json()).toEqual({ players: [] });
    expect(mocks.team).not.toHaveBeenCalled();
  });
});
