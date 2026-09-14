import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';
import ucl from './fixtures/api-football/ucl-2026.trimmed.json';

// Vivo (2026-09-13): API-Football es la única fuente; id de fixture para filas
// vinculadas. Payload real recortado (UCL 2026).
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), enJuego: vi.fn(), pro: vi.fn(), feed: vi.fn(), verify: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/matches/en-juego', () => ({ matchesEnJuego: mocks.enJuego }));
vi.mock('@/lib/api-football/account', () => ({ apiFootballProActive: mocks.pro }));
vi.mock('@/lib/api-football/feed', () => ({ loadFootballDate: mocks.feed }));
vi.mock('@/lib/matches/verify-final', () => ({ verifyPendingFinals: mocks.verify }));
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
const notFilters: string[] = [];
const chain = (result: object) => {
  const q: Record<string, unknown> = {};
  for (const m of ["is", "gte", "lte", "limit", "eq", "or"]) q[m] = () => q;
  q.not = (col: string, op: string, value: string) => { notFilters.push(`${col} ${op} ${value}`); return q; };
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

describe("syncApiFootballLive", () => {
  it('fila vinculada: empareja por id aunque los nombres guardados sean de otro proveedor', async () => {
    afRows([row({ home_team: 'Brujas', away_team: 'Villa', external_id: '551234',
      source_external_ids: ['apifootball:1635643'] })]);
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    const covered = await syncApiFootballLive();
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
    expect((await syncApiFootballLive()).size).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('dos ids distintos en la fila no escriben nada', async () => {
    afRows([row({ source_external_ids: ['apifootball:777'] })]);
    mocks.feed.mockResolvedValue({ fixtures: [live(), live(777)], fetchedAt, stale: false });
    await syncApiFootballLive();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fila vieja sin vínculo: sigue por nombres, competición y saque', async () => {
    afRows([row({ external_id: '551234' })]);
    mocks.feed.mockResolvedValue({ fixtures: [live(777)], fetchedAt, stale: false });
    await syncApiFootballLive();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_provider_id: '777' });
  });

  it("cubre partidos que no están en ninguna polla (sin matchesEnJuego) de los diez torneos", async () => {
    afRows([row({ id: "00000000-0000-4000-8000-000000000999" })]);
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    expect((await syncApiFootballLive()).size).toBe(1);
    expect(mocks.enJuego).not.toHaveBeenCalled();
    expect(tournamentsAsked.at(-1)).toEqual(expect.arrayContaining(["champions_2025", "laliga_2025", "betplay_2026", "europa_2026"]));
  });

  it('las filas ya terminadas salen de la ventana: sin filas vivas no se pide el feed (2026-09-14)', async () => {
    notFilters.length = 0;
    // La base aplica el filtro: los partidos terminados de ayer ya no llegan.
    afRows([]);
    expect((await syncApiFootballLive()).size).toBe(0);
    expect(notFilters).toContain('status in (finished,cancelled)');
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('una fila live vieja sigue en la ventana hasta que el proveedor la cierre', async () => {
    notFilters.length = 0;
    afRows([row({ scheduled_at: '2026-09-08T12:00:00+00:00' })]);
    const ft = live(); ft.fixture.status = { short: 'FT', long: 'Match Finished', elapsed: 90 };
    ft.score.fulltime = { home: 1, away: 2 };
    mocks.feed.mockResolvedValue({ fixtures: [ft], fetchedAt, stale: false });
    expect((await syncApiFootballLive()).size).toBe(1);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_status: 'finished', p_status_detail: 'STATUS_FULL_TIME' });
  });
});

describe('/api/matches/sync-live', () => {
  const request = () => new NextRequest('http://localhost/api/matches/sync-live', { headers: { 'x-cron-secret': 'test-secret' } });
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    afRows([row()]);
    mocks.enJuego.mockResolvedValue({ filas: [row()], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [live()], fetchedAt, stale: false });
    mocks.verify.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('lee el vivo y verifica solo con API-Football', async () => {
    const res = await GET(request());
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: false, apiFootball: { covered: 1 } });
    expect(json).not.toHaveProperty('espn');
    expect(json).not.toHaveProperty('mode');
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.enJuego).not.toHaveBeenCalled();
  });

  it('sin secreto responde 401 antes de tocar la base', async () => {
    const res = await GET(new NextRequest('http://localhost/api/matches/sync-live'));
    expect(res.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
