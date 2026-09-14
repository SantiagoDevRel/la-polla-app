import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';
import ucl from './fixtures/api-football/ucl-2026.trimmed.json';

// Verificación de resultados (2026-09-13): API-Football es la única fuente.
// Payloads reales recortados de GET /fixtures?league=2&season=2026.
const mocks = vi.hoisted(() => ({
  admin: vi.fn(), matches: vi.fn(), feed: vi.fn(), get: vi.fn(), alert: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/matches/en-juego', () => ({ matchesEnJuego: mocks.matches }));
vi.mock('@/lib/api-football/feed', () => ({ loadFootballDate: mocks.feed }));
vi.mock('@/lib/api-football/client', () => ({ apiFootballGet: mocks.get }));
vi.mock('@/lib/notifications/admin-alert', () => ({ notifyAdmin: mocks.alert }));
import { verifyPendingFinals } from '@/lib/matches/verify-final';
import { FIXTURE_IDS_PER_REQUEST } from '@/lib/api-football/daily-results';

const payload = (id: number) => structuredClone((ucl.response as unknown as ApiFootballFixture[]).find(f => f.fixture.id === id)!);
const FT = payload(1635643);   // Club Brugge KV 2-3 Aston Villa, FT
const AET = payload(1554381);  // KuPS 0-2 Vardar a los 90', 2-3 tras alargue
const PEN = payload(1591937);  // Celje 1-1 Egnatia, penales 4-1

const dbFetch = vi.fn<typeof fetch>();
const row = (f: ApiFootballFixture, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(f.fixture.id).padStart(12, '0')}`,
  external_id: `apifootball:${f.fixture.id}`, source_external_ids: [] as string[],
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
  mocks.admin.mockImplementation(() => createClient('http://localhost:54321', 'test-key',
    { auth: { persistSession: false }, global: { fetch: dbFetch } }));
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

describe("verify-final con API-Football", () => {
  it('sin lectura del proveedor no escribe ni cierra', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { status: 'live' })], errores: [] });
    mocks.feed.mockResolvedValue(null);
    expect(await verifyPendingFinals()).toEqual([]);
    expect(finalCalls()).toHaveLength(0);
    expect(noteWrites()).toHaveLength(0);
  });

  it('recupera un final aunque el estado guardado siga en vivo', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { status: 'live',
      final_verification_notes: ' afseen=1635643:2-3@2026-09-08T19:00:00Z' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:00Z', stale: false });
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(finalCalls()).toHaveLength(1);
  });

  it('un RPC que falla se reporta como error, nunca como verificado', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { final_verification_notes: ' afseen=1635643:2-3@2026-09-08T19:00:00Z' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:00Z', stale: false });
    dbFetch.mockResolvedValue(new Response(JSON.stringify({ message: 'test failure' }), { status: 500 }));
    expect((await verifyPendingFinals())[0].status).toBe('error');
  });

  it('si otro tick ya cerró la fila, no afirma que su marcador ganó', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { final_verification_notes: ' afseen=1635643:2-3@2026-09-08T19:00:00Z' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:00Z', stale: false });
    dbFetch.mockImplementation(async input => new Response(String(input).includes('/rpc/finalize_verified_match_result') ? 'false' : '', { status: 200 }));
    const [result] = await verifyPendingFinals();
    expect(result.status).toBe('pending');
    expect(result.notes).toContain('Otro proceso');
  });

  it('empareja por id de fixture aunque los nombres guardados no coincidan, y exige dos lecturas', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    const linked = row(FT, { home_team: 'Brujas', away_team: 'Villa', external_id: '551234', source_external_ids: ['apifootball:1635643'] });
    mocks.matches.mockResolvedValue({ filas: [linked], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:58:00Z', stale: false });
    const [first] = await verifyPendingFinals();
    expect(first.status).toBe('pending');
    expect(finalCalls()).toHaveLength(0);
    const note = body(noteWrites()[0]).final_verification_notes as string;
    expect(note).toContain(' afseen=1635643:2-3@2026-09-08T19:58:00Z');

    // Releer la misma respuesta cacheada no es una segunda observación.
    mocks.matches.mockResolvedValue({ filas: [{ ...linked, final_verification_notes: note }], errores: [] });
    expect((await verifyPendingFinals())[0].status).toBe('pending');
    expect(finalCalls()).toHaveLength(0);

    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:30Z', stale: false });
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(body(finalCalls()[0])).toMatchObject({ p_home_score: 2, p_away_score: 3, p_fulltime_home: null, p_advancer: null });
    expect(dbFetch.mock.calls.some(c => String(c[0]).includes('/predictions'))).toBe(false);
  });

  it('una fila sin vínculo sigue la identidad estricta por nombres', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { external_id: '551234', home_team: 'Brujas', away_team: 'Villa',
      final_verification_notes: ' afseen=1635643:2-3@2026-09-08T19:00:00Z' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:30Z', stale: false });
    expect(await verifyPendingFinals()).toEqual([{ match_id: expect.any(String), external_id: '551234',
      status: 'pending', notes: 'API-Football: sin lectura nueva en este ciclo.' }]);
    expect(finalCalls()).toHaveLength(0);
    expect(noteWrites()).toHaveLength(0);
  });

  it('dos fixtures distintos en una fila bloquean el cierre y avisan', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { source_external_ids: ['apifootball:999'] })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:30Z', stale: false });
    expect((await verifyPendingFinals())[0].status).toBe('discrepancy');
    expect(finalCalls()).toHaveLength(0);
    expect(mocks.alert).toHaveBeenCalledOnce();
  });

  it('AET: puntúa con el marcador de 90 y guarda el de 120 en la misma transacción', async () => {
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z')); // d-3: fuera de la ventana diaria, va por ids=
    const r = row(AET, { phase: 'round_of_32', live_status_detail: 'STATUS_FINAL_AET', regulation_home_score: 0, regulation_away_score: 2,
      final_verification_notes: ' afseen=1554381:0-2@2026-07-17T10:00:00Z' });
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    mocks.get.mockResolvedValue([AET]);
    expect((await verifyPendingFinals())[0].status).toBe('verified');
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
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(body(finalCalls()[0])).toMatchObject({ p_home_score: 1, p_away_score: 1, p_fulltime_home: 1, p_fulltime_away: 1,
      p_penalty_home: 4, p_penalty_away: 1, p_advancer: 'home' });
  });

  it('un snapshot de 90 distinto veta el resultado de API-Football', async () => {
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(AET, { phase: 'round_of_32', regulation_home_score: 1, regulation_away_score: 2,
      final_verification_notes: ' afseen=1554381:0-2@2026-07-17T10:00:00Z' })], errores: [] });
    mocks.get.mockResolvedValue([AET]);
    expect((await verifyPendingFinals())[0].status).toBe('discrepancy');
    expect(finalCalls()).toHaveLength(0);
  });

  it('un id vinculado con otro horario espera la actualización del calendario', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    mocks.matches.mockResolvedValue({ filas: [row(FT, { scheduled_at: '2026-09-09T19:00:00+00:00',
      final_verification_notes: ' afseen=1635643:2-3@2026-09-11T10:00:00Z' })], errores: [] });
    mocks.get.mockResolvedValue([FT]);
    const [result] = await verifyPendingFinals();
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
    const [result] = await verifyPendingFinals();
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
    await verifyPendingFinals();
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
    await verifyPendingFinals();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

// Freno a cierres atascados (2026-09-14, migración 123): tras 5 intentos sin
// cerrar, la fecha del partido se consulta cada 15 minutos y el admin recibe
// un aviso una sola vez. El cierre normal (dos lecturas) no cambia.
describe('verify-final: freno a cierres atascados', () => {
  let attemptRows: { match_id: string; attempts: number; last_attempt_at: string }[];
  let noteAnswer: (ids: string[]) => { match_id: string; attempts: number; alert: boolean }[];
  let cacheRows: { fixture_date: string; fixtures: unknown; fetched_at: string }[];
  const noteCalls = () => calls('/rpc/note_api_football_verify_attempts');
  beforeEach(() => {
    attemptRows = []; cacheRows = [];
    noteAnswer = ids => ids.map(match_id => ({ match_id, attempts: 1, alert: false }));
    dbFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/rest/v1/api_football_verify_attempts')) return json(attemptRows);
      if (url.includes('/rest/v1/api_football_cache')) return json(cacheRows);
      if (url.includes('/rpc/note_api_football_verify_attempts')) return json(noteAnswer(JSON.parse(String(init?.body)).p_match_ids));
      if (url.includes('/rpc/reserve_api_football_detail')) return new Response('false');
      return new Response(url.includes('/rpc/') ? 'true' : '', { status: 200 });
    });
  });

  it('el cierre normal hace sus dos lecturas seguidas y no pasa por el freno', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    const r = row(FT);
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:00Z', stale: false });
    expect((await verifyPendingFinals())[0].status).toBe('pending');
    expect(body(noteCalls()[0])).toMatchObject({ p_match_ids: [r.id], p_alert_after: 5 });
    const note = body(noteWrites()[0]).final_verification_notes as string;

    vi.setSystemTime(new Date('2026-09-08T20:01:00Z'));
    attemptRows = [{ match_id: r.id, attempts: 1, last_attempt_at: '2026-09-08T20:00:00Z' }];
    mocks.matches.mockResolvedValue({ filas: [{ ...r, final_verification_notes: note }], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T20:00:30Z', stale: false });
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(mocks.feed).toHaveBeenCalledTimes(2);
    expect(noteCalls()).toHaveLength(1); // el verificado no suma intento
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('con 5 intentos recientes no consulta el proveedor y no suma intento', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    const r = row(FT);
    attemptRows = [{ match_id: r.id, attempts: 7, last_attempt_at: '2026-09-08T19:52:00Z' }];
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [FT], fetchedAt: '2026-09-08T19:59:50Z', stale: false });
    await verifyPendingFinals();
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(calls('/rpc/reserve_api_football')).toHaveLength(0);
    expect(calls('/rest/v1/api_football_cache')).toHaveLength(1);
    expect(noteCalls()).toHaveLength(0);
    expect(finalCalls()).toHaveLength(0);
  });

  it('espaciado, usa el feed que otro proceso ya refrescó y puede cerrar sin gastar cuota', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    const r = row(FT, { final_verification_notes: ' afseen=1635643:2-3@2026-09-08T19:00:00Z' });
    attemptRows = [{ match_id: r.id, attempts: 9, last_attempt_at: '2026-09-08T19:55:00Z' }];
    cacheRows = [{ fixture_date: '2026-09-08', fixtures: [FT], fetched_at: '2026-09-08T19:59:10Z' }];
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it('pasados 15 minutos vuelve a consultar, y al llegar a 5 intentos avisa una sola vez', async () => {
    vi.setSystemTime(new Date('2026-09-08T20:00:00Z'));
    const r = row(FT, { home_team: 'Brujas', final_verification_notes: 'API-Football: sin lectura nueva alerted=2026-01-01T00:00:00Z' });
    attemptRows = [{ match_id: r.id, attempts: 5, last_attempt_at: '2026-09-08T19:44:00Z' }];
    noteAnswer = ids => ids.map(match_id => ({ match_id, attempts: 6, alert: true }));
    mocks.matches.mockResolvedValue({ filas: [r], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [], fetchedAt: '2026-09-08T19:59:50Z', stale: false });
    await verifyPendingFinals();
    expect(mocks.feed).toHaveBeenCalledOnce();
    expect(noteCalls()).toHaveLength(1);
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      category: 'verification_timeout', title: 'Resultado sin confirmar: Brujas vs Aston Villa' }));
    expect(mocks.alert.mock.calls[0][0].body).not.toContain('alerted=');

    noteAnswer = ids => ids.map(match_id => ({ match_id, attempts: 7, alert: false }));
    await verifyPendingFinals();
    expect(mocks.alert).toHaveBeenCalledOnce();
  });

  it('un partido todavía en juego no suma intentos aunque pasen los 105 minutos', async () => {
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z')); // saque 16:45 → 2 h 15 min
    const enJuego = structuredClone(FT); enJuego.fixture.status = { short: 'ET', long: 'Extra Time', elapsed: 105 };
    mocks.matches.mockResolvedValue({ filas: [row(FT, { status: 'live' })], errores: [] });
    mocks.feed.mockResolvedValue({ fixtures: [enJuego], fetchedAt: '2026-09-08T18:59:50Z', stale: false });
    await verifyPendingFinals();
    expect(mocks.feed).toHaveBeenCalledOnce();
    expect(noteCalls()).toHaveLength(0);
  });
});

// Regresión (revisión del PR #81): el freno cuenta LECTURAS NUEVAS del
// proveedor, no ticks. Simulación con estado: tick de 1 minuto, reservas con
// su TTL real (feed por fecha 20 min en Free — 094; detalle por id 1 h para
// fixtures FT — 095) e intentos que persisten entre ticks.
describe('verify-final: el freno cuenta lecturas nuevas, no ticks', () => {
  interface SimOpts { ttlMs: number; via: 'feed' | 'ids'; status: string; fixtures: ApiFootballFixture[]; start: string; linked?: boolean }
  async function simulate(o: SimOpts, minutes = 90) {
    const base = row(FT, { status: o.status, ...(o.linked === false ? { external_id: '551234' } : {}) });
    const db = { notes: null as string | null, verified: false,
      attempts: null as null | { attempts: number; last_attempt_at: string; alerted_at: string | null } };
    let lastFetch = -Infinity; let lastFetchedAt = ''; let providerReads = 0; let verifiedAt: number | null = null;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    mocks.matches.mockImplementation(async () => ({ filas: db.verified ? [] : [{ ...base, final_verification_notes: db.notes }], errores: [] }));
    mocks.feed.mockImplementation(async () => {
      if (Date.now() - lastFetch >= o.ttlMs) { lastFetch = Date.now(); lastFetchedAt = new Date().toISOString(); providerReads++; }
      return { fixtures: o.fixtures, fetchedAt: lastFetchedAt, stale: false };
    });
    mocks.get.mockImplementation(async () => { providerReads++; return o.fixtures; });
    dbFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const req = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes('/rest/v1/api_football_verify_attempts')) return json(db.attempts ? [{ match_id: base.id, ...db.attempts }] : []);
      if (url.includes('/rest/v1/api_football_cache')) return json([]);
      if (url.includes('/rpc/note_api_football_verify_attempts')) {
        const now = new Date().toISOString();
        db.attempts = { attempts: (db.attempts?.attempts ?? 0) + 1, last_attempt_at: now, alerted_at: db.attempts?.alerted_at ?? null };
        const alert = db.attempts.alerted_at === null && db.attempts.attempts >= req.p_alert_after;
        if (alert) db.attempts.alerted_at = now;
        return json([{ match_id: base.id, attempts: db.attempts.attempts, alert }]);
      }
      if (url.includes('/rpc/reserve_api_football_detail')) {
        if (Date.now() - lastFetch < o.ttlMs) return new Response('false');
        lastFetch = Date.now(); return new Response('true');
      }
      if (url.includes('/rpc/finalize_verified_match_result')) { db.verified = true; return new Response('true'); }
      if (url.includes('/rest/v1/matches') && init?.method === 'PATCH') { db.notes = req.final_verification_notes; return new Response(''); }
      return new Response(url.includes('/rpc/') ? 'true' : '', { status: 200 });
    });
    const t0 = Date.parse(o.start);
    for (let m = 0; m <= minutes && verifiedAt === null; m++) {
      vi.setSystemTime(new Date(t0 + m * 60_000));
      await verifyPendingFinals();
      if (db.verified) verifiedAt = m;
    }
    return { verifiedAt, alerts: mocks.alert.mock.calls.length, attempts: db.attempts?.attempts ?? 0, providerReads };
  }

  it('plan Free (feed con TTL de 20 min, vivo apagado): cierra en el minuto 20 sin aviso falso', async () => {
    const r = await simulate({ ttlMs: 20 * 60_000, via: 'feed', status: 'live', fixtures: [FT], start: '2026-09-08T18:45:00Z' });
    expect(r).toMatchObject({ verifiedAt: 20, alerts: 0 });
  });

  it('vía por ids (detalle con TTL de 1 h, fila finished): cierra en el minuto 60 sin aviso falso', async () => {
    const r = await simulate({ ttlMs: 60 * 60_000, via: 'ids', status: 'finished', fixtures: [FT], start: '2026-09-11T12:00:00Z' });
    expect(r).toMatchObject({ verifiedAt: 60, alerts: 0 });
    expect(r.providerReads).toBe(2);
  });

  it('Pro con un partido realmente atascado: avisa una vez y espacia las lecturas', async () => {
    const r = await simulate({ ttlMs: 60_000, via: 'feed', status: 'finished', fixtures: [], start: '2026-09-08T18:45:00Z', linked: false }, 60);
    expect(r.verifiedAt).toBeNull();
    expect(r.alerts).toBe(1);
    expect(r.providerReads).toBeLessThanOrEqual(10); // sin freno serían 61
  });
});
