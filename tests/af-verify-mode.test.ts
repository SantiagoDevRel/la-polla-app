import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';
import ucl from './fixtures/api-football/ucl-2026.trimmed.json';

// Verificación en modo 'af' (2026-09-13): API-Football es la única fuente.
// Payloads reales recortados de GET /fixtures?league=2&season=2026.
const mocks = vi.hoisted(() => ({
  admin: vi.fn(), matches: vi.fn(), feed: vi.fn(), get: vi.fn(), mode: vi.fn(),
  espn: vi.fn(), fd: vi.fn(), alert: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/matches/en-juego', () => ({ matchesEnJuego: mocks.matches }));
vi.mock('@/lib/matches/provider-mode', () => ({ getDataProviderMode: mocks.mode }));
vi.mock('@/lib/api-football/feed', () => ({ loadFootballDate: mocks.feed }));
vi.mock('@/lib/api-football/client', () => ({ apiFootballGet: mocks.get }));
vi.mock('@/lib/notifications/admin-alert', () => ({ notifyAdmin: mocks.alert }));
vi.mock('@/lib/football-data/client', () => ({ fetchCompetitionMatches: mocks.fd }));
vi.mock('@/lib/football-data/sync', () => ({ COMPETITIONS: [{ tournament: 'champions_2025', id: 2001 }] }));
vi.mock('@/lib/espn/client', () => ({
  ESPN_LEAGUE_BY_TOURNAMENT: { champions_2025: 'uefa.champions' }, ESPN_ONLY_TOURNAMENTS: new Set(),
  fetchEspnScoreboard: mocks.espn, mapEspnStatus: () => 'finished', parseEspnScore: () => null,
}));
import { verifyPendingFinals } from '@/lib/matches/verify-final';
import { FIXTURE_IDS_PER_REQUEST } from '@/lib/api-football/daily-results';

const payload = (id: number) => structuredClone((ucl.response as unknown as ApiFootballFixture[]).find(f => f.fixture.id === id)!);
const FT = payload(1635643);   // Club Brugge KV 2-3 Aston Villa, FT
const AET = payload(1554381);  // KuPS 0-2 Vardar a los 90', 2-3 tras alargue
const PEN = payload(1591937);  // Celje 1-1 Egnatia, penales 4-1

const dbFetch = vi.fn<typeof fetch>();
const row = (f: ApiFootballFixture, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(f.fixture.id).padStart(12, '0')}`,
  external_id: `apifootball:${f.fixture.id}`, source_external_ids: [] as string[], espn_id: null,
  tournament: 'champions_2025', phase: 'group_stage', home_team: f.teams.home.name, away_team: f.teams.away.name,
  home_score: f.goals.home, away_score: f.goals.away, status: 'finished', scheduled_at: f.fixture.date,
  final_verified_at: null, final_verification_notes: null as string | null, live_status_detail: null as string | null,
  regulation_home_score: null as number | null, regulation_away_score: null as number | null, ...over,
});
const calls = (path: string) => dbFetch.mock.calls.filter(c => String(c[0]).includes(path));
const body = (c: Parameters<typeof fetch>) => JSON.parse(String(c[1]?.body));
const finalCalls = () => calls('/rpc/finalize_verified_match_result');
const noteWrites = () => calls('/rest/v1/matches').filter(c => c[1]?.method === 'PATCH');

let reserveAnswer: (id: number) => boolean;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('API_FOOTBALL_KEY', 'test-only');
  vi.stubEnv('API_FOOTBALL_FINALS_ENABLED', 'false'); // 'af' no depende del flag legacy
  mocks.admin.mockImplementation(() => createClient('http://localhost:54321', 'test-key',
    { auth: { persistSession: false }, global: { fetch: dbFetch } }));
  mocks.mode.mockResolvedValue('af');
  reserveAnswer = () => true;
  dbFetch.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/rpc/reserve_api_football_detail')) {
      return new Response(String(reserveAnswer(JSON.parse(String(init?.body)).p_fixture_id)));
    }
    return new Response(url.includes('/rpc/') ? 'true' : '', { status: 200 });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("verify-final en modo 'af'", () => {
  it('nunca consulta ESPN ni football-data, aunque el torneo esté mapeado', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT)], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:00Z', stale: false });
    await verifyPendingFinals();
    expect(mocks.mode).toHaveBeenCalledOnce();
    expect(mocks.espn).not.toHaveBeenCalled();
    expect(mocks.fd).not.toHaveBeenCalled();
  });

  it('empareja por id de fixture aunque los nombres guardados no coincidan, y exige dos lecturas', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    const linked = row(FT, { home_team: 'Brujas', away_team: 'Villa', external_id: '551234', source_external_ids: ['apifootball:1635643'] });
    mocks.matches.mockResolvedValue({ filas: [linked], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:58:00Z', stale: false });
    const [first] = await verifyPendingFinals('af');
    expect(first.status).toBe('pending');
    expect(finalCalls()).toHaveLength(0);
    const note = body(noteWrites()[0]).final_verification_notes as string;
    expect(note).toContain(' afseen=1635643:2-3@2026-09-08T19:58:00Z');

    // Releer la misma respuesta cacheada no es una segunda observación.
    mocks.matches.mockResolvedValue({ filas: [{ ...linked, final_verification_notes: note }], errores: [] });
    expect((await verifyPendingFinals('af'))[0].status).toBe('pending');
    expect(finalCalls()).toHaveLength(0);

    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:30Z', stale: false });
    expect((await verifyPendingFinals('af'))[0].status).toBe('verified');
    expect(body(finalCalls()[0])).toMatchObject({ p_home_score: 2, p_away_score: 3, p_fulltime_home: null, p_advancer: null });
    expect(dbFetch.mock.calls.some(c => String(c[0]).includes('/predictions'))).toBe(false);
  });

  it('una fila sin vínculo sigue la identidad estricta por nombres', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { external_id: '551234', home_team: 'Brujas', away_team: 'Villa',
      final_verification_notes: ' afseen=1635643:2-3@2026-09-08T19:00:00Z' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:30Z', stale: false });
    expect(await verifyPendingFinals('af')).toEqual([{ match_id: expect.any(String), external_id: '551234', espn_id: null,
      status: 'pending', notes: 'API-Football: sin lectura nueva en este ciclo.' }]);
    expect(finalCalls()).toHaveLength(0);
    expect(noteWrites()).toHaveLength(0);
  });

  it('dos fixtures distintos en una fila bloquean el cierre y avisan', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { source_external_ids: ['apifootball:999'] })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:30Z', stale: false });
    expect((await verifyPendingFinals('af'))[0].status).toBe('discrepancy');
    expect(finalCalls()).toHaveLength(0);
    expect(mocks.alert).toHaveBeenCalledOnce();
  });

  it('AET: puntúa con el marcador de 90 y guarda el de 120 en la misma transacción', async () => {
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z')); // d-3: fuera de la ventana diaria, va por ids=
    const r = row(AET, { phase: 'round_of_32', live_status_detail: 'STATUS_FINAL_AET', regulation_home_score: 0, regulation_away_score: 2,
      final_verification_notes: ' afseen=1554381:0-2@2026-07-17T10:00:00Z' });
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    mocks.get.mockResolvedValue([AET]);
    expect((await verifyPendingFinals('af'))[0].status).toBe('verified');
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/fixtures', { ids: '1554381' }, { attempts: 1, direct: true });
    expect(body(finalCalls()[0])).toMatchObject({ p_home_score: 0, p_away_score: 2, p_fulltime_home: 2, p_fulltime_away: 3,
      p_penalty_home: null, p_penalty_away: null, p_advancer: null });
  });

  it('PEN: 90 empatado, penales decisivos definen quién avanza', async () => {
    vi.setSystemTime(new Date('2026-07-31T12:00:00Z'));
    const r = row(PEN, { phase: 'round_of_16', final_verification_notes: ' afseen=1591937:1-1@2026-07-31T10:00:00Z' });
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    mocks.get.mockResolvedValue([PEN]);
    expect((await verifyPendingFinals('af'))[0].status).toBe('verified');
    expect(body(finalCalls()[0])).toMatchObject({ p_home_score: 1, p_away_score: 1, p_fulltime_home: 1, p_fulltime_away: 1,
      p_penalty_home: 4, p_penalty_away: 1, p_advancer: 'home' });
  });

  it('un snapshot de 90 distinto veta el resultado de API-Football', async () => {
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(AET, { phase: 'round_of_32', regulation_home_score: 1, regulation_away_score: 2,
      final_verification_notes: ' afseen=1554381:0-2@2026-07-17T10:00:00Z' })], errores: [] });
    mocks.get.mockResolvedValue([AET]);
    expect((await verifyPendingFinals('af'))[0].status).toBe('discrepancy');
    expect(finalCalls()).toHaveLength(0);
  });

  it('un id vinculado con otro horario espera la actualización del calendario', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { scheduled_at: '2026-09-09T19:00:00+00:00',
      final_verification_notes: ' afseen=1635643:2-3@2026-09-11T10:00:00Z' })], errores: [] });
    mocks.get.mockResolvedValue([FT]);
    const [result] = await verifyPendingFinals('af');
    expect(result.status).toBe('pending');
    expect(result.notes).toContain('no coincide con el calendario');
    expect(finalCalls()).toHaveLength(0);
  });

  it('un id vinculado a un fixture de otra competición nunca puntúa', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    const otraLiga = structuredClone(FT); otraLiga.league.id = 140;
    mocks.matches.mockResolvedValue({ filas: [row(otraLiga, {
      final_verification_notes: ' afseen=1635643:2-3@2026-09-11T10:00:00Z' })], errores: [] });
    mocks.get.mockResolvedValue([otraLiga]);
    const [result] = await verifyPendingFinals('af');
    expect(result.status).toBe('discrepancy');
    expect(result.notes).toContain('otra competición');
    expect(finalCalls()).toHaveLength(0);
  });

  it('agrupa ids de 20 en 20, solo con reservas concedidas, sin tocar notas si no hay lectura', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    const filas = Array.from({ length: 26 }, (_, i) => {
      const f = structuredClone(FT); f.fixture.id = 2000000 + i;
      return row(f, { status: 'scheduled', home_score: null, away_score: null });
    });
    mocks.matches.mockResolvedValue({ filas, errores: [] });
    reserveAnswer = id => id !== 2000003; // otra instancia ya lo reservó
    mocks.get.mockResolvedValue([]);
    await verifyPendingFinals('af');
    expect(calls('/rpc/reserve_api_football_detail')).toHaveLength(26);
    expect(FIXTURE_IDS_PER_REQUEST).toBe(20);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    const batches = mocks.get.mock.calls.map(c => (c[1] as { ids: string }).ids.split('-').map(Number));
    expect(batches.map(b => b.length)).toEqual([20, 5]);
    expect(batches.flat()).not.toContain(2000003);
    expect(mocks.get.mock.calls.every(c => c[0] === '/fixtures')).toBe(true);
    expect(noteWrites()).toHaveLength(0);
    expect(finalCalls()).toHaveLength(0);
  });

  it('una reserva negada no hace la solicitud HTTP', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT)], errores: [] });
    reserveAnswer = () => false;
    await verifyPendingFinals('af');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('el modo legacy conserva la cadena ESPN + football-data', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.mode.mockResolvedValue('legacy');
    mocks.matches.mockResolvedValue({ filas: [row(FT, { external_id: '551234' })], errores: [] });
    mocks.fd.mockResolvedValue([]); mocks.espn.mockResolvedValue([]);
    await verifyPendingFinals();
    expect(mocks.espn).toHaveBeenCalledOnce();
    expect(mocks.fd).toHaveBeenCalledOnce();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
