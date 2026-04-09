/**
 * Mappers: API-Football → Supabase schema
 *
 * Transforma las respuestas crudas de API-Football al formato
 * de nuestras tablas en Supabase.
 *
 * === Respuesta de API-Football para /fixtures ===
 * Cada fixture tiene esta estructura (simplificada):
 * {
 *   "fixture": {
 *     "id": 868124,
 *     "date": "2026-06-11T18:00:00+00:00",
 *     "venue": { "name": "MetLife Stadium", "city": "New York" },
 *     "status": { "short": "FT", "long": "Match Finished", "elapsed": 90 }
 *   },
 *   "league": {
 *     "id": 1,
 *     "name": "World Cup",
 *     "round": "Group A - 1"
 *   },
 *   "teams": {
 *     "home": { "id": 25, "name": "Colombia", "logo": "https://..." },
 *     "away": { "id": 26, "name": "Brazil", "logo": "https://..." }
 *   },
 *   "goals": { "home": 2, "away": 1 },
 *   "score": {
 *     "halftime": { "home": 1, "away": 0 },
 *     "fulltime": { "home": 2, "away": 1 },
 *     "extratime": { "home": null, "away": null },
 *     "penalty": { "home": null, "away": null }
 *   }
 * }
 */

/**
 * Tipado de la respuesta de API-Football para un fixture.
 * Solo incluimos los campos que necesitamos mapear.
 */
export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    venue: {
      name: string | null;
      city: string | null;
    } | null;
    status: {
      short: string; // "NS", "1H", "HT", "2H", "ET", "P", "FT", "AET", "PEN", "CANC", "ABD", etc
      long: string;
      elapsed: number | null;
    };
  };
  league: {
    id: number;
    name: string;
    round: string; // "Group A - 1", "Round of 32", "Final", etc
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo: string; // URL de la bandera/escudo del equipo
    };
    away: {
      id: number;
      name: string;
      logo: string;
    };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: {
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}

/**
 * Tipado del registro de la tabla `matches` en Supabase.
 * Coincide con el schema definido en la migración SQL.
 */
export interface MatchRow {
  external_id: string;
  tournament: string;
  match_day: number | null;
  phase: string | null;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
}

/**
 * Mapeo de status corto de API-Football → nuestro enum de status.
 *
 * API-Football usa estos códigos:
 * - "TBD"  → Time To Be Defined (tratamos como scheduled)
 * - "NS"   → Not Started
 * - "1H"   → First Half
 * - "HT"   → Halftime
 * - "2H"   → Second Half
 * - "ET"   → Extra Time
 * - "BT"   → Break Time (entre 2H y ET)
 * - "P"    → Penalties
 * - "FT"   → Full Time (terminado en 90 min)
 * - "AET"  → After Extra Time
 * - "PEN"  → After Penalties
 * - "SUSP" → Suspended
 * - "INT"  → Interrupted
 * - "PST"  → Postponed
 * - "CANC" → Cancelled
 * - "ABD"  → Abandoned
 * - "AWD"  → Technical Loss (awarded)
 * - "WO"   → Walkover
 * - "LIVE" → Live (genérico)
 */
const STATUS_MAP: Record<string, MatchRow['status']> = {
  // No iniciado
  TBD: 'scheduled',
  NS: 'scheduled',
  // En juego
  '1H': 'live',
  HT: 'live',
  '2H': 'live',
  ET: 'live',
  BT: 'live',
  P: 'live',
  LIVE: 'live',
  SUSP: 'live', // Suspendido temporalmente, sigue "en juego" para nosotros
  INT: 'live',
  // Terminado
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  AWD: 'finished',
  WO: 'finished',
  // Cancelado / Aplazado
  CANC: 'cancelled',
  ABD: 'cancelled',
  PST: 'cancelled',
};

/**
 * Convierte un status corto de API-Football a nuestro enum.
 * Si el status no está mapeado, retorna 'scheduled' como fallback seguro.
 */
export function mapApiStatus(apiStatus: string): MatchRow['status'] {
  return STATUS_MAP[apiStatus] || 'scheduled';
}

/**
 * Extrae la fase del partido a partir del string "round" de API-Football.
 *
 * Ejemplos de round:
 * - "Group A - 1"      → "group_a"
 * - "Group F - 3"      → "group_f"
 * - "Round of 32"      → "round_of_32"
 * - "Round of 16"      → "round_of_16"
 * - "Quarter-finals"   → "quarter_finals"
 * - "Semi-finals"      → "semi_finals"
 * - "3rd Place Final"  → "third_place"
 * - "Final"            → "final"
 */
export function mapPhase(round: string): string {
  const lower = round.toLowerCase().trim();

  // Fase de grupos: "Group A - 1" → "group_a"
  const groupMatch = lower.match(/^group\s+([a-l])/i);
  if (groupMatch) {
    return `group_${groupMatch[1].toLowerCase()}`;
  }

  // Fases eliminatorias
  if (lower.includes('round of 32')) return 'round_of_32';
  if (lower.includes('round of 16')) return 'round_of_16';
  if (lower.includes('quarter')) return 'quarter_finals';
  if (lower.includes('semi')) return 'semi_finals';
  if (lower.includes('3rd') || lower.includes('third')) return 'third_place';
  if (lower === 'final') return 'final';

  // Fallback: normalizar el string (espacios → _, minúsculas)
  return lower.replace(/[\s-]+/g, '_');
}

/**
 * Extrae el número de jornada (match_day) del string round.
 * "Group A - 1" → 1, "Group B - 3" → 3
 * Para fases eliminatorias retorna null.
 */
export function mapMatchDay(round: string): number | null {
  const match = round.match(/- (\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Calcula el score final considerando tiempo extra y penales.
 *
 * API-Football reporta goals como el marcador al final del tiempo reglamentario.
 * Si hubo tiempo extra, el score real está en score.fulltime o score.extratime.
 * Si hubo penales, score.penalty tiene los goles de penales (no se suman al marcador).
 *
 * Para la polla, usamos el marcador final incluyendo tiempo extra
 * (que es lo que goals ya refleja en AET), y para PEN usamos
 * los goals que ya incluyen ET.
 */
export function mapFinalScore(
  fixture: ApiFootballFixture
): { home: number | null; away: number | null } {
  const status = fixture.fixture.status.short;

  // Si no ha terminado, no hay score final
  if (!['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(status)) {
    return { home: null, away: null };
  }

  // goals ya contiene el marcador final (incluyendo ET si aplica)
  return {
    home: fixture.goals.home,
    away: fixture.goals.away,
  };
}

/**
 * Mapea un fixture completo de API-Football a un registro de nuestra tabla matches.
 *
 * @param fixture - Respuesta cruda de API-Football
 * @param tournament - Identificador del torneo (ej: 'worldcup_2026')
 * @returns Objeto listo para upsert en Supabase
 */
export function mapFixtureToMatch(
  fixture: ApiFootballFixture,
  tournament: string
): MatchRow {
  const { home, away } = mapFinalScore(fixture);
  const venue = fixture.fixture.venue;

  return {
    external_id: String(fixture.fixture.id),
    tournament,
    match_day: mapMatchDay(fixture.league.round),
    phase: mapPhase(fixture.league.round),
    home_team: fixture.teams.home.name,
    away_team: fixture.teams.away.name,
    home_team_flag: fixture.teams.home.logo || null,
    away_team_flag: fixture.teams.away.logo || null,
    scheduled_at: fixture.fixture.date,
    venue: venue ? [venue.name, venue.city].filter(Boolean).join(', ') : null,
    home_score: home,
    away_score: away,
    status: mapApiStatus(fixture.fixture.status.short),
  };
}

/**
 * Valida que un fixture tenga los datos mínimos necesarios para ser procesado.
 * Protege contra respuestas incompletas o malformadas de la API.
 *
 * @returns true si el fixture es válido y se puede procesar
 */
export function isValidFixture(fixture: unknown): fixture is ApiFootballFixture {
  if (!fixture || typeof fixture !== 'object') return false;

  const f = fixture as Record<string, unknown>;

  // Verificar estructura mínima
  const fix = f.fixture as Record<string, unknown> | undefined;
  const teams = f.teams as Record<string, unknown> | undefined;
  const goals = f.goals as Record<string, unknown> | undefined;

  if (!fix || !teams || !goals) return false;
  if (typeof fix.id !== 'number') return false;
  if (typeof fix.date !== 'string') return false;

  const status = fix.status as Record<string, unknown> | undefined;
  if (!status || typeof status.short !== 'string') return false;

  const home = teams.home as Record<string, unknown> | undefined;
  const away = teams.away as Record<string, unknown> | undefined;
  if (!home || !away) return false;
  if (typeof home.name !== 'string' || typeof away.name !== 'string') return false;

  return true;
}
