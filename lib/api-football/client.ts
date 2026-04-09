/**
 * API-Football Client (via RapidAPI)
 *
 * Wrapper de axios configurado con los headers de autenticación de RapidAPI
 * y manejo automático de errores y rate limits.
 *
 * Variables de entorno requeridas:
 * - RAPIDAPI_KEY: tu API key de RapidAPI
 * - RAPIDAPI_HOST: 'v3.football.api-sports.io' (default)
 *
 * Alternativa (si usas api-sports directamente sin RapidAPI):
 * - API_FOOTBALL_KEY: x-apisports-key header
 *
 * Rate limits del plan gratuito:
 * - 100 requests/día
 * - Se implementa retry automático con backoff exponencial en caso de 429
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

/** Tiempo máximo de espera para una respuesta de la API */
const REQUEST_TIMEOUT_MS = 15_000;

/** Número máximo de reintentos ante errores 429 (rate limit) o 5xx */
const MAX_RETRIES = 3;

/** Base de espera para backoff exponencial (ms) */
const BASE_BACKOFF_MS = 2_000;

// ─────────────────────────────────────────
// Legacy exports (backward compatibility con app/api/matches/route.ts anterior)
// ─────────────────────────────────────────

export interface Match {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  date: string;
  status: string;
  league: string;
}

/**
 * Crea y configura una instancia de axios con los headers correctos.
 *
 * Soporta dos modos de autenticación:
 * 1. RapidAPI: usa RAPIDAPI_KEY + x-rapidapi-key header
 * 2. Directo: usa API_FOOTBALL_KEY + x-apisports-key header
 *
 * Detecta automáticamente cuál usar según las variables de entorno disponibles.
 */
function createClient(): AxiosInstance {
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  const apiSportsKey = process.env.API_FOOTBALL_KEY;

  if (!rapidApiKey && !apiSportsKey) {
    throw new Error(
      'Falta API key. Configura RAPIDAPI_KEY (RapidAPI) o API_FOOTBALL_KEY (api-sports directo).'
    );
  }

  const host = process.env.RAPIDAPI_HOST || 'v3.football.api-sports.io';

  // Headers según el modo de autenticación
  const headers: Record<string, string> = rapidApiKey
    ? { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': host }
    : { 'x-apisports-key': apiSportsKey! };

  return axios.create({
    baseURL: `https://${host}`,
    timeout: REQUEST_TIMEOUT_MS,
    headers,
  });
}

/**
 * Espera un tiempo determinado (para backoff entre reintentos).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Realiza una petición GET a la API-Football con retry automático.
 *
 * Si la API devuelve 429 (rate limit) o un error 5xx, reintenta
 * hasta MAX_RETRIES veces con backoff exponencial (2s, 4s, 8s).
 *
 * @param endpoint - Path del endpoint (ej: '/fixtures')
 * @param params - Query parameters (ej: { league: 1, season: 2026 })
 * @returns La respuesta de la API (campo `response` del JSON)
 *
 * La estructura de respuesta de API-Football siempre es:
 * {
 *   "get": "fixtures",
 *   "parameters": { ... },
 *   "errors": [],
 *   "results": 48,
 *   "paging": { "current": 1, "total": 1 },
 *   "response": [ ...datos... ]
 * }
 */
export async function apiFootballGet<T = unknown>(
  endpoint: string,
  params: Record<string, string | number>
): Promise<T[]> {
  const client = createClient();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await client.get(endpoint, { params });

      // API-Football devuelve errores dentro del JSON, no como HTTP errors
      if (data.errors && Object.keys(data.errors).length > 0) {
        const errorMsg = JSON.stringify(data.errors);
        console.error(`[api-football] Error en respuesta: ${errorMsg}`);
        throw new Error(`API-Football error: ${errorMsg}`);
      }

      return data.response as T[];
    } catch (error) {
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;

      // Reintentar solo en 429 (rate limit) o errores de servidor (5xx)
      const isRetryable = status === 429 || (status !== undefined && status >= 500);

      if (isRetryable && attempt < MAX_RETRIES) {
        const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[api-football] HTTP ${status} - reintentando en ${waitMs}ms (intento ${attempt}/${MAX_RETRIES})`
        );
        await sleep(waitMs);
        continue;
      }

      // Si no es retryable o agotamos reintentos, lanzar el error
      console.error(
        `[api-football] Error fatal en ${endpoint}:`,
        axiosErr.message
      );
      throw error;
    }
  }

  // TypeScript: este punto nunca se alcanza pero satisface el tipo de retorno
  return [];
}

// ─────────────────────────────────────────
// Legacy helpers (usados por app/api/matches/route.ts original)
// Se mantienen para no romper otros módulos existentes
// ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFixtureToMatch(fixture: any): Match {
  return {
    id: fixture.fixture.id,
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    homeScore: fixture.goals.home,
    awayScore: fixture.goals.away,
    date: fixture.fixture.date,
    status: fixture.fixture.status.short,
    league: fixture.league.name,
  };
}

export async function getUpcomingMatches(leagueId: number, season: number): Promise<Match[]> {
  const fixtures = await apiFootballGet('/fixtures', {
    league: leagueId,
    season,
    next: 10,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fixtures as any[]).map(mapFixtureToMatch);
}

export async function getMatchResult(fixtureId: number): Promise<Match | null> {
  const fixtures = await apiFootballGet('/fixtures', { id: fixtureId });
  if (!fixtures || fixtures.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapFixtureToMatch(fixtures[0] as any);
}
