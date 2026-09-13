import { teamNameKey } from './team-name-key';

/** The part of `crest-coverage.json` the catalog reads; `observedTeams` is ignored on purpose. */
export interface TeamCoverage {
  leagues: readonly { slug: string; teams: readonly { id: number; name: string; source: string }[] }[];
}

/** One API-Football team (the id opens `/futbol/equipos/<id>`), with every tournament it plays. */
export interface CatalogTeam { id: number; name: string; logo: string; tournaments: string[] }

export interface TeamSearchResult { results: CatalogTeam[]; total: number }

/** Minimum length of the normalized query before the catalog is searched. */
export const TEAM_SEARCH_MIN_LENGTH = 2;

/**
 * Deduplicates the coverage leagues by team id. Build it on the server and pass
 * the result down, so the coverage file never enters the client bundle. A club
 * listed in several leagues keeps its first name and logo and gathers every slug.
 */
export function buildTeamCatalog(coverage: TeamCoverage): CatalogTeam[] {
  const byId = new Map<number, CatalogTeam>();
  for (const league of coverage.leagues) {
    for (const team of league.teams) {
      if (!Number.isSafeInteger(team.id) || team.id <= 0 || !team.name.trim()) continue;
      const known = byId.get(team.id);
      if (!known) byId.set(team.id, { id: team.id, name: team.name, logo: team.source, tournaments: [league.slug] });
      else if (!known.tournaments.includes(league.slug)) known.tournaments.push(league.slug);
    }
  }
  return Array.from(byId.values());
}

const spanish = new Intl.Collator('es');

/**
 * Accent- and case-insensitive substring search over the local catalog: no API
 * request. `tournament` is 'all' or a tournament slug. Names that start with the
 * query come first, then Spanish alphabetical order; `total` counts every match.
 */
export function searchTeams(catalog: readonly CatalogTeam[], query: string, tournament: string, limit: number): TeamSearchResult {
  const key = teamNameKey(query);
  if (key.length < TEAM_SEARCH_MIN_LENGTH) return { results: [], total: 0 };
  const found: { team: CatalogTeam; prefix: boolean }[] = [];
  for (const team of catalog) {
    if (tournament !== 'all' && !team.tournaments.includes(tournament)) continue;
    const at = teamNameKey(team.name).indexOf(key);
    if (at >= 0) found.push({ team, prefix: at === 0 });
  }
  found.sort((a, b) => Number(b.prefix) - Number(a.prefix) || spanish.compare(a.team.name, b.team.name) || a.team.id - b.team.id);
  return { results: found.slice(0, Math.max(0, limit)).map(entry => entry.team), total: found.length };
}
