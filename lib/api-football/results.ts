import { teamNameKey } from '@/lib/teams/team-name-key';
import type { ApiFootballFixture } from './mappers';

import { RESULT_LEAGUES } from './leagues';
export { RESULT_LEAGUES } from './leagues';

const ALIASES: Record<string, string> = {
  'feyenoord rotterdam': 'feyenoord', 'viking fk': 'viking',
  'paris saint germain': 'psg', 'paris saintgermain': 'psg',
  'bayern munich': 'bayern munchen', 'internazionale milano': 'inter',
  'internazionale': 'inter', 'inter milan': 'inter', 'milano': 'milan',
  'athletic bilbao': 'athletic club', 'atletico de madrid': 'atletico madrid',
  'olympique de marseille': 'marseille', 'olympique lyonnais': 'lyon',
  'tottenham hotspur': 'tottenham', 'wolverhampton wanderers': 'wolves',
  'borussia monchengladbach': 'borussia mgladbach',
  'deportivo independiente medellin': 'independiente medellin',
  'independiente santa fe': 'santa fe', 'atletico junior': 'junior',
};

export function resultTeamKey(name: string): string {
  const key = teamNameKey(name).replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cf|afc|sc|ac|ca|rc|as|ssc|1909|1899|04)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return ALIASES[key] ?? key;
}

export interface ResultMatch {
  tournament: string; home_team: string; away_team: string; scheduled_at: string;
}

/** Both teams, competition AND kickoff must agree. Ambiguity never settles a prize. */
export function findResultFixture(match: ResultMatch, fixtures: ApiFootballFixture[]): ApiFootballFixture | null {
  const home = resultTeamKey(match.home_team), away = resultTeamKey(match.away_team);
  if (!home || !away || !RESULT_LEAGUES[match.tournament]) return null;
  const found = fixtures.filter(f => f.league?.id === RESULT_LEAGUES[match.tournament]
    && Math.abs(Date.parse(f.fixture.date) - Date.parse(match.scheduled_at)) <= 2 * 3600000
    && resultTeamKey(f.teams.home.name) === home && resultTeamKey(f.teams.away.name) === away);
  return found.length === 1 ? found[0] : null;
}

/** Row identity as written by the API-Football calendar (external_id) or linked by the writer (source_external_ids). */
export interface LinkedResultMatch extends ResultMatch {
  external_id: string | null; source_external_ids?: string[] | null;
}

const LINK = /^apifootball:(\d{1,12})$/;

/**
 * Fixture id of a row owned by or linked to API-Football. Two different ids on
 * one row mean a duplicated identity: 'ambiguous' never settles or updates anything.
 */
export function linkedFixtureId(match: Pick<LinkedResultMatch, 'external_id' | 'source_external_ids'>): number | 'ambiguous' | null {
  const ids = new Set<number>();
  for (const value of [match.external_id, ...(match.source_external_ids ?? [])]) {
    const hit = typeof value === 'string' ? value.match(LINK) : null;
    if (hit) ids.add(Number(hit[1]));
  }
  if (ids.size > 1) return 'ambiguous';
  const [id] = Array.from(ids);
  return id !== undefined && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Live and final identity. Linked rows are matched by fixture id plus
 * competition (names on rows created before 2026-09-13 can differ from
 * API-Football); rows with no link keep the strict name/kickoff rule of
 * findResultFixture.
 */
export function resolveResultFixture(match: LinkedResultMatch, fixtures: ApiFootballFixture[]): ApiFootballFixture | null {
  const linked = linkedFixtureId(match);
  if (linked === 'ambiguous') return null;
  if (linked === null) return findResultFixture(match, fixtures);
  const league = RESULT_LEAGUES[match.tournament];
  if (!league) return null;
  return fixtures.find(f => f.fixture.id === linked && f.league?.id === league) ?? null;
}

export function scorePair(value: unknown): value is {home: number; away: number} {
  if (!value || typeof value !== 'object') return false;
  const p = value as {home: unknown; away: unknown};
  return typeof p.home === 'number' && Number.isInteger(p.home) && p.home >= 0
    && typeof p.away === 'number' && Number.isInteger(p.away) && p.away >= 0;
}

export function readFinalResult(f: ApiFootballFixture) {
  if (!['FT', 'AET', 'PEN'].includes(f.fixture.status.short) || !scorePair(f.score?.fulltime)) return null;
  const {home, away} = f.score.fulltime;
  if (scorePair(f.goals) && (f.goals.home < home || f.goals.away < away
    || (f.fixture.status.short === 'FT' && (f.goals.home !== home || f.goals.away !== away)))) return null;
  return {home, away, outcome: home > away ? '1' : home < away ? '2' : 'X',
    wentToExtraTime: f.fixture.status.short !== 'FT',
    fulltime: scorePair(f.goals) ? f.goals : null,
    penalty: scorePair(f.score.penalty) ? f.score.penalty : null};
}

/** Re-reading a cached response is NOT a second independent observation. */
export function confirmedObservation(notes: string, fixtureId: number, home: number, away: number, fetchedAt: string) {
  const seen = notes.match(/ afseen=(\d+):(\d+)-(\d+)@(\S+)/);
  return seen !== null && Number(seen[1]) === fixtureId && Number(seen[2]) === home
    && Number(seen[3]) === away && Date.parse(fetchedAt) - Date.parse(seen[4]) >= 50_000;
}
