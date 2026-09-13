import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), enJuego: vi.fn(), pro: vi.fn(), feed: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/matches/en-juego', () => ({ matchesEnJuego: mocks.enJuego }));
vi.mock('@/lib/api-football/account', () => ({ apiFootballProActive: mocks.pro }));
vi.mock('@/lib/api-football/feed', () => ({ loadFootballDate: mocks.feed }));
import { mapApiStatus, mapFixtureToMatch } from '@/lib/api-football/mappers';
import { syncApiFootballLive } from '@/lib/api-football/live';

// Payload real de API-Football (GET /fixtures?ids=1549770, 2026-09-13),
// recortado y sin headers: Llaneros–Deportivo Cali, Clausura 9, aplazado.
// ESPN ya lo tiene reprogramado para el 21-oct; nunca fue un cancelado.
const PST_FIXTURE = {
  fixture: { id: 1549770, date: '2026-09-08T01:00:00+00:00', venue: null,
    status: { long: 'Match Postponed', short: 'PST', elapsed: null } },
  league: { id: 239, name: 'Primera A', round: 'Clausura - 9' },
  teams: { home: { id: 1464, name: 'Llaneros', logo: '' }, away: { id: 1127, name: 'Deportivo Cali', logo: '' } },
  goals: { home: null, away: null },
  score: { fulltime: { home: null, away: null }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
} satisfies ApiFootballFixture;
const withStatus = (short: string, long = ''): ApiFootballFixture =>
  ({ ...PST_FIXTURE, fixture: { ...PST_FIXTURE.fixture, status: { short, long, elapsed: null } } });

const ALL_SHORT = ['TBD','NS','1H','HT','2H','ET','BT','P','LIVE','SUSP','INT','FT','AET','PEN','AWD','WO','PST','CANC','ABD'];

describe('API-Football PST (aplazado) no es cancelado', () => {
  it('PST queda scheduled; CANC y ABD siguen cancelled', () => {
    expect(mapApiStatus('PST')).toBe('scheduled');
    expect(mapApiStatus('CANC')).toBe('cancelled');
    expect(mapApiStatus('ABD')).toBe('cancelled');
  });

  it('de todos los códigos, solo CANC y ABD producen cancelled', () => {
    expect(ALL_SHORT.filter((s) => mapApiStatus(s) === 'cancelled')).toEqual(['CANC', 'ABD']);
  });

  it('el mapper de fila tampoco convierte el PST real en cancelado', () => {
    expect(mapFixtureToMatch(PST_FIXTURE, 'betplay_2026')).toMatchObject({ status: 'scheduled', home_score: null, away_score: null });
    expect(mapFixtureToMatch(withStatus('CANC', 'Match Cancelled'), 'betplay_2026').status).toBe('cancelled');
  });
});

describe('live: observación enviada a update_match_live_provider', () => {
  const match = { id: '00000000-0000-4000-8000-000000001549', tournament: 'betplay_2026',
    home_team: 'Llaneros FC', away_team: 'Deportivo Cali', scheduled_at: '2026-09-08T01:00:00Z' };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pro.mockResolvedValue(true);
    mocks.enJuego.mockResolvedValue({ filas: [match], errores: [] });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  const feedWith = (f: ApiFootballFixture) =>
    mocks.feed.mockResolvedValue({ fixtures: [f], fetchedAt: '2026-09-08T01:20:00Z', stale: false });

  it('PST → scheduled + STATUS_POSTPONED, sin marcador inventado', async () => {
    feedWith(PST_FIXTURE);
    const covered = await syncApiFootballLive();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mocks.rpc.mock.calls[0];
    expect(fn).toBe('update_match_live_provider');
    expect(args).toMatchObject({ p_match_id: match.id, p_source: 'api-football', p_provider_id: '1549770',
      p_status: 'scheduled', p_status_detail: 'STATUS_POSTPONED', p_home_score: null, p_away_score: null,
      p_elapsed: null, p_regulation_home: null, p_regulation_away: null });
    expect(args.p_status).not.toBe('cancelled');
    expect(covered.has(match.id)).toBe(true);
  });

  it('CANC → cancelled + STATUS_CANCELED; ABD → cancelled + STATUS_ABANDONED', async () => {
    feedWith(withStatus('CANC', 'Match Cancelled'));
    await syncApiFootballLive();
    feedWith(withStatus('ABD', 'Match Abandoned'));
    await syncApiFootballLive();
    expect(mocks.rpc.mock.calls.map(([, a]) => [a.p_status, a.p_status_detail]))
      .toEqual([['cancelled', 'STATUS_CANCELED'], ['cancelled', 'STATUS_ABANDONED']]);
  });

  it('si el RPC rechaza la observación (fila live/finished), no se marca cubierto', async () => {
    feedWith(PST_FIXTURE);
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await syncApiFootballLive()).size).toBe(0);
  });
});
