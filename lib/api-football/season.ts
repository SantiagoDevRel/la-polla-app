/**
 * Temporada vigente de cada liga en API-Football (Paso 1 del plan del
 * 2026-09-13). Puro: la llamada HTTP y la caché llegan inyectadas, así que
 * esto no toca red ni DB. Conectar la caché a la DB es trabajo del Paso 3.
 *
 * La temporada la dice `/leagues?current=true`: UNA llamada cubre las diez
 * ligas y se guarda un día. Nunca se deriva del sufijo del slug
 * (`champions_2025` es la temporada 2026 de AF) ni de getSeasonForLeague.
 * Después, cada respuesta de /fixtures se contrasta con `league.season`.
 */
import { RESULT_LEAGUES } from './leagues';

/** La caché sirve sin llamar durante un día. */
export const SEASON_CACHE_MAX_AGE_MS = 24 * 3_600_000;
/** Si la llamada falla, una caché de hasta 72 h todavía sirve. Más vieja, no. */
export const SEASON_CACHE_STALE_LIMIT_MS = 72 * 3_600_000;
/** Tolerancia de reloj para una caché fechada en el futuro. */
const CLOCK_SKEW_MS = 5 * 60_000;

export interface CurrentSeasons {
  fetchedAt: string;
  /** Id de liga AF (como texto, para que viaje igual en JSON) → año de temporada. */
  byLeague: Record<string, number>;
}

export interface SeasonCache {
  read(): Promise<CurrentSeasons | null>;
  write(value: CurrentSeasons): Promise<void>;
}

/**
 * Devuelve el cuerpo de GET /leagues?current=true: el sobre completo
 * ({errors, paging, response}) o solo `response`, como lo da apiFootballGet.
 * Debe lanzar si la reserva de cuota se niega; eso cae a la caché.
 */
export type LeaguesFetcher = () => Promise<unknown>;

export interface SeasonDeps {
  fetchLeagues: LeaguesFetcher;
  cache: SeasonCache;
  now?: () => number;
}

export type SeasonSource = 'cache' | 'network' | 'stale_cache';

export function afLeagueIdForTournament(slug: string): number | null {
  return Object.prototype.hasOwnProperty.call(RESULT_LEAGUES, slug) ? RESULT_LEAGUES[slug] : null;
}

export function tournamentForAfLeague(leagueId: number): string | null {
  return Object.keys(RESULT_LEAGUES).find((slug) => RESULT_LEAGUES[slug] === leagueId) ?? null;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Un 200 con `errors` o con más de una página no es una respuesta completa. */
function responseArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const envelope = record(body);
  if (!envelope || !Array.isArray(envelope.response)) throw new Error('Respuesta de ligas inválida');
  const errors = envelope.errors;
  if (Array.isArray(errors) ? errors.length > 0 : Object.keys(record(errors) ?? {}).length > 0) {
    throw new Error('API-Football devolvió errores en /leagues');
  }
  const total = record(envelope.paging)?.total;
  if (total !== undefined && total !== 1) throw new Error('Respuesta de ligas paginada o parcial');
  return envelope.response;
}

/**
 * Extrae la temporada vigente de las ligas del repo. Una liga queda sin
 * resolver si aparece dos veces, si no tiene exactamente una temporada
 * `current` o si el año no es razonable: sin temporada segura, 0 llamadas de
 * calendario para esa liga. No se mira `end`: AF lo corre al último partido
 * publicado (Libertadores 2026 decía 2026-09-15 aunque faltan semis).
 */
export function parseCurrentSeasons(body: unknown, fetchedAt: string): CurrentSeasons {
  const entries = responseArray(body);
  const byLeague: Record<string, number> = {};
  for (const leagueId of Object.values(RESULT_LEAGUES)) {
    const matches = entries.filter((e) => record(record(e)?.league)?.id === leagueId);
    if (matches.length !== 1) continue;
    const seasons = record(matches[0])?.seasons;
    const current = Array.isArray(seasons) ? seasons.map(record).filter((s) => s?.current === true) : [];
    const year = current.length === 1 ? current[0]?.year : null;
    if (typeof year === 'number' && Number.isInteger(year) && year >= 2000 && year <= 2100) {
      byLeague[String(leagueId)] = year;
    }
  }
  if (!Object.keys(byLeague).length) throw new Error('La respuesta no trae ninguna liga del repo');
  return { fetchedAt, byLeague };
}

function validCache(value: CurrentSeasons | null, now: number): { value: CurrentSeasons; age: number } | null {
  const fetched = Date.parse(value?.fetchedAt ?? '');
  if (!value || !Number.isFinite(fetched) || fetched - now > CLOCK_SKEW_MS || !record(value.byLeague)) return null;
  return { value, age: Math.max(0, now - fetched) };
}

/**
 * Caché de menos de 24 h → sin llamada. Si no, una llamada; si falla o no
 * sirve, la caché de hasta 72 h; si tampoco hay, null. Un fallo al escribir
 * la caché no invalida la respuesta ya validada.
 */
export async function resolveCurrentSeasons(
  deps: SeasonDeps,
): Promise<{ seasons: CurrentSeasons; source: SeasonSource } | null> {
  const now = (deps.now ?? Date.now)();
  let cached: { value: CurrentSeasons; age: number } | null = null;
  try { cached = validCache(await deps.cache.read(), now); } catch { cached = null; }
  if (cached && cached.age < SEASON_CACHE_MAX_AGE_MS) return { seasons: cached.value, source: 'cache' };

  try {
    const seasons = parseCurrentSeasons(await deps.fetchLeagues(), new Date(now).toISOString());
    try { await deps.cache.write(seasons); } catch { /* la próxima corrida vuelve a intentar */ }
    return { seasons, source: 'network' };
  } catch {
    return cached && cached.age < SEASON_CACHE_STALE_LIMIT_MS ? { seasons: cached.value, source: 'stale_cache' } : null;
  }
}

/** Temporada AF de un torneo del repo, o null si no hay una segura. */
export async function resolveTournamentSeason(
  slug: string,
  deps: SeasonDeps,
): Promise<{ leagueId: number; season: number; source: SeasonSource; fetchedAt: string } | null> {
  const leagueId = afLeagueIdForTournament(slug);
  if (!leagueId) return null;
  const resolved = await resolveCurrentSeasons(deps);
  const season = resolved?.seasons.byLeague[String(leagueId)];
  return resolved && season ? { leagueId, season, source: resolved.source, fetchedAt: resolved.seasons.fetchedAt } : null;
}

/**
 * Contraste con la respuesta de /fixtures: todos los partidos deben ser de
 * esa liga y esa temporada. Una respuesta vacía NO verifica la temporada.
 */
export function feedMatchesSeason(
  leagueId: number,
  season: number,
  fixtures: ReadonlyArray<{ league: { id: number; season: number } }>,
): boolean {
  return fixtures.length > 0 && fixtures.every((f) => f.league.id === leagueId && f.league.season === season);
}
