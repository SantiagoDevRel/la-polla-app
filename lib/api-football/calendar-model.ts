/**
 * Modelos puros del calendario de API-Football (Paso 1 del plan del
 * 2026-09-13). Nada de red, DB ni `server-only`: el runtime todavía no los
 * usa, y los tests corren contra respuestas reales recortadas.
 *
 * Qué decide este archivo y qué NO:
 * - `trimFixture` guarda solo lo que el calendario necesita. Un fixture con
 *   forma dudosa se descarta (null) en vez de adivinar campos.
 * - `roundToPhase` traduce la ronda al enum de fases del repo. Una ronda
 *   desconocida da null y eso BLOQUEA la inserción: FD/ESPN siguen creando
 *   esos partidos. No reutiliza `mapPhase` de mappers.ts, que inventa fases
 *   ("play_offs", "clausura_-_3") con cualquier texto.
 * - `inferPrecision` separa dos preguntas: con qué precisión se INSERTA
 *   (`confirmed`) y si la observación sirve para MOVER un horario guardado
 *   (`movable`). La heurística de hora de relleno solo apaga `movable`;
 *   nunca marca "hora por confirmar" al insertar (crítica 2: la J8 de
 *   Champions sí se juega toda a la misma hora).
 * - `mapStatus` sigue la semántica de mappers.ts, salvo PST: un aplazado
 *   sigue `scheduled` con detalle STATUS_POSTPONED, nunca `cancelled`.
 */

type ScorePair = { home: number | null; away: number | null };

/** Fixture recortado: exactamente los campos que usa el calendario. */
export interface CalendarFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status: { short: string; long: string; elapsed: number | null };
    venue: { name: string | null; city: string | null };
  };
  league: { id: number; season: number; round: string };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
  goals: ScorePair;
  score: { fulltime: ScorePair; extratime: ScorePair; penalty: ScorePair };
}

import { AF_LEAGUE_COPA_COLOMBIA, AF_LEAGUE_NATIONS } from './leagues';

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const id = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const goalCount = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null
    : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

function pair(v: unknown): ScorePair | null {
  const p = record(v);
  if (!p) return v === null || v === undefined ? { home: null, away: null } : null;
  const home = goalCount(p.home), away = goalCount(p.away);
  return home === undefined || away === undefined ? null : { home, away };
}

function team(v: unknown): CalendarFixture['teams']['home'] | null {
  const t = record(v);
  const teamId = id(t?.id), name = text(t?.name);
  if (!t || !teamId || !name) return null;
  return { id: teamId, name, logo: text(t.logo) };
}

/**
 * Recorta un fixture crudo. Devuelve null si falta cualquier dato de
 * identidad (ids, ronda, temporada) o si `date` y `timestamp` no dicen el
 * mismo instante: con dos horas distintas no hay cuál creer.
 */
export function trimFixture(raw: unknown): CalendarFixture | null {
  const root = record(raw), fx = record(root?.fixture), league = record(root?.league);
  const teams = record(root?.teams), status = record(fx?.status), score = record(root?.score);
  if (!root || !fx || !league || !teams || !status) return null;

  const fixtureId = id(fx.id), date = text(fx.date), timestamp = fx.timestamp;
  if (!fixtureId || !date || typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)) return null;
  if (Date.parse(date) !== timestamp * 1000) return null;

  const short = text(status.short);
  const elapsed = status.elapsed === null || status.elapsed === undefined ? null
    : typeof status.elapsed === 'number' && Number.isInteger(status.elapsed) && status.elapsed >= 0 ? status.elapsed : undefined;
  const leagueId = id(league.id), season = id(league.season), round = text(league.round);
  const home = team(teams.home), away = team(teams.away);
  const goals = pair(root.goals);
  const fulltime = pair(score?.fulltime), extratime = pair(score?.extratime), penalty = pair(score?.penalty);
  if (!short || elapsed === undefined || !leagueId || !season || !round || !home || !away) return null;
  if (home.id === away.id || !goals || !fulltime || !extratime || !penalty) return null;

  const venue = record(fx.venue);
  return {
    fixture: {
      id: fixtureId, date, timestamp,
      status: { short, long: text(status.long) ?? '', elapsed },
      venue: { name: text(venue?.name), city: text(venue?.city) },
    },
    league: { id: leagueId, season, round: round.replace(/\s+/g, ' ') },
    teams: { home, away },
    goals,
    score: { fulltime, extratime, penalty },
  };
}

// ─────────────────────────────────────────
// Rondas → fases
// ─────────────────────────────────────────

/**
 * Fases canónicas del repo (`PhaseSlug` de lib/tournaments/structure.ts).
 * La DB también tiene `playoffs` (16 filas de Champions escritas por FD, cuyo
 * stage PLAYOFFS no está en el mapa de sync.ts); lo canónico es `playoff`.
 */
export type CalendarPhase =
  | 'regular_season' | 'league_stage' | 'group_stage' | 'playoff' | 'round_of_64'
  | 'round_of_32' | 'round_of_16' | 'quarter_finals' | 'semi_finals' | 'third_place' | 'final';

export interface RoundPhase {
  phase: CalendarPhase;
  /** Jornada solo en fases de liga/grupos; null en eliminatorias. */
  matchDay: number | null;
  /** BetPlay usa las mismas jornadas en Apertura y Clausura: sin esto chocan. */
  segment: 'apertura' | 'clausura' | null;
}

export type RoundClass =
  | ({ kind: 'phase' } & RoundPhase)
  | { kind: 'excluded'; reason: 'qualifying' | 'ambiguous' | 'early_cup_round' }
  | { kind: 'unknown' };

const KNOCKOUTS: Record<string, CalendarPhase> = {
  'Knockout Round Play-offs': 'playoff',
  // Conference League: su playoff de febrero se llama así, no como el de la UCL.
  'Playoff round': 'playoff',
  // Liga MX: el Play-In reparte los últimos dos cupos de la Liguilla.
  'Play-In Semi-finals': 'playoff',
  'Play-In Final': 'playoff',
  // La Liga Argentina 2025 llamaba «8th Finals» a los octavos (1/8).
  '8th Finals': 'round_of_16',
  'Round of 64': 'round_of_64',
  'Round of 32': 'round_of_32',
  'Round of 16': 'round_of_16',
  'Quarter-finals': 'quarter_finals',
  'Semi-finals': 'semi_finals',
  '3rd Place Final': 'third_place',
  'Final': 'final',
};

/**
 * Rondas tempranas de copa nacional, con equipos de divisiones de ascenso y
 * una nomenclatura que el proveedor cambia de una temporada a otra (la Copa do
 * Brasil 2026 emitió «Round of 128», «1/128-finals» y «1/256-finals» a la vez).
 * Son conocidas y NO se guardan: quedan fuera sin alertar al administrador.
 */
const EARLY_CUP_ROUNDS = new Set([
  '1st Round', '2nd Round', '3rd Round', 'Round of 128', '1/128-finals', '1/256-finals',
]);

/**
 * Clasifica la ronda con coincidencias EXACTAS (solo se colapsan espacios).
 * Un texto nuevo del proveedor cae en `unknown` y el test de fixtures lo
 * detecta, en vez de colarse con una fase aproximada.
 *
 * `excluded` son rondas conocidas que el repo no guarda:
 * - Previas de UEFA y CONMEBOL (ningún torneo del repo las incluye).
 * - "Play-offs" de UEFA: en la temporada 2026 son los 14 partidos de agosto,
 *   ANTES de la fase de liga. El playoff de febrero se llama
 *   "Knockout Round Play-offs". Si algún día reusaran el nombre, queda
 *   bloqueado igual y FD/ESPN lo cubren.
 */
/**
 * Los dos torneos cortos de una misma temporada. La Liga Argentina los llamó
 * «1st Phase»/«2nd Phase» en 2025 y «Apertura»/«Clausura» en 2026: son el mismo
 * par, y sin distinguirlos las jornadas de los dos torneos chocarían.
 */
function segmentOf(prefix: string | undefined): 'apertura' | 'clausura' | null {
  if (prefix === 'Apertura' || prefix === '1st Phase') return 'apertura';
  if (prefix === 'Clausura' || prefix === '2nd Phase') return 'clausura';
  return null;
}

export function classifyRound(round: string, leagueId?: number): RoundClass {
  const r = round.replace(/\s+/g, ' ').trim();
  let m = r.match(/^(Regular Season|Apertura|Clausura|1st Phase|2nd Phase) - ([1-9]\d?)$/);
  if (m) {
    return { kind: 'phase', phase: 'regular_season', matchDay: Number(m[2]), segment: segmentOf(m[1]) };
  }
  // «League A - 3» es la Nations League; «1st Round - 3» es la fase de grupos
  // de la Copa Colombia, que el proveedor no llama «Group Stage».
  m = r.match(/^(League Stage|League [A-D]|Group Stage|Group [A-L]|1st Round) - ([1-9]\d?)$/);
  if (m) {
    const league = m[1] === 'League Stage' || m[1].startsWith('League ');
    return { kind: 'phase', phase: league ? 'league_stage' : 'group_stage',
      matchDay: Number(m[2]), segment: null };
  }
  // La Nations League 2026 numera sus seis jornadas a secas. Un «3» pelado solo
  // es una jornada en esa liga: en cualquier otra queda desconocido a propósito.
  if (leagueId === AF_LEAGUE_NATIONS && /^([1-9]|1\d)$/.test(r)) {
    return { kind: 'phase', phase: 'league_stage', matchDay: Number(r), segment: null };
  }
  // Nations League: las llaves de ascenso/descenso entre divisiones.
  if (/^Play-offs [A-D]\/[A-D]$/.test(r)) {
    return { kind: 'phase', phase: 'playoff', matchDay: null, segment: null };
  }
  m = r.match(/^(?:(Apertura|Clausura|1st Phase|2nd Phase) - )?(.+)$/);
  // hasOwnProperty: "constructor"/"toString" no pueden colarse como fase.
  const knockout = m && Object.prototype.hasOwnProperty.call(KNOCKOUTS, m[2]) ? KNOCKOUTS[m[2]] : undefined;
  if (m && knockout) {
    return { kind: 'phase', phase: knockout, matchDay: null, segment: segmentOf(m[1]) };
  }
  if (/^(1st|2nd|3rd) Qualifying Round$/.test(r) || /^Qualification Round [1-9]$/.test(r)) {
    return { kind: 'excluded', reason: 'qualifying' };
  }
  // En la Copa Colombia «Play-offs» es la ronda previa a los octavos, ida y
  // vuelta, con equipos de primera. En la UEFA es la previa de agosto que no
  // guardamos, así que sin saber la liga se mantiene excluida.
  if (r === 'Play-offs') {
    return leagueId === AF_LEAGUE_COPA_COLOMBIA
      ? { kind: 'phase', phase: 'round_of_32', matchDay: null, segment: null }
      : { kind: 'excluded', reason: 'ambiguous' };
  }
  if (EARLY_CUP_ROUNDS.has(r)) return { kind: 'excluded', reason: 'early_cup_round' };
  return { kind: 'unknown' };
}

/** Fase + jornada, o null (desconocida o excluida) = no se inserta. */
export function roundToPhase(round: string, leagueId?: number): RoundPhase | null {
  const c = classifyRound(round, leagueId);
  return c.kind === 'phase' ? { phase: c.phase, matchDay: c.matchDay, segment: c.segment } : null;
}

// ─────────────────────────────────────────
// Estado
// ─────────────────────────────────────────

export type CalendarStatusValue = 'scheduled' | 'live' | 'finished' | 'cancelled';
export interface CalendarStatus { status: CalendarStatusValue; detail: string }

/**
 * Detalles con los mismos nombres que live.ts (estilo ESPN). Diferencias con
 * mappers.ts, a propósito:
 * - PST → `scheduled` + STATUS_POSTPONED. Aplazado no es cancelado; volverlo
 *   `cancelled` activa el trinquete de estado y el partido no revive.
 * - Un código desconocido da null (el llamador ignora esa observación), en
 *   vez del `scheduled` de respaldo de mapApiStatus.
 */
const STATUSES: Record<string, CalendarStatus> = {
  TBD: { status: 'scheduled', detail: 'STATUS_SCHEDULED' },
  NS: { status: 'scheduled', detail: 'STATUS_SCHEDULED' },
  PST: { status: 'scheduled', detail: 'STATUS_POSTPONED' },
  '1H': { status: 'live', detail: 'STATUS_FIRST_HALF' },
  HT: { status: 'live', detail: 'STATUS_HALFTIME' },
  '2H': { status: 'live', detail: 'STATUS_SECOND_HALF' },
  ET: { status: 'live', detail: 'STATUS_OVERTIME' },
  BT: { status: 'live', detail: 'STATUS_OVERTIME' },
  P: { status: 'live', detail: 'STATUS_SHOOTOUT' },
  LIVE: { status: 'live', detail: 'STATUS_IN_PROGRESS' },
  SUSP: { status: 'live', detail: 'STATUS_SUSPENDED' },
  INT: { status: 'live', detail: 'STATUS_INTERRUPTED' },
  FT: { status: 'finished', detail: 'STATUS_FULL_TIME' },
  AET: { status: 'finished', detail: 'STATUS_FINAL_AET' },
  PEN: { status: 'finished', detail: 'STATUS_FINAL_PEN' },
  AWD: { status: 'finished', detail: 'STATUS_FORFEIT' },
  WO: { status: 'finished', detail: 'STATUS_FORFEIT' },
  CANC: { status: 'cancelled', detail: 'STATUS_CANCELED' },
  ABD: { status: 'cancelled', detail: 'STATUS_ABANDONED' },
};

export function mapStatus(short: string): CalendarStatus | null {
  return Object.prototype.hasOwnProperty.call(STATUSES, short) ? { ...STATUSES[short] } : null;
}

// ─────────────────────────────────────────
// Precisión del horario
// ─────────────────────────────────────────

/** Umbrales de la heurística de hora de relleno (plan, Paso 1). */
export const UNIFORM_ROUND_MIN_FIXTURES = 5;
export const UNIFORM_ROUND_MIN_SHARE = 0.75;
export const UNIFORM_ROUND_MIN_LEAD_MS = 10 * 86_400_000;

export type PrecisionReason = 'confirmed' | 'time_to_be_defined' | 'postponed' | 'uniform_round' | 'not_scheduled';

export interface SchedulePrecision {
  /** Valor de `scheduled_at_confirmed` si esta observación inserta la fila. */
  confirmed: boolean;
  /** Si la observación puede MOVER un horario ya guardado. */
  movable: boolean;
  reason: PrecisionReason;
}

export interface RoundTiming { fixtures: number; dominantTimestamp: number; share: number }

const roundKey = (f: CalendarFixture) => `${f.league.id}:${f.league.season}:${f.league.round}`;

/**
 * Agrupa por liga+temporada+ronda y mide qué fracción de los partidos NO
 * iniciados comparte el mismo timestamp. Solo cuenta NS: los TBD/PST y los
 * ya jugados diluirían la señal y harían "movible" una ronda de relleno.
 * Espera la respuesta completa de la liga; con rondas a medias el conteo miente.
 */
export function roundTimings(fixtures: CalendarFixture[]): Map<string, RoundTiming> {
  const byRound = new Map<string, Map<number, number>>();
  for (const f of fixtures) {
    if (f.fixture.status.short !== 'NS') continue;
    const counts = byRound.get(roundKey(f)) ?? new Map<number, number>();
    counts.set(f.fixture.timestamp, (counts.get(f.fixture.timestamp) ?? 0) + 1);
    byRound.set(roundKey(f), counts);
  }
  const out = new Map<string, RoundTiming>();
  byRound.forEach((counts, key) => {
    let total = 0, dominantTimestamp = 0, best = 0;
    counts.forEach((n, ts) => {
      total += n;
      if (n > best || (n === best && ts < dominantTimestamp)) { best = n; dominantTimestamp = ts; }
    });
    out.set(key, { fixtures: total, dominantTimestamp, share: best / total });
  });
  return out;
}

/**
 * - TBD → provisional (`confirmed=false`) y nunca mueve.
 * - PST (aplazado) con saque todavía en el futuro → se trata como NS: API-Football
 *   deja el estado aplazado aunque ya publicó la hora nueva (Once Caldas–Tolima,
 *   16-sep 18:15). Pedido del dueño (2026-09-13): mostrarlo con su hora para
 *   poder elegirlo. Si al final no se juega, el caso llega a /admin/issues.
 * - PST con saque ya pasado → provisional y nunca mueve (no hay fecha nueva).
 * - Cualquier estado distinto de NS (en juego, terminado, cancelado) → la
 *   hora es la que fue; no mueve nada desde el calendario.
 * - Ronda de relleno (≥5 NS, ≥75 % a la misma hora, saque a más de 10 días
 *   de `observedAt`) → sigue `confirmed=true` para inserciones, pero
 *   `movable=false`. Aplica a toda la ronda: la hora distinta de una ronda de
 *   relleno tampoco se toma como prueba (J10 de LaLiga: 9 de 10 a las 16:00).
 * - Lo demás → confirmada y movible. Si mover o no (dos observaciones,
 *   conflicto con FD/ESPN, saque en el pasado) lo decide el escritor SQL.
 */
export function inferPrecision(
  fixture: CalendarFixture,
  timings: Map<string, RoundTiming>,
  observedAt: string | number,
  // (2026-09-13) El calendario lo usa con true: una ronda que sigue uniforme a
  // menos de 10 días del saque no puede pasar a "confirmada" con la hora de
  // relleno, porque Casa calcularía con ella un cierre automático falso.
  ignoreLead = false,
): SchedulePrecision {
  const short = fixture.fixture.status.short;
  if (short === 'TBD') return { confirmed: false, movable: false, reason: 'time_to_be_defined' };
  const observed = typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
  // Sin la hora de la observación no se mide la antelación: es un bug del llamador.
  if (!Number.isFinite(observed)) throw new RangeError('observedAt inválido');
  if (short === 'PST' && fixture.fixture.timestamp * 1000 <= observed) {
    return { confirmed: false, movable: false, reason: 'postponed' };
  }
  if (short !== 'NS' && short !== 'PST') return { confirmed: true, movable: false, reason: 'not_scheduled' };
  const timing = timings.get(roundKey(fixture));
  const uniform = timing !== undefined
    && timing.fixtures >= UNIFORM_ROUND_MIN_FIXTURES
    && timing.share >= UNIFORM_ROUND_MIN_SHARE
    && (ignoreLead || fixture.fixture.timestamp * 1000 - observed > UNIFORM_ROUND_MIN_LEAD_MS);
  return uniform
    ? { confirmed: true, movable: false, reason: 'uniform_round' }
    : { confirmed: true, movable: true, reason: 'confirmed' };
}

/** Precisión de toda una respuesta de liga, por id de fixture. */
export function inferFeedPrecision(fixtures: CalendarFixture[], observedAt: string | number, ignoreLead = false): Map<number, SchedulePrecision> {
  const timings = roundTimings(fixtures);
  return new Map(fixtures.map((f) => [f.fixture.id, inferPrecision(f, timings, observedAt, ignoreLead)] as const));
}
