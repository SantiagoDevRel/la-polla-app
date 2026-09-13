/**
 * API-Football client (api-sports directo, plan Pro).
 *
 * Wrapper de axios con el header `x-apisports-key` y reintentos ante 429/5xx.
 * Variable de entorno requerida (solo servidor): API_FOOTBALL_KEY.
 *
 * El acceso por RapidAPI se retiró el 2026-09-13: todas las llamadas van
 * directo a v3.football.api-sports.io. La opción `direct` se acepta por
 * compatibilidad y ya no cambia nada.
 *
 * Nunca registres el error de Axios completo: su config lleva la clave.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

/** Tiempo máximo de espera para una respuesta de la API */
const REQUEST_TIMEOUT_MS = 15_000;

/** Número máximo de reintentos ante errores 429 (rate limit) o 5xx */
const MAX_RETRIES = 3;

/** Base de espera para backoff exponencial (ms) */
const BASE_BACKOFF_MS = 2_000;

const API_HOST = 'v3.football.api-sports.io';

function createClient(): AxiosInstance {
  const apiSportsKey = process.env.API_FOOTBALL_KEY;
  if (!apiSportsKey) throw new Error('Falta API_FOOTBALL_KEY');
  return axios.create({
    baseURL: `https://${API_HOST}`,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'x-apisports-key': apiSportsKey },
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
  params: Record<string, string | number>,
  options: { attempts?: number; direct?: boolean } = {},
): Promise<T[]> {
  const client = createClient();
  const attempts = options.attempts ?? MAX_RETRIES;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { data } = await client.get(endpoint, { params });

      // API-Football devuelve errores dentro del JSON, no como HTTP errors
      if (data.errors && Object.keys(data.errors).length > 0) {
        const errorMsg = JSON.stringify(data.errors);
        console.error(`[api-football] Error en respuesta: ${errorMsg}`);
        throw new Error(`API-Football error: ${errorMsg}`);
      }

      if (!Array.isArray(data.response)) throw new Error('API-Football response is not an array');
      return data.response as T[];
    } catch (error) {
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;

      // Reintentar solo en 429 (rate limit) o errores de servidor (5xx)
      const isRetryable = status === 429 || (status !== undefined && status >= 500);

      if (isRetryable && attempt < attempts) {
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
      throw new Error(`API-Football request failed${status ? ` (HTTP ${status})` : ''}`);
    }
  }

  // TypeScript: este punto nunca se alcanza pero satisface el tipo de retorno
  return [];
}
