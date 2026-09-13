import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  refreshAfTournament, validateFixturesEnvelope, writerWouldChange, memoizedSeasonResolver, estimateLegacyLinks,
  reserveCalendarRequest, createCalendarDeps,
  type AfMatchRow, type CalendarDeps, type CalendarReservation, type ExistingMatch,
} from '@/lib/api-football/calendar';
import type { CalendarFixture } from '@/lib/api-football/calendar-model';

// El plan pagado lo refresca account.ts contra /status; acá se controla sin red.
const mocks = vi.hoisted(() => ({ pro: vi.fn(async () => true) }));
vi.mock('@/lib/api-football/account', () => ({ apiFootballProActive: mocks.pro }));

// Respuestas reales de API-Football del 2026-09-13, recortadas. Cero red.
type FeedFile = { observedAt: string; response: CalendarFixture[] };
const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/api-football/${name}`, import.meta.url), 'utf8')) as FeedFile;
const LALIGA = load('laliga-2026.trimmed.json');
const BETPLAY = load('betplay-2026.trimmed.json');
const envelope = (response: unknown[]) => ({ get: 'fixtures', errors: [], results: response.length, paging: { current: 1, total: 1 }, response });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

type RpcCall = { fn: string; args: Record<string, unknown> };

function fakeDb(existing: ExistingMatch[] = []) {
  const calls: RpcCall[] = [];
  const reads: string[] = [];
  let nextId = 1;
  const chain = (table: string) => {
    type Chain = {
      select: () => Chain; eq: () => Chain; or: (f: string) => Chain; order: () => Chain;
      range: (from: number) => Promise<{ data: ExistingMatch[]; error: null }>;
    };
    const q: Chain = {
      select: () => q, eq: () => q, or: (f: string) => { reads.push(`${table}:${f}`); return q; },
      order: () => q, range: async (from: number) => ({ data: existing.slice(from, from + 1000), error: null }),
    };
    return q;
  };
  const db = {
    from: chain,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const known = existing.find((m) => m.external_id === args.p_external_id);
      return { data: known?.id ?? `new-${nextId++}`, error: null };
    }),
  };
  return { db: db as unknown as SupabaseClient, calls, reads };
}

function deps(body: unknown, db: SupabaseClient, now: number, extra: Partial<CalendarDeps> = {}): CalendarDeps {
  return {
    db, now: () => now, log: () => {},
    fetchEnvelope: vi.fn(async () => body),
    reserveRequest: vi.fn(async () => true),
    resolveSeason: vi.fn(async () => 2026),
    ...extra,
  };
}

/** Lo que guardaría el escritor al insertar esa fila (para simular la segunda corrida). */
const stored = (row: AfMatchRow, id: string): ExistingMatch => ({
  id, external_id: row.external_id, source_external_ids: [], match_day: row.match_day, phase: row.phase,
  home_team: row.home_team, away_team: row.away_team, home_team_flag: row.home_team_flag,
  away_team_flag: row.away_team_flag, scheduled_at: row.scheduled_at, scheduled_at_confirmed: row.scheduled_at_confirmed,
  venue: row.venue, home_score: row.home_score, away_score: row.away_score, status: row.status,
  elapsed: row.elapsed, final_verified_at: null, live_updated_at: null,
});
const argsToRow = (a: Record<string, unknown>): AfMatchRow => ({
  external_id: a.p_external_id as string, tournament: a.p_tournament as string, match_day: a.p_match_day as number | null,
  phase: a.p_phase as string, home_team: a.p_home_team as string, away_team: a.p_away_team as string,
  home_team_flag: a.p_home_team_flag as string | null, away_team_flag: a.p_away_team_flag as string | null,
  scheduled_at: a.p_scheduled_at as string, venue: a.p_venue as string | null, home_score: a.p_home_score as number | null,
  away_score: a.p_away_score as number | null, status: a.p_status as string, elapsed: a.p_elapsed as number | null,
  scheduled_at_confirmed: a.p_scheduled_at_confirmed as boolean,
});
const argsOf = (calls: RpcCall[], fixtureId: number) =>
  calls.find((c) => c.args.p_external_id === `apifootball:${fixtureId}`)?.args;

describe('refreshAfTournament mapping', () => {
  const NOW = Date.parse(LALIGA.observedAt);

  it('writes LaLiga through the 17-argument writer with AF identity, names, logos and D2 precision', async () => {
    const { db, calls } = fakeDb();
    const r = await refreshAfTournament('laliga_2025', { mode: 'apply' }, deps(envelope(LALIGA.response), db, NOW));
    expect(r.aborted).toBeNull();
    expect(r.fetched).toBe(32);
    expect(r.skipped).toEqual({ before_window: 2 }); // J1 de agosto: historia, no se toca
    expect(r.inserted).toBe(30);
    expect(calls.every((c) => c.fn === 'upsert_match_safe')).toBe(true);
    for (const c of calls) {
      expect(Object.keys(c.args)).toHaveLength(17);
      expect(c.args).not.toHaveProperty('p_final_verified_at');
      expect(c.args.p_home_team_abbr).toBeNull();
      expect(c.args.p_away_team_abbr).toBeNull();
      expect(String(c.args.p_home_team_flag)).toMatch(/^https:\/\/media\.api-sports\.io\/football\/teams\/\d+\.png$/);
    }
    expect(argsOf(calls, 1570394)).toMatchObject({
      p_tournament: 'laliga_2025', p_home_team: 'Atletico Madrid', p_away_team: 'Real Madrid',
      p_phase: 'regular_season', p_match_day: 7, p_scheduled_at: '2026-09-20T14:15:00.000Z',
      p_status: 'scheduled', p_home_score: null, p_away_score: null, p_scheduled_at_confirmed: true,
    });
    // J8 y J10: ronda de relleno (9-10 partidos a la misma hora, a más de 10 días) → hora por confirmar.
    for (const id of [1570403, 1570412, 1570423, 1570426]) expect(argsOf(calls, id)?.p_scheduled_at_confirmed).toBe(false);
    expect(argsOf(calls, 1570423)).toMatchObject({ p_phase: 'regular_season', p_match_day: 10 });
  });

  it('marks BetPlay TBD and postponed fixtures provisional, with no score, and skips old postponements', async () => {
    const now = Date.parse(BETPLAY.observedAt);
    const { db, calls } = fakeDb();
    const r = await refreshAfTournament('betplay_2026', {}, deps(envelope(BETPLAY.response), db, now));
    expect(r.aborted).toBeNull();
    expect(argsOf(calls, 1549712)).toMatchObject({ p_status: 'scheduled', p_scheduled_at_confirmed: false, p_home_score: null, p_match_day: 3 });
    expect(argsOf(calls, 1549750)).toMatchObject({ p_status: 'scheduled', p_scheduled_at_confirmed: false, p_home_score: null });
    expect(argsOf(calls, 1549705)?.p_scheduled_at_confirmed).toBe(true);
    expect(argsOf(calls, 1549863)?.p_scheduled_at_confirmed).toBe(false); // Clausura 19 de relleno
    expect(argsOf(calls, 1549770)).toBeUndefined(); // PST del 8-sep: fuera de la ventana D3
    expect(calls.every((c) => c.args.p_status === 'scheduled')).toBe(true);
  });

  it('passes the 90-minute score for AET without verification, and keeps the live sync in charge', async () => {
    const [base] = clone(LALIGA.response);
    const now = Date.parse('2026-09-13T12:00:00Z');
    const ts = (iso: string) => ({ date: iso.replace('.000Z', '+00:00'), timestamp: Date.parse(iso) / 1000 });
    const aet = { ...base, fixture: { ...base.fixture, id: 9001, ...ts('2026-09-12T19:00:00.000Z'), status: { short: 'AET', long: 'x', elapsed: 120 } },
      goals: { home: 2, away: 1 }, score: { fulltime: { home: 1, away: 1 }, extratime: { home: 1, away: 0 }, penalty: { home: null, away: null } } };
    const live = { ...base, fixture: { ...base.fixture, id: 9002, ...ts('2026-09-13T11:00:00.000Z'), status: { short: '2H', long: 'x', elapsed: 70 } },
      goals: { home: 3, away: 0 }, score: { fulltime: { home: null, away: null }, extratime: { home: null, away: null }, penalty: { home: null, away: null } } };
    const existingLive = { ...stored({ external_id: 'apifootball:9002', tournament: 'laliga_2025', match_day: 1, phase: 'regular_season',
      home_team: base.teams.home.name, away_team: base.teams.away.name, home_team_flag: base.teams.home.logo, away_team_flag: base.teams.away.logo,
      scheduled_at: '2026-09-13T11:00:00.000Z', venue: 'Old venue', home_score: 1, away_score: 0, status: 'live', elapsed: 55,
      scheduled_at_confirmed: true }, 'live-row') };
    const { db, calls } = fakeDb([existingLive]);
    const r = await refreshAfTournament('laliga_2025', {}, deps(envelope([aet, live]), db, now));
    expect(r.aborted).toBeNull();
    expect(argsOf(calls, 9001)).toMatchObject({ p_status: 'finished', p_home_score: 1, p_away_score: 1 });
    // Solo cambió el estadio: estado, marcador y minuto siguen siendo los del sync de vivo.
    expect(argsOf(calls, 9002)).toMatchObject({ p_status: 'live', p_home_score: 1, p_away_score: 0, p_elapsed: 55 });
    expect(r).toMatchObject({ inserted: 1, updated: 1, unchanged: 0 });
  });

  it('applies the D3 window exactly at now minus two days', async () => {
    const [base] = clone(LALIGA.response);
    const now = Date.parse('2026-09-13T12:00:00Z');
    const at = (id: number, ms: number) => ({ ...base, fixture: { ...base.fixture, id,
      date: new Date(ms).toISOString().replace('.000Z', '+00:00'), timestamp: ms / 1000, status: { short: 'NS', long: 'x', elapsed: null } } });
    const { db, calls } = fakeDb();
    const r = await refreshAfTournament('laliga_2025', {}, deps(envelope([
      at(1, now - 2 * 86_400_000 - 60_000), at(2, now - 2 * 86_400_000 + 60_000), at(3, Date.parse('2026-12-20T20:00:00Z')),
    ]), db, now));
    expect(r.skipped).toEqual({ before_window: 1 });
    expect(calls.map((c) => c.args.p_external_id)).toEqual(['apifootball:2', 'apifootball:3']);
  });
});

describe('refreshAfTournament safety', () => {
  const NOW = Date.parse(LALIGA.observedAt);

  it.each([
    ['provider_errors', { ...envelope(LALIGA.response), errors: { requests: 'You have reached the request limit' } }],
    ['provider_errors', { ...envelope(LALIGA.response), errors: ['bad'] }],
    ['paged', { ...envelope(LALIGA.response), paging: { current: 1, total: 2 } }],
    ['empty_response', envelope([])],
    ['invalid_envelope', '<html>'],
    ['season_mismatch', envelope(LALIGA.response.map((f, i) => (i === 3 ? { ...f, league: { ...f.league, season: 2025 } } : f)))],
    ['season_mismatch', envelope(LALIGA.response.map((f, i) => (i === 3 ? { ...f, league: { ...f.league, id: 39 } } : f)))],
  ])('aborts on %s without writing', async (reason, body) => {
    const { db, calls, reads } = fakeDb();
    const r = await refreshAfTournament('laliga_2025', {}, deps(body, db, NOW));
    expect(r.aborted).toBe(reason);
    expect(calls).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  it('does not spend a request without a season, quota or time, and survives a failed fetch', async () => {
    const { db, calls } = fakeDb();
    const noSeason = deps(envelope(LALIGA.response), db, NOW, { resolveSeason: async () => null });
    expect((await refreshAfTournament('laliga_2025', {}, noSeason)).aborted).toBe('no_season');
    expect(noSeason.fetchEnvelope).not.toHaveBeenCalled();
    const noBudget = deps(envelope(LALIGA.response), db, NOW, { reserveRequest: async () => false });
    expect((await refreshAfTournament('laliga_2025', {}, noBudget)).aborted).toBe('budget');
    expect(noBudget.fetchEnvelope).not.toHaveBeenCalled();
    const late = deps(envelope(LALIGA.response), db, NOW);
    expect((await refreshAfTournament('laliga_2025', { deadlineMs: NOW }, late)).aborted).toBe('deadline');
    expect(late.fetchEnvelope).not.toHaveBeenCalled();
    const failing = deps(null, db, NOW, { fetchEnvelope: async () => { throw new Error('HTTP 500'); } });
    expect((await refreshAfTournament('laliga_2025', {}, failing)).aborted).toBe('fetch_failed');
    expect((await refreshAfTournament('worldcup_2026', {}, late)).aborted).toBe('unsupported_tournament');
    expect(calls).toHaveLength(0);
  });

  it('reserves exactly one fixtures request for the league before fetching', async () => {
    const { db } = fakeDb();
    const order: string[] = [];
    const d = deps(envelope(LALIGA.response), db, NOW, {
      reserveRequest: vi.fn(async (request: CalendarReservation) => { order.push(`reserve:${JSON.stringify(request)}`); return true; }),
      fetchEnvelope: vi.fn(async () => { order.push('fetch'); return envelope(LALIGA.response); }),
    });
    expect((await refreshAfTournament('laliga_2025', {}, d)).aborted).toBeNull();
    expect(order).toEqual(['reserve:{"kind":"fixtures","leagueId":140}', 'fetch']);
  });

  it('dry-run plans the same rows and writes nothing', async () => {
    const { db, calls } = fakeDb();
    const r = await refreshAfTournament('laliga_2025', { mode: 'dry-run' }, deps(envelope(LALIGA.response), db, NOW));
    expect(r).toMatchObject({ inserted: 30, updated: 0, unchanged: 0, errors: 0 });
    expect(r.sample).toHaveLength(5);
    expect(r.sample[0].row.scheduled_at <= r.sample[4].row.scheduled_at).toBe(true);
    expect(r.legacy).toEqual({ wouldLink: 0, ambiguous: 0, unmatchedLegacyRows: 0 });
    expect(calls).toHaveLength(0);
  });

  it('counts a failing row and keeps writing the rest', async () => {
    const { db, calls } = fakeDb();
    let n = 0;
    (db.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return ++n === 2 ? { data: null, error: { message: 'Ambiguous fixture identity' } } : { data: `id-${n}`, error: null };
    });
    const r = await refreshAfTournament('laliga_2025', {}, deps(envelope(LALIGA.response), db, NOW));
    expect(r.errors).toBe(1);
    expect(r.inserted).toBe(29);
    expect(calls).toHaveLength(30);
  });

  it('stops writing at the deadline and reports the league as truncated', async () => {
    const { db } = fakeDb();
    let clock = NOW;
    (db.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => { clock += 1_000; return { data: crypto.randomUUID(), error: null }; });
    const d = deps(envelope(LALIGA.response), db, NOW, { now: () => clock });
    const r = await refreshAfTournament('laliga_2025', { deadlineMs: NOW + 10_000 }, d);
    expect(r.truncated).toBe(true);
    expect(r.inserted).toBe(10);
    expect(r.skipped.deadline).toBe(20);
  });
});

describe('diff against stored API-Football rows', () => {
  const NOW = Date.parse(LALIGA.observedAt);

  it('does not call the writer for unchanged rows and writes only the changed one', async () => {
    const first = fakeDb();
    await refreshAfTournament('laliga_2025', {}, deps(envelope(LALIGA.response), first.db, NOW));
    const rows = first.calls.map((c, i) => stored(argsToRow(c.args), `row-${i}`));

    const second = fakeDb(rows);
    const unchanged = await refreshAfTournament('laliga_2025', {}, deps(envelope(LALIGA.response), second.db, NOW));
    expect(unchanged).toMatchObject({ inserted: 0, updated: 0, unchanged: 30, errors: 0 });
    expect(second.calls).toHaveLength(0);

    const moved = clone(LALIGA.response);
    const target = moved.find((f) => f.fixture.id === 1570400)!;
    target.fixture.timestamp += 3600;
    target.fixture.date = new Date(target.fixture.timestamp * 1000).toISOString().replace('.000Z', '+00:00');
    const third = fakeDb(rows);
    const r = await refreshAfTournament('laliga_2025', {}, deps(envelope(moved), third.db, NOW));
    expect(third.calls.map((c) => c.args.p_external_id)).toEqual(['apifootball:1570400']);
    expect(r).toMatchObject({ updated: 1, unchanged: 29 });
  });

  it('models the writer protections so it never rewrites what the writer would reject', () => {
    const row: AfMatchRow = { external_id: 'apifootball:1', tournament: 'laliga_2025', match_day: 8, phase: 'regular_season',
      home_team: 'A', away_team: 'B', home_team_flag: 'a.png', away_team_flag: 'b.png', scheduled_at: '2026-10-11T15:00:00.000Z',
      venue: 'V', home_score: null, away_score: null, status: 'scheduled', elapsed: null, scheduled_at_confirmed: false };
    const now = Date.parse('2026-09-13T12:00:00Z');
    const base = stored(row, 'x');
    // Hora confirmada guardada frente a una observación provisional distinta: el escritor la conserva.
    expect(writerWouldChange({ ...base, scheduled_at: '2026-10-11T19:00:00.000Z', scheduled_at_confirmed: true }, row, now)).toBe(false);
    expect(writerWouldChange({ ...base, scheduled_at: '2026-10-11T19:00:00.000Z' }, row, now)).toBe(true);
    // Anti-regresión de estado y marcador monotónico.
    expect(writerWouldChange({ ...base, status: 'finished', home_score: 2, away_score: 1 }, row, now)).toBe(false);
    expect(writerWouldChange({ ...base, status: 'cancelled' }, row, now)).toBe(false);
    // Fila verificada: estado/marcador intocables; vivo reciente: solo metadatos.
    expect(writerWouldChange({ ...base, final_verified_at: '2026-09-01T00:00:00Z', status: 'finished', home_score: 0, away_score: 0, elapsed: 90 },
      { ...row, status: 'finished', home_score: 1, away_score: 1, elapsed: 90 }, now)).toBe(false);
    expect(writerWouldChange({ ...base, live_updated_at: new Date(now - 60_000).toISOString(), status: 'live', home_score: 1 }, row, now)).toBe(false);
    expect(writerWouldChange({ ...base, live_updated_at: new Date(now - 60_000).toISOString() }, { ...row, home_team: 'A2' }, now)).toBe(true);
  });
});

describe('dry-run legacy estimate', () => {
  it('flags fixtures that would link, collide with two legacy rows, or leave a legacy row behind', () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    const row = (id: number, home: string, away: string, iso: string): AfMatchRow => ({ external_id: `apifootball:${id}`,
      tournament: 'laliga_2025', match_day: 5, phase: 'regular_season', home_team: home, away_team: away, home_team_flag: null,
      away_team_flag: null, scheduled_at: iso, venue: null, home_score: null, away_score: null, status: 'scheduled', elapsed: null,
      scheduled_at_confirmed: true });
    const legacy = (id: string, home: string, away: string, iso: string, ext: string) =>
      ({ ...stored(row(0, home, away, iso), id), external_id: ext });
    const existing = [
      legacy('fd-1', 'Sevilla FC', 'Valencia CF', '2026-09-20T19:00:00Z', '564669'),
      legacy('fd-2', 'Getafe CF', 'Real Betis', '2026-09-21T19:00:00Z', '564670'),
      legacy('espn-2', 'Getafe', 'Real Betis Balompié', '2026-09-21T19:00:00Z', 'espn:1'),
      legacy('fd-3', 'Getafe CF', 'RC Deportivo La Coruña', '2026-09-22T19:00:00Z', '564668'),
      legacy('fd-4', 'Real Betis Balompié', 'Getafe CF', '2026-09-30T19:00:00Z', '564671'),
    ];
    existing[2].home_team = 'Getafe'; existing[2].away_team = 'Real Betis';
    const est = estimateLegacyLinks(existing, [
      row(1, 'Sevilla', 'Valencia', '2026-09-20T19:00:00.000Z'),
      row(2, 'Getafe', 'Real Betis', '2026-09-21T19:30:00.000Z'),
      row(3, 'Getafe', 'Deportivo La Coruna', '2026-09-22T19:00:00.000Z'),
    ], now);
    expect(est).toEqual({ wouldLink: 1, ambiguous: 1, unmatchedLegacyRows: 2 });
  });
});

describe('envelope and season helpers', () => {
  it('accepts a single complete page only', () => {
    expect(validateFixturesEnvelope(envelope([{}])).ok).toBe(true);
    expect(validateFixturesEnvelope({ errors: {}, response: [{}] }).ok).toBe(true);
    expect(validateFixturesEnvelope({ errors: [], paging: { total: 3 }, response: [{}] })).toEqual({ ok: false, reason: 'paged' });
  });

  it('resolves seasons once per run for every league', async () => {
    const resolve = vi.fn(async () => ({ fetchedAt: '2026-09-13T00:00:00Z', byLeague: { '140': 2026, '239': 2026 } }));
    const season = memoizedSeasonResolver(resolve);
    expect(await Promise.all([season(140), season(239), season(999)])).toEqual([2026, 2026, null]);
    expect(resolve).toHaveBeenCalledOnce();
  });
});

type RpcReply = { data: unknown; error: { message: string; code?: string } | null };

describe('calendar quota reservation (migration 116)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps fixtures and leagues to the RPC, and only a literal true grants a request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpc = vi.fn(async (): Promise<RpcReply> => ({ data: true, error: null }));
    const db = { rpc } as unknown as SupabaseClient;
    expect(await reserveCalendarRequest(db, { kind: 'fixtures', leagueId: 239 })).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('reserve_api_football_calendar', { p_league_id: 239, p_kind: 'fixtures' });
    expect(await reserveCalendarRequest(db, { kind: 'leagues' })).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('reserve_api_football_calendar', { p_league_id: 0, p_kind: 'leagues' });

    const denials: RpcReply[] = [
      { data: false, error: null },
      { data: null, error: { message: 'Invalid calendar reservation' } },
      { data: true, error: { message: 'permission denied' } },
      { data: 'true', error: null },
      { data: null, error: null },
    ];
    for (const reply of denials) {
      rpc.mockResolvedValueOnce(reply);
      expect(await reserveCalendarRequest(db, { kind: 'fixtures', leagueId: 140 })).toBe(false);
    }
    rpc.mockRejectedValueOnce(new Error('fetch failed'));
    expect(await reserveCalendarRequest(db, { kind: 'fixtures', leagueId: 140 })).toBe(false);
    // Solo los errores quedan en el log; una negativa de cuota es operación normal.
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('logs the RPC error code so a missing migration is not read as an exhausted quota', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = { rpc: vi.fn(async (): Promise<RpcReply> => ({ data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.reserve_api_football_calendar' } })) } as unknown as SupabaseClient;
    expect(await reserveCalendarRequest(db, { kind: 'leagues' })).toBe(false);
    expect(warn).toHaveBeenCalledWith('[af-calendar] la reserva de cuota falló:', 'PGRST202');
  });
});

describe('server calendar deps', () => {
  const NOW = Date.parse(LALIGA.observedAt);
  const freshSeasons = { fetchedAt: new Date().toISOString(), byLeague: { '140': 2026 } };

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.pro.mockReset();
    mocks.pro.mockResolvedValue(true);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** Cliente mínimo: caché de temporadas en app_config y el RPC de reserva. */
  function serverDb(cache: unknown, reply: (args: Record<string, unknown>) => RpcReply) {
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => reply(args));
    const upsert = vi.fn(async () => ({ error: null }));
    type Query = { select: () => Query; eq: () => Query; maybeSingle: () => Promise<{ data: unknown; error: null }>; upsert: typeof upsert };
    const query: Query = {
      select: () => query, eq: () => query, upsert,
      maybeSingle: async () => ({ data: cache === null ? null : { value: JSON.stringify(cache) }, error: null }),
    };
    return { db: { rpc, from: vi.fn(() => query) } as unknown as SupabaseClient, rpc, upsert };
  }

  it('never reaches the RPC or the provider without a verified paid plan', async () => {
    mocks.pro.mockResolvedValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { db, rpc } = serverDb(freshSeasons, () => ({ data: true, error: null }));
    const d = await createCalendarDeps(db);
    expect(await d.reserveRequest({ kind: 'fixtures', leagueId: 140 })).toBe(false);
    const r = await refreshAfTournament('laliga_2025', {}, { ...d, now: () => NOW, log: () => {} });
    expect(r.aborted).toBe('budget');
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('aborts as budget when the SQL reservation declines or errors, without calling the provider', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const reply of [{ data: false, error: null }, { data: null, error: { message: 'boom' } }] satisfies RpcReply[]) {
      const { db, rpc } = serverDb(freshSeasons, () => reply);
      const d = await createCalendarDeps(db);
      const r = await refreshAfTournament('laliga_2025', {}, { ...d, now: () => NOW, log: () => {} });
      expect(r).toMatchObject({ aborted: 'budget', season: 2026 });
      expect(rpc.mock.calls).toEqual([['reserve_api_football_calendar', { p_league_id: 140, p_kind: 'fixtures' }]]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reserves the single /leagues call before resolving seasons, and skips it when declined', async () => {
    vi.stubEnv('API_FOOTBALL_KEY', 'test-key');
    const leagues = { errors: [], paging: { current: 1, total: 1 },
      response: [{ league: { id: 140 }, seasons: [{ year: 2026, current: true }] }] };
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => leagues }));
    vi.stubGlobal('fetch', fetchSpy);

    const declined = serverDb(null, () => ({ data: false, error: null }));
    expect(await (await createCalendarDeps(declined.db)).resolveSeason(140)).toBeNull();
    expect(declined.rpc.mock.calls).toEqual([['reserve_api_football_calendar', { p_league_id: 0, p_kind: 'leagues' }]]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const granted = serverDb(null, () => ({ data: true, error: null }));
    const d = await createCalendarDeps(granted.db);
    expect(await Promise.all([d.resolveSeason(140), d.resolveSeason(140)])).toEqual([2026, 2026]);
    expect(granted.rpc).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('/leagues?current=true');
    expect(granted.upsert).toHaveBeenCalledOnce();
  });
});
