import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';
import ucl from './fixtures/api-football/ucl-2026.trimmed.json';

// Vivo en modo 'af' (2026-09-13): id de fixture para filas vinculadas, sin ESPN
// ni football-data en /api/matches/sync-live. Payload real recortado (UCL 2026).
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), enJuego: vi.fn(), pro: vi.fn(), feed: vi.fn(), mode: vi.fn(),
  espnLive: vi.fn(), verify: vi.fn(), fd: vi.fn(), espnBoard: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/matches/en-juego', () => ({ matchesEnJuego: mocks.enJuego }));
vi.mock('@/lib/matches/provider-mode', () => ({ getDataProviderMode: mocks.mode }));
vi.mock('@/lib/api-football/account', () => ({ apiFootballProActive: mocks.pro }));
vi.mock('@/lib/api-football/feed', () => ({ loadFootballDate: mocks.feed }));
vi.mock('@/lib/espn/sync', () => ({ syncEspnLive: mocks.espnLive }));
vi.mock('@/lib/matches/verify-final', () => ({ verifyPendingFinals: mocks.verify }));
vi.mock('@/lib/football-data/client', () => ({ fetchCompetitionMatches: mocks.fd }));
vi.mock('@/lib/espn/client', () => ({ fetchEspnScoreboard: mocks.espnBoard }));
import { syncApiFootballLive } from '@/lib/api-football/live';
import { GET } from '@/app/api/matches/sync-live/route';

const base = (ucl.response as unknown as ApiFootballFixture[]).find(f => f.fixture.id === 1635643)!;
const live = (id = base.fixture.id, over: Partial<ApiFootballFixture['goals']> = {}): ApiFootballFixture => {
  const f = structuredClone(base);
  f.fixture.id = id; f.fixture.status = { short: '2H', long: 'Second Half', elapsed: 67 };
  f.goals = { home: 1, away: 2, ...over }; f.score.fulltime = { home: null, away: null };
  return f;
};
const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000001635643', tournament: 'champions_2025',
  home_team: 'Club Brugge KV', away_team: 'Aston Villa', scheduled_at: '2026-09-08T16:45:00+00:00',
  external_id: 'apifootball:1635643', source_external_ids: [] as string[], ...over,
});
const fetchedAt = "2026-09-08T17:52:00Z";
// Builder encadenable de supabase-js: cada filtro devuelve el mismo objeto y
// await entrega el resultado. Guarda las columnas pedidas y los torneos.
const selects: string[] = [];
const tournamentsAsked: string[][] = [];
const chain = (result: object) => {
  const q: Record<string, unknown> = {};
  for (const m of ["is", "gte", "lte", "limit", "eq", "or"]) q[m] = () => q;
  q.select = (cols: string) => { selects.push(cols); return q; };
  q.in = (_col: string, values: string[]) => { tournamentsAsked.push(values); return q; };
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
};
const afRows = (filas: unknown[]) => mocks.from.mockReturnValue(chain({ data: filas, count: 1, error: null }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pro.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("syncApiFootballLive en modo 'af'", () => {
  it('fila vinculada: empareja por id aunque los nombres guardados sean de otro proveedor', async () => {
    afRows([row({ home_team: 'Brujas', away_team: 'Villa', external_id: '551234',
      source_external_ids: ['apifootball:1635643'] })]);
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    const covered = await syncApiFootballLive('af');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('update_match_live_provider', expect.objectContaining({
      p_source: 'api-football', p_provider_id: '1635643', p_status: 'live', p_home_score: 1, p_away_score: 2,
      p_elapsed: 67, p_status_detail: 'STATUS_SECOND_HALF', p_observed_at: fetchedAt }));
    expect(covered.size).toBe(1);
    expect(selects.at(-1)).toContain('source_external_ids');
    expect(mocks.enJuego).not.toHaveBeenCalled();
  });

  it('el id manda: otro fixture con los mismos nombres no se usa', async () => {
    afRows([row()]);
    mocks.feed.mockResolvedValue({ fixtures: [live(777)], fetchedAt, stale: false });
    expect((await syncApiFootballLive('af')).size).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('dos ids distintos en la fila no escriben nada', async () => {
    afRows([row({ source_external_ids: ['apifootball:777'] })]);
    mocks.feed.mockResolvedValue({ fixtures: [live(), live(777)], fetchedAt, stale: false });
    await syncApiFootballLive('af');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fila vieja sin vínculo: sigue por nombres, competición y saque', async () => {
    afRows([row({ external_id: '551234' })]);
    mocks.feed.mockResolvedValue({ fixtures: [live(777)], fetchedAt, stale: false });
    await syncApiFootballLive('af');
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_provider_id: '777' });
  });

  it("'af': cubre partidos que no están en ninguna polla (sin matchesEnJuego) de los diez torneos", async () => {
    afRows([row({ id: "00000000-0000-4000-8000-000000000999" })]);
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    expect((await syncApiFootballLive("af")).size).toBe(1);
    expect(mocks.enJuego).not.toHaveBeenCalled();
    expect(tournamentsAsked.at(-1)).toEqual(expect.arrayContaining(["champions_2025", "laliga_2025", "betplay_2026", "europa_2026"]));
  });

  it('legacy: sin cambios, identidad por nombres y columnas de siempre', async () => {
    mocks.enJuego.mockResolvedValue({ filas: [row({ home_team: 'Brujas', away_team: 'Villa' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    expect((await syncApiFootballLive('legacy')).size).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.enJuego.mock.calls[0][1]).toBe('id,tournament,home_team,away_team,scheduled_at');
  });

  it('sin modo explícito lee el interruptor', async () => {
    mocks.mode.mockResolvedValue('af');
    afRows([]);
    await syncApiFootballLive();
    expect(mocks.mode).toHaveBeenCalledOnce();
  });
});

describe('/api/matches/sync-live según el modo', () => {
  const request = () => new NextRequest('http://localhost/api/matches/sync-live', { headers: { 'x-cron-secret': 'test-secret' } });
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    afRows([row()]);
    mocks.enJuego.mockResolvedValue({ filas: [row()], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    mocks.verify.mockResolvedValue([]);
    mocks.espnLive.mockResolvedValue({ updated: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("'af': solo API-Football; ni ESPN ni football-data", async () => {
    mocks.mode.mockResolvedValue('af');
    const res = await GET(request());
    expect(await res.json()).toMatchObject({ ok: true, mode: 'af', espn: null, apiFootball: { covered: 1 } });
    expect(mocks.espnLive).not.toHaveBeenCalled();
    expect(mocks.espnBoard).not.toHaveBeenCalled();
    expect(mocks.fd).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith('af');
    expect(mocks.mode).toHaveBeenCalledOnce();
  });

  it("'legacy': API-Football primero y ESPN de respaldo, como antes", async () => {
    mocks.mode.mockResolvedValue('legacy');
    const res = await GET(request());
    expect(await res.json()).toMatchObject({ ok: true, mode: 'legacy', espn: { updated: 0 } });
    expect(mocks.espnLive).toHaveBeenCalledOnce();
    expect(mocks.espnLive.mock.calls[0][0]).toBeInstanceOf(Set);
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith('legacy');
  });

  it('sin secreto responde 401 antes de leer el modo', async () => {
    const res = await GET(new NextRequest('http://localhost/api/matches/sync-live'));
    expect(res.status).toBe(401);
    expect(mocks.mode).not.toHaveBeenCalled();
  });
});
