import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyRound, inferFeedPrecision, mapStatus, roundToPhase, trimFixture, type CalendarFixture,
} from '@/lib/api-football/calendar-model';
import { mapApiStatus } from '@/lib/api-football/mappers';
import {
  afLeagueIdForTournament, feedMatchesSeason, parseCurrentSeasons, resolveCurrentSeasons,
  resolveTournamentSeason, tournamentForAfLeague, type CurrentSeasons, type SeasonCache,
} from '@/lib/api-football/season';
import { CREATABLE_TOURNAMENT_SLUGS } from '@/lib/tournaments';
import { TOURNAMENT_STRUCTURE } from '@/lib/tournaments/structure';

// Respuestas reales de API-Football del 2026-09-13, recortadas (sin key ni headers).
type FeedFile = { source: string; observedAt: string; response: unknown[] };
const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/api-football/${name}`, import.meta.url), 'utf8')) as FeedFile;
const FEEDS = {
  ucl: load('ucl-2026.trimmed.json'),
  laliga: load('laliga-2026.trimmed.json'),
  libertadores: load('libertadores-2026.trimmed.json'),
  betplay: load('betplay-2026.trimmed.json'),
};
const LEAGUE_OF = { ucl: 2, laliga: 140, libertadores: 13, betplay: 239 } as const;
// Etiquetas de ronda reales de los once torneos agregados el 2026-09-18, en su
// temporada vigente y en la anterior (así entran también las fases finales que
// todavía no se publican).
const OBSERVED = JSON.parse(readFileSync(new URL('./fixtures/api-football/rounds-observed.json', import.meta.url), 'utf8')) as {
  leagues: { id: number; slug: string; seasons: { year: number; rounds: string[] }[] }[];
};
const fixturesOf = (feed: FeedFile) => feed.response.map((raw) => {
  const f = trimFixture(raw);
  if (!f) throw new Error(`fixture inválido en ${feed.source}`);
  return f;
});
const ALL = Object.values(FEEDS).flatMap((feed) => fixturesOf(feed).map((fixture) => ({ feed, fixture })));
const precisionOf = (feed: FeedFile, observedAt: string | number = feed.observedAt) =>
  inferFeedPrecision(fixturesOf(feed), observedAt);
const inRound = (feed: FeedFile, round: string) => fixturesOf(feed).filter((f) => f.league.round === round);

describe('trimFixture', () => {
  it('keeps the committed files in trimmed shape and drops every extra provider field', () => {
    for (const { fixture } of ALL) expect(trimFixture(fixture)).toEqual(fixture);
    const [sample] = fixturesOf(FEEDS.libertadores);
    const raw = {
      ...sample,
      fixture: { ...sample.fixture, referee: 'X', timezone: 'UTC', periods: { first: 1, second: 2 },
        status: { ...sample.fixture.status, extra: 5 }, venue: { id: 9, name: ' Estadio ', city: null } },
      league: { ...sample.league, name: 'CONMEBOL Libertadores', logo: 'l.png', standings: true },
      teams: { home: { ...sample.teams.home, winner: true }, away: { ...sample.teams.away, winner: false } },
      score: { ...sample.score, halftime: { home: 0, away: 0 } },
    };
    expect(trimFixture(raw)).toEqual({ ...sample, fixture: { ...sample.fixture, venue: { name: 'Estadio', city: null } } });
  });

  it('rejects fixtures whose identity or kickoff cannot be trusted', () => {
    const [f] = fixturesOf(FEEDS.laliga);
    const variants: unknown[] = [
      null,
      { ...f, fixture: { ...f.fixture, timestamp: f.fixture.timestamp + 3600 } },
      { ...f, fixture: { ...f.fixture, id: '1570333' } },
      { ...f, league: { ...f.league, round: '  ' } },
      { ...f, league: { ...f.league, season: null } },
      { ...f, teams: { home: f.teams.home, away: f.teams.home } },
      { ...f, goals: { home: -1, away: 0 } },
      { ...f, fixture: { ...f.fixture, status: { short: '', long: '', elapsed: null } } },
    ];
    for (const v of variants) expect(trimFixture(v)).toBeNull();
  });
});

describe('roundToPhase', () => {
  it('classifies every distinct round present in the real responses', () => {
    const rounds = Array.from(new Set(ALL.map(({ fixture }) => fixture.league.round))).sort();
    const unmapped = rounds.filter((round) => classifyRound(round).kind === 'unknown');
    expect(unmapped).toEqual([]);
    expect(rounds.length).toBeGreaterThanOrEqual(25);
  });

  it('maps to canonical repo phases, with match day and BetPlay segment', () => {
    expect(roundToPhase('Regular Season - 8')).toEqual({ phase: 'regular_season', matchDay: 8, segment: null });
    expect(roundToPhase('Clausura - 19')).toEqual({ phase: 'regular_season', matchDay: 19, segment: 'clausura' });
    expect(roundToPhase('Apertura - 3')).toEqual({ phase: 'regular_season', matchDay: 3, segment: 'apertura' });
    expect(roundToPhase('League Stage - 8')).toEqual({ phase: 'league_stage', matchDay: 8, segment: null });
    expect(roundToPhase('Group Stage - 4')).toEqual({ phase: 'group_stage', matchDay: 4, segment: null });
    expect(roundToPhase('Round of 16')).toEqual({ phase: 'round_of_16', matchDay: null, segment: null });
    expect(roundToPhase('Quarter-finals')).toEqual({ phase: 'quarter_finals', matchDay: null, segment: null });
    expect(roundToPhase('Apertura - Semi-finals')).toEqual({ phase: 'semi_finals', matchDay: null, segment: 'apertura' });
    expect(roundToPhase('Apertura - Final')).toEqual({ phase: 'final', matchDay: null, segment: 'apertura' });
    expect(roundToPhase('Knockout Round Play-offs')?.phase).toBe('playoff');
    expect(roundToPhase('3rd Place Final')?.phase).toBe('third_place');

    const canonical = new Set(Object.values(TOURNAMENT_STRUCTURE).flatMap((t) => t.phases.map((p) => p.phase)));
    for (const { fixture } of ALL) {
      const phase = roundToPhase(fixture.league.round)?.phase;
      if (phase) expect(canonical.has(phase)).toBe(true);
    }
  });

  it('classifies every round the newly added competitions really emit', () => {
    const canonical = new Set(Object.values(TOURNAMENT_STRUCTURE).flatMap((t) => t.phases.map((p) => p.phase)));
    const unmapped: string[] = [];
    let seen = 0;
    for (const league of OBSERVED.leagues) {
      // La estructura declarada del torneo no puede quedarse corta respecto a
      // lo que el proveedor manda: si emite una fase que no listamos, la UI la
      // mostraría sin nombre.
      const declared = new Set(TOURNAMENT_STRUCTURE[league.slug].phases.map((p) => p.phase));
      for (const season of league.seasons) {
        for (const round of season.rounds) {
          seen += 1;
          const c = classifyRound(round, league.id);
          if (c.kind === 'unknown') { unmapped.push(`${league.slug} ${season.year}: ${round}`); continue; }
          if (c.kind !== 'phase') continue;
          expect(canonical.has(c.phase)).toBe(true);
          expect({ slug: league.slug, round, phase: c.phase, declared: declared.has(c.phase) })
            .toEqual({ slug: league.slug, round, phase: c.phase, declared: true });
        }
      }
    }
    expect(unmapped).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(400);
  });

  it('keeps a round name ambiguous across competitions tied to its league', () => {
    // «Play-offs» es la ronda previa a octavos en la Copa Colombia y la previa
    // de agosto que NO guardamos en la UEFA. Sin liga, se mantiene excluida.
    expect(classifyRound('Play-offs', 241)).toEqual({ kind: 'phase', phase: 'round_of_32', matchDay: null, segment: null });
    expect(classifyRound('Play-offs', 2)).toEqual({ kind: 'excluded', reason: 'ambiguous' });
    expect(classifyRound('Play-offs')).toEqual({ kind: 'excluded', reason: 'ambiguous' });
    // Un «3» pelado solo es jornada en la Nations League.
    expect(classifyRound('3', 5)).toEqual({ kind: 'phase', phase: 'league_stage', matchDay: 3, segment: null });
    expect(classifyRound('3', 239)).toEqual({ kind: 'unknown' });
    expect(classifyRound('3')).toEqual({ kind: 'unknown' });
    expect(classifyRound('0', 5)).toEqual({ kind: 'unknown' });
    // Rondas tempranas de copa: conocidas, no guardadas y sin alerta al admin.
    for (const round of ['1st Round', '2nd Round', '3rd Round', 'Round of 128', '1/128-finals', '1/256-finals']) {
      expect(classifyRound(round, 73)).toEqual({ kind: 'excluded', reason: 'early_cup_round' });
      expect(roundToPhase(round, 73)).toBeNull();
    }
    expect(roundToPhase('Round of 64', 130)?.phase).toBe('round_of_64');
    expect(roundToPhase('Playoff round', 848)?.phase).toBe('playoff');
    expect(roundToPhase('Apertura - Play-In Final', 262)).toEqual({ phase: 'playoff', matchDay: null, segment: 'apertura' });
    expect(roundToPhase('Play-offs A/B', 5)?.phase).toBe('playoff');
    expect(roundToPhase('League C - 4', 5)).toEqual({ phase: 'league_stage', matchDay: 4, segment: null });
    expect(roundToPhase('1st Round - 2', 241)).toEqual({ phase: 'group_stage', matchDay: 2, segment: null });
  });

  it('blocks qualifying rounds, the ambiguous UEFA "Play-offs" and anything unknown', () => {
    for (const round of ['1st Qualifying Round', '3rd Qualifying Round', 'Qualification Round 2']) {
      expect(classifyRound(round)).toEqual({ kind: 'excluded', reason: 'qualifying' });
      expect(roundToPhase(round)).toBeNull();
    }
    // Los "Play-offs" UEFA de 2026 se jugaron en agosto, antes de la fase de liga.
    expect(inRound(FEEDS.ucl, 'Play-offs').every((f) => f.fixture.date < '2026-09-01')).toBe(true);
    expect(roundToPhase('Play-offs')).toBeNull();
    for (const round of ['Clausura - Quadrangular A - 1', 'Relegation Round', 'regular season - 8',
      'Regular Season - 0', 'Semi-finals - 1', 'Final Series', '']) {
      expect(classifyRound(round)).toEqual({ kind: 'unknown' });
      expect(roundToPhase(round)).toBeNull();
    }
  });
});

describe('mapStatus', () => {
  it('never turns a postponed fixture into cancelled', () => {
    const postponed = ALL.filter(({ fixture }) => fixture.fixture.status.short === 'PST');
    expect(postponed.map(({ fixture }) => fixture.fixture.id)).toEqual(expect.arrayContaining([1549770, 1549750]));
    for (const { fixture } of postponed) {
      expect(mapStatus(fixture.fixture.status.short)).toEqual({ status: 'scheduled', detail: 'STATUS_POSTPONED' });
    }
    expect(mapStatus('CANC')?.status).toBe('cancelled');
    expect(mapStatus('ABD')?.status).toBe('cancelled');
  });

  it('keeps mappers.ts semantics for every other known code and ignores unknown codes', () => {
    for (const code of ['TBD', 'NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'SUSP', 'INT',
      'FT', 'AET', 'PEN', 'AWD', 'WO', 'CANC', 'ABD']) {
      expect(mapStatus(code)?.status).toBe(mapApiStatus(code));
    }
    for (const { fixture } of ALL) expect(mapStatus(fixture.fixture.status.short)).not.toBeNull();
    expect(mapStatus('XYZ')).toBeNull();
    expect(mapStatus('toString')).toBeNull();
  });
});

describe('inferPrecision', () => {
  it('marks LaLiga placeholder rounds as not movable, without degrading insert precision', () => {
    const precision = precisionOf(FEEDS.laliga);
    for (const round of ['Regular Season - 8', 'Regular Season - 10']) {
      for (const f of inRound(FEEDS.laliga, round)) {
        expect(precision.get(f.fixture.id)).toEqual({ confirmed: true, movable: false, reason: 'uniform_round' });
      }
    }
    for (const f of inRound(FEEDS.laliga, 'Regular Season - 7')) {
      expect(precision.get(f.fixture.id)).toEqual({ confirmed: true, movable: true, reason: 'confirmed' });
    }
  });

  it('only blocks moves far from kickoff: the same round ten days out becomes movable', () => {
    const [first] = inRound(FEEDS.laliga, 'Regular Season - 8');
    const nineDaysBefore = first.fixture.timestamp * 1000 - 9 * 86_400_000;
    for (const f of inRound(FEEDS.laliga, 'Regular Season - 8')) {
      expect(precisionOf(FEEDS.laliga, nineDaysBefore).get(f.fixture.id)?.movable).toBe(true);
    }
  });

  it('with ignoreLead (calendar import) a filler round stays uniform even nine days before kickoff', () => {
    const round = inRound(FEEDS.laliga, 'Regular Season - 8');
    const nineDaysBefore = round[0].fixture.timestamp * 1000 - 9 * 86_400_000;
    const precision = inferFeedPrecision(fixturesOf(FEEDS.laliga), nineDaysBefore, true);
    for (const f of round) expect(precision.get(f.fixture.id)?.reason).toBe('uniform_round');
  });

  it('treats genuinely simultaneous rounds as confirmed for inserts (UCL League Stage 8, BetPlay Clausura 19)', () => {
    const ucl = precisionOf(FEEDS.ucl);
    for (const f of inRound(FEEDS.ucl, 'League Stage - 8')) {
      expect(ucl.get(f.fixture.id)).toEqual({ confirmed: true, movable: false, reason: 'uniform_round' });
    }
    for (const f of inRound(FEEDS.ucl, 'League Stage - 2')) expect(ucl.get(f.fixture.id)?.movable).toBe(true);
    const betplay = precisionOf(FEEDS.betplay);
    for (const f of inRound(FEEDS.betplay, 'Clausura - 19')) expect(betplay.get(f.fixture.id)?.movable).toBe(false);
  });

  it('makes every TBD and past PST provisional; a PST still ahead keeps its kickoff like NS (2026-09-13)', () => {
    let provisional = 0, upcomingPostponed = 0;
    for (const { feed, fixture } of ALL) {
      const p = precisionOf(feed).get(fixture.fixture.id)!;
      const short = fixture.fixture.status.short;
      const ahead = fixture.fixture.timestamp * 1000 > Date.parse(feed.observedAt);
      if (short === 'TBD' || (short === 'PST' && !ahead)) {
        provisional++;
        expect(p).toMatchObject({ confirmed: false, movable: false });
      } else if (short === 'PST') {
        upcomingPostponed++;
        expect(p.reason === 'confirmed' || p.reason === 'uniform_round').toBe(true);
        expect(p.confirmed).toBe(true);
      } else {
        expect(p.confirmed).toBe(true);
      }
      if (short !== 'NS' && !(short === 'PST' && ahead)) expect(p.movable).toBe(false);
    }
    expect(provisional).toBeGreaterThanOrEqual(2);
    expect(upcomingPostponed).toBeGreaterThanOrEqual(1);
    expect(precisionOf(FEEDS.betplay).get(1549712)).toEqual({ confirmed: false, movable: false, reason: 'time_to_be_defined' });
    expect(precisionOf(FEEDS.betplay).get(1549770)).toEqual({ confirmed: false, movable: false, reason: 'postponed' });
    // Once Caldas–Tolima: aplazado en API-Football pero con la hora nueva (16-sep 23:15 UTC).
    expect(precisionOf(FEEDS.betplay).get(1549750)).toEqual({ confirmed: true, movable: true, reason: 'confirmed' });
    // Observado después del saque vuelve a ser provisional: no hay fecha nueva que mostrar.
    const [caldas] = fixturesOf(FEEDS.betplay).filter((f) => f.fixture.id === 1549750);
    expect(precisionOf(FEEDS.betplay, caldas.fixture.timestamp * 1000 + 60_000).get(1549750)).toEqual({ confirmed: false, movable: false, reason: 'postponed' });
  });

  it('ignores rounds with fewer than five unstarted fixtures and rejects a missing observation time', () => {
    const eight = inRound(FEEDS.laliga, 'Regular Season - 8').slice(0, 4);
    const partial = inferFeedPrecision(eight, FEEDS.laliga.observedAt);
    for (const f of eight) expect(partial.get(f.fixture.id)?.movable).toBe(true);
    expect(() => inferFeedPrecision(eight, 'not a date')).toThrow(RangeError);
  });
});

describe('season resolution', () => {
  const leagues = load('leagues-current-2026.trimmed.json');
  const cacheWith = (value: CurrentSeasons | null) => {
    const cache: SeasonCache & { written: CurrentSeasons[] } = {
      written: [], read: vi.fn(async () => value), write: vi.fn(async (v: CurrentSeasons) => { cache.written.push(v); }),
    };
    return cache;
  };
  const NOW = Date.parse('2026-09-13T12:00:00Z');
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  it('resolves an API-Football league for every repo tournament, one to one', () => {
    expect(CREATABLE_TOURNAMENT_SLUGS).toHaveLength(21);
    const ids = CREATABLE_TOURNAMENT_SLUGS.map((slug) => afLeagueIdForTournament(slug));
    for (const [i, leagueId] of ids.entries()) {
      expect(Number.isSafeInteger(leagueId) && leagueId! > 0).toBe(true);
      expect(tournamentForAfLeague(leagueId!)).toBe(CREATABLE_TOURNAMENT_SLUGS[i]);
    }
    expect(new Set(ids).size).toBe(21);
    expect(afLeagueIdForTournament('worldcup_2026')).toBeNull();
    expect(afLeagueIdForTournament('constructor')).toBeNull();
  });

  it('reads season 2026 for every repo league from /leagues?current=true, ignoring the slug suffix', async () => {
    const parsed = parseCurrentSeasons(leagues, leagues.observedAt);
    expect(Object.keys(parsed.byLeague)).toHaveLength(21);
    for (const slug of CREATABLE_TOURNAMENT_SLUGS) {
      expect(parsed.byLeague[String(afLeagueIdForTournament(slug))]).toBe(2026);
    }
    expect(parsed.byLeague['807']).toBeUndefined();
    const fetchLeagues = vi.fn(async () => leagues);
    expect(await resolveTournamentSeason('champions_2025', { fetchLeagues, cache: cacheWith(null), now: () => NOW }))
      .toEqual({ leagueId: 2, season: 2026, source: 'network', fetchedAt: '2026-09-13T12:00:00.000Z' });
  });

  it('uses a cache younger than a day without calling the provider', async () => {
    const fetchLeagues = vi.fn(async () => leagues);
    const cache = cacheWith({ fetchedAt: hoursAgo(23), byLeague: { '140': 2026 } });
    expect(await resolveCurrentSeasons({ fetchLeagues, cache, now: () => NOW }))
      .toMatchObject({ source: 'cache', seasons: { byLeague: { '140': 2026 } } });
    expect(fetchLeagues).not.toHaveBeenCalled();
  });

  it('refreshes an old cache once and falls back to it only up to 72 hours', async () => {
    const fetchLeagues = vi.fn(async () => leagues);
    const cache = cacheWith({ fetchedAt: hoursAgo(25), byLeague: { '140': 2025 } });
    const fresh = await resolveCurrentSeasons({ fetchLeagues, cache, now: () => NOW });
    expect(fresh?.source).toBe('network');
    expect(fresh?.seasons.byLeague['140']).toBe(2026);
    expect(cache.written).toHaveLength(1);
    expect(fetchLeagues).toHaveBeenCalledOnce();

    const failing = vi.fn(async () => { throw new Error('reserva negada'); });
    expect((await resolveCurrentSeasons({ fetchLeagues: failing, cache: cacheWith({ fetchedAt: hoursAgo(30), byLeague: { '2': 2026 } }), now: () => NOW }))?.source)
      .toBe('stale_cache');
    expect(await resolveCurrentSeasons({ fetchLeagues: failing, cache: cacheWith({ fetchedAt: hoursAgo(80), byLeague: { '2': 2026 } }), now: () => NOW }))
      .toBeNull();
    expect(await resolveCurrentSeasons({ fetchLeagues: failing, cache: cacheWith({ fetchedAt: new Date(NOW + 3_600_000).toISOString(), byLeague: { '2': 2026 } }), now: () => NOW }))
      .toBeNull();
  });

  it('keeps a validated response even if writing the cache fails', async () => {
    const cache = cacheWith(null);
    cache.write = vi.fn(async () => { throw new Error('db down'); });
    expect((await resolveCurrentSeasons({ fetchLeagues: async () => leagues, cache, now: () => NOW }))?.source).toBe('network');
  });

  it('rejects partial or error responses and leaves ambiguous leagues unresolved', async () => {
    expect(() => parseCurrentSeasons({ ...leagues, errors: { requests: 'limit reached' } }, leagues.observedAt)).toThrow();
    expect(() => parseCurrentSeasons({ ...leagues, errors: ['x'] }, leagues.observedAt)).toThrow();
    expect(() => parseCurrentSeasons({ ...leagues, paging: { current: 1, total: 2 } }, leagues.observedAt)).toThrow();
    expect(() => parseCurrentSeasons({ errors: [], response: [] }, leagues.observedAt)).toThrow();
    expect(() => parseCurrentSeasons('<html>', leagues.observedAt)).toThrow();

    const response = (leagues.response as { league: { id: number }; seasons: object[] }[]).map((entry) =>
      entry.league.id === 140 ? { ...entry, seasons: [{ year: 2025, current: true }, { year: 2026, current: true }] }
        : entry.league.id === 39 ? { ...entry, seasons: [{ year: 2026, current: false }] } : entry);
    const parsed = parseCurrentSeasons(response, leagues.observedAt);
    expect(parsed.byLeague['140']).toBeUndefined();
    expect(parsed.byLeague['39']).toBeUndefined();
    expect(parsed.byLeague['2']).toBe(2026);

    const cache = cacheWith(null);
    expect(await resolveTournamentSeason('laliga_2025', { fetchLeagues: async () => response, cache, now: () => NOW })).toBeNull();
  });

  it('cross-checks each fixtures response against league.season', () => {
    for (const [key, feed] of Object.entries(FEEDS)) {
      const leagueId = LEAGUE_OF[key as keyof typeof LEAGUE_OF];
      const fixtures: CalendarFixture[] = fixturesOf(feed);
      expect(feedMatchesSeason(leagueId, 2026, fixtures)).toBe(true);
      expect(feedMatchesSeason(leagueId, 2025, fixtures)).toBe(false);
      expect(feedMatchesSeason(leagueId === 2 ? 3 : 2, 2026, fixtures)).toBe(false);
    }
    expect(feedMatchesSeason(2, 2026, [])).toBe(false);
  });
});
