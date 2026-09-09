import { teamNameKey } from '@/lib/teams/team-name-key';
import type { ApiFootballFixture } from './mappers';

export const RESULT_LEAGUES: Record<string, number> = {
  betplay_2026: 239, libertadores_2026: 13, sudamericana_2026: 11,
  champions_2025: 2, premier_2025: 39, ligue1_2025: 61,
  bundesliga_2025: 78, laliga_2025: 140, seriea_2025: 135,
};

const ALIASES: Record<string, string> = {
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
