/**
 * Calendario de API-Football → `matches` (Paso 3 del plan del 2026-09-13).
 *
 * El dueño decidió que calendario, vivo y resultados salgan solo de
 * API-Football. Este archivo es la parte de CALENDARIO: una llamada
 * `/fixtures?league=&season=` por liga trae la temporada completa y cada
 * partido desde hace dos días hasta el final de la temporada pasa por el
 * escritor único `upsert_match_safe` (overload de 17 argumentos, Regla #1).
 *
 * Decisiones que aplica (D1–D6 del plan):
 * - `external_id` = `apifootball:<fixture.id>`. Nombres y escudos de AF,
 *   abreviaturas null (el escritor conserva las que ya existan).
 * - Fase y jornada salen de `roundToPhase`; una ronda desconocida o excluida
 *   no se escribe. Estado de `mapStatus` (PST sigue `scheduled`).
 * - Precisión: TBD/PST y rondas de hora de relleno se escriben con
 *   `scheduled_at_confirmed=false`. Es más honesto «hora por confirmar» que
 *   una hora inventada; el escritor nunca degrada una hora ya confirmada.
 * - Marcadores: NS/TBD/PST sin marcador. En juego manda el sync de vivo: a una
 *   fila existente se le reenvían su propio estado y marcador. FT/AET/PEN
 *   llevan el marcador de los 90' y `finished`, pero JAMÁS `final_verified_at`.
 * - Solo se escriben filas nuevas o que el escritor cambiaría: una sola
 *   lectura por torneo y un plazo que corta antes del techo de 60 s de Vercel.
 * - Un sobre dudoso (errores, paginado, vacío, otra temporada) aborta sin
 *   escribir nada. Un error de una fila se cuenta y se sigue con las demás.
 *
 * Sin `server-only` a propósito: `scripts/af-import.ts` lo corre con tsx, que
 * no resuelve ese paquete. Las dependencias del runtime (cliente admin,
 * verificación del plan) se cargan con import dinámico SOLO si el llamador no
 * inyecta las suyas. La key vive en env de servidor y nunca se imprime.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyRound, inferFeedPrecision, mapStatus, trimFixture, type CalendarFixture,
} from './calendar-model';
import {
  afLeagueIdForTournament, feedMatchesSeason, resolveCurrentSeasons,
  type CurrentSeasons, type SeasonCache,
} from './season';

const AF_BASE_URL = 'https://v3.football.api-sports.io';
/** Sin reintentos: un reintento gastaría cuota por fuera del conteo. */
const FETCH_TIMEOUT_MS = 12_000;
/** Mismo techo que detalle y equipos: deja capacidad para vivo y resultados. */
export const CALENDAR_REQUEST_CEILING = 6_000;
/** D3: partidos desde hace dos días hasta el final de la temporada. */
export const IMPORT_WINDOW_BACK_MS = 2 * 86_400_000;
/** La lectura de filas existentes toma un día extra para ver reprogramados. */
const EXISTING_WINDOW_BACK_MS = 3 * 86_400_000;
const LIVE_RECENT_MS = 10 * 60_000;
const PAGE_SIZE = 1_000;
export const AF_EXTERNAL_PREFIX = 'apifootball:';
const SEASON_CACHE_KEY = 'api_football_current_seasons';
const KNOCKOUT_PHASES = new Set(['round_of_32', 'round_of_16', 'quarter_finals', 'semi_finals', 'third_place', 'final']);

// ─────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────

export type AfRefreshMode = 'apply' | 'dry-run';

export interface AfRefreshOptions {
  /** Epoch ms. Pasado el plazo no se consulta ni se escribe nada más. */
  deadlineMs?: number;
  mode?: AfRefreshMode;
}

/** Argumentos del overload de 17 de `upsert_match_safe`, sin el prefijo p_. */
export interface AfMatchRow {
  external_id: string;
  tournament: string;
  match_day: number | null;
  phase: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  elapsed: number | null;
  scheduled_at_confirmed: boolean;
}

/** Columnas explícitas de la lectura de diff (nunca select *). */
export const EXISTING_MATCH_COLUMNS =
  'id, external_id, source_external_ids, match_day, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, scheduled_at_confirmed, venue, home_score, away_score, status, elapsed, final_verified_at, live_updated_at' as const;

export interface ExistingMatch {
  id: string;
  external_id: string | null;
  source_external_ids: string[] | null;
  match_day: number | null;
  phase: string | null;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  scheduled_at_confirmed: boolean;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  elapsed: number | null;
  final_verified_at: string | null;
  live_updated_at: string | null;
}

export type AfAbortReason =
  | 'unsupported_tournament' | 'deadline' | 'budget' | 'no_season' | 'fetch_failed'
  | 'invalid_envelope' | 'provider_errors' | 'paged' | 'empty_response' | 'no_valid_fixtures'
  | 'season_mismatch' | 'existing_read_failed' | 'unexpected';

export type AfPlan = 'insert' | 'update' | 'unchanged';

export interface AfRefreshResult {
  tournament: string;
  leagueId: number | null;
  season: number | null;
  /** Fixtures en la respuesta del proveedor. */
  fetched: number;
  /** Filas nuevas (apply) o que se crearían/enlazarían (dry-run). */
  inserted: number;
  /** Filas AF existentes que el escritor cambió (o cambiaría). */
  updated: number;
  /** Solo apply: el escritor enlazó el fixture a una fila de otro proveedor. */
  linked: number;
  unchanged: number;
  skipped: Record<string, number>;
  errors: number;
  aborted: AfAbortReason | null;
  /** El plazo cortó escrituras pendientes: la liga NO quedó completa. */
  truncated: boolean;
  /** Hasta cinco filas mapeadas, las más próximas primero. */
  sample: Array<{ plan: AfPlan; row: AfMatchRow }>;
  /** Solo dry-run: estimación de enlaces con filas legacy (normalización aproximada en TS). */
  legacy?: { wouldLink: number; ambiguous: number; unmatchedLegacyRows: number };
}

export interface CalendarDeps {
  db: SupabaseClient;
  /** Sobre completo de API-Football ({errors, paging, response}). Lanza si falla. */
  fetchEnvelope: (path: '/fixtures' | '/leagues', params: Record<string, string>) => Promise<unknown>;
  /** Guardia de cuota. true = se puede gastar UNA solicitud. */
  reserveRequest: () => Promise<boolean>;
  /** Temporada vigente por liga; memoizada por corrida (una llamada a /leagues). */
  resolveSeason: (leagueId: number) => Promise<number | null>;
  now?: () => number;
  log?: (message: string) => void;
}

// ─────────────────────────────────────────
// Sobre y mapeo (puros)
// ─────────────────────────────────────────

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Un 200 de API-Football puede venir con `errors` (cuota, key, parámetro),
 * paginado o vacío. Cualquiera de esos casos aborta: con una temporada a
 * medias el diff no puede distinguir «sin cambios» de «no vino».
 */
export function validateFixturesEnvelope(
  body: unknown,
): { ok: true; response: unknown[] } | { ok: false; reason: AfAbortReason } {
  const envelope = record(body);
  if (!envelope || !Array.isArray(envelope.response)) return { ok: false, reason: 'invalid_envelope' };
  const errors = envelope.errors;
  if (Array.isArray(errors) ? errors.length > 0 : Object.keys(record(errors) ?? {}).length > 0) {
    return { ok: false, reason: 'provider_errors' };
  }
  const total = record(envelope.paging)?.total;
  if (typeof total === 'number' && total > 1) return { ok: false, reason: 'paged' };
  if (envelope.response.length === 0) return { ok: false, reason: 'empty_response' };
  return { ok: true, response: envelope.response };
}

export type MapOutcome =
  | { kind: 'row'; row: AfMatchRow; live: boolean }
  | { kind: 'skip'; reason: 'before_window' | 'round_excluded' | 'round_unknown' | 'status_unknown' };

const scorePair = (p: { home: number | null; away: number | null }) =>
  p.home !== null && p.away !== null ? p : null;

/**
 * Traduce un fixture (ya validado contra liga y temporada) a los argumentos
 * del escritor. `confirmed` llega de `inferFeedPrecision` sobre la liga
 * COMPLETA: medir rondas de relleno sobre una ventana recortada miente.
 */
export function mapFixtureToRow(
  tournament: string,
  f: CalendarFixture,
  precision: { confirmed: boolean; reason: string } | undefined,
  nowMs: number,
): MapOutcome {
  if (f.fixture.timestamp * 1000 < nowMs - IMPORT_WINDOW_BACK_MS) return { kind: 'skip', reason: 'before_window' };
  const round = classifyRound(f.league.round);
  if (round.kind === 'excluded') return { kind: 'skip', reason: 'round_excluded' };
  if (round.kind === 'unknown') return { kind: 'skip', reason: 'round_unknown' };
  const status = mapStatus(f.fixture.status.short);
  if (!status) return { kind: 'skip', reason: 'status_unknown' };

  const short = f.fixture.status.short;
  // D2: la ronda de relleno se inserta como provisional, no como hora exacta.
  const confirmed = short === 'TBD' || short === 'PST' ? false
    : precision?.reason === 'uniform_round' ? false
      : precision?.confirmed ?? true;

  let score: { home: number | null; away: number | null } = { home: null, away: null };
  let elapsed: number | null = null;
  if (status.status === 'live') {
    score = scorePair(f.goals) ?? score;
    elapsed = f.fixture.status.elapsed;
  } else if (short === 'FT' || short === 'AET' || short === 'PEN') {
    // Regla #4: el marcador de los 90'. El alargue no suma y no se verifica acá.
    score = scorePair(f.score.fulltime) ?? score;
    elapsed = f.fixture.status.elapsed;
  } else if (short === 'AWD' || short === 'WO') {
    score = scorePair(f.score.fulltime) ?? scorePair(f.goals) ?? score;
    elapsed = f.fixture.status.elapsed;
  }

  return {
    kind: 'row',
    live: status.status === 'live',
    row: {
      external_id: `${AF_EXTERNAL_PREFIX}${f.fixture.id}`,
      tournament,
      match_day: round.matchDay,
      phase: round.phase,
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      home_team_flag: f.teams.home.logo,
      away_team_flag: f.teams.away.logo,
      scheduled_at: new Date(f.fixture.timestamp * 1000).toISOString(),
      venue: f.fixture.venue.name,
      home_score: score.home,
      away_score: score.away,
      status: status.status,
      elapsed,
      scheduled_at_confirmed: confirmed,
    },
  };
}

/** Id AF enlazado a una fila, sea como external_id o en source_external_ids. */
export function linkedAfIds(m: Pick<ExistingMatch, 'external_id' | 'source_external_ids'>): string[] {
  const ids = [m.external_id, ...(m.source_external_ids ?? [])];
  return ids.filter((id): id is string => typeof id === 'string' && id.startsWith(AF_EXTERNAL_PREFIX));
}

/**
 * En juego manda `update_match_live_provider`: a una fila existente se le
 * reenvía su propio estado, marcador y minuto para que el escritor de
 * calendario no los toque (D4).
 */
export function preserveLiveState(row: AfMatchRow, existing: ExistingMatch): AfMatchRow {
  return { ...row, status: existing.status, home_score: existing.home_score,
    away_score: existing.away_score, elapsed: existing.elapsed };
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const mergedScore = (current: number | null, next: number | null) =>
  current === null && next === null ? null : Math.max(current ?? 0, next ?? 0);

/**
 * ¿Cambiaría algo `upsert_match_safe` (migración 103) con esta fila? Modela
 * sus protecciones para no reescribir eternamente lo que el escritor rechaza:
 * hora confirmada frente a una provisional, marcadores monotónicos, fila
 * verificada, vivo reciente y el trigger anti-regresión de estado.
 */
export function writerWouldChange(existing: ExistingMatch, row: AfMatchRow, nowMs: number): boolean {
  const verified = existing.final_verified_at !== null;
  const liveRecent = existing.live_updated_at !== null
    && Date.parse(existing.live_updated_at) > nowMs - LIVE_RECENT_MS;
  const keepTime = verified || (existing.scheduled_at_confirmed && !row.scheduled_at_confirmed);

  if (existing.phase !== row.phase || existing.home_team !== row.home_team || existing.away_team !== row.away_team) return true;
  if ((row.home_team_flag ?? existing.home_team_flag) !== existing.home_team_flag) return true;
  if ((row.away_team_flag ?? existing.away_team_flag) !== existing.away_team_flag) return true;
  if (!keepTime && !sameInstant(existing.scheduled_at, row.scheduled_at)) return true;
  if ((existing.scheduled_at_confirmed || row.scheduled_at_confirmed) !== existing.scheduled_at_confirmed) return true;
  if (existing.venue !== row.venue) return true;
  if (liveRecent) return false;

  const matchDay = existing.match_day !== null && KNOCKOUT_PHASES.has(existing.phase ?? '')
    ? existing.match_day : row.match_day ?? existing.match_day;
  if (matchDay !== existing.match_day) return true;
  if (verified) return false;
  if (mergedScore(existing.home_score, row.home_score) !== existing.home_score) return true;
  if (mergedScore(existing.away_score, row.away_score) !== existing.away_score) return true;
  let status = row.status;
  if (existing.status === 'finished' && (status === 'live' || status === 'scheduled')) status = 'finished';
  if (existing.status === 'cancelled' && status === 'scheduled') status = 'cancelled';
  return status !== existing.status || row.elapsed !== existing.elapsed;
}

/** Aproximación TS de `normalize_team_name` SOLO para la estimación del dry-run. */
export function roughTeamKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\b/g, ' ')
    .replace('munchen', 'munich').replace(/paris saint[- ]?germain/g, 'psg')
    .replace(/\s+/g, ' ').trim();
}

const bump = (bag: Record<string, number>, key: string, n = 1) => { bag[key] = (bag[key] ?? 0) + n; };

// ─────────────────────────────────────────
// Refresco de un torneo
// ─────────────────────────────────────────

function emptyResult(tournament: string, leagueId: number | null): AfRefreshResult {
  return { tournament, leagueId, season: null, fetched: 0, inserted: 0, updated: 0, linked: 0, unchanged: 0,
    skipped: {}, errors: 0, aborted: null, truncated: false, sample: [] };
}

async function readExisting(db: SupabaseClient, tournament: string, nowMs: number): Promise<ExistingMatch[] | null> {
  const since = new Date(nowMs - EXISTING_WINDOW_BACK_MS).toISOString();
  const rows: ExistingMatch[] = [];
  // Paginado: PostgREST topa en 1000 filas aun con service_role.
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from('matches').select(EXISTING_MATCH_COLUMNS)
      .eq('tournament', tournament)
      .or(`external_id.like."${AF_EXTERNAL_PREFIX}*",scheduled_at.gte."${since}"`)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) return null;
    rows.push(...(data as unknown as ExistingMatch[]));
    if (data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Trae la temporada de un torneo y escribe lo que cambió. Nunca lanza: todo
 * problema queda en `aborted`, `errors` o `skipped`.
 */
export async function refreshAfTournament(
  tournament: string,
  options: AfRefreshOptions = {},
  injected?: CalendarDeps,
): Promise<AfRefreshResult> {
  const leagueId = afLeagueIdForTournament(tournament);
  const result = emptyResult(tournament, leagueId);
  if (!leagueId) return { ...result, aborted: 'unsupported_tournament' };
  const deps = injected ?? await createCalendarDeps();
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.warn(m));
  const mode = options.mode ?? 'apply';
  const deadline = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const expired = () => now() >= deadline;

  try {
    if (expired()) return { ...result, aborted: 'deadline' };
    const season = await deps.resolveSeason(leagueId);
    if (!season) return { ...result, aborted: 'no_season' };
    result.season = season;
    if (expired()) return { ...result, aborted: 'deadline' };
    if (!(await deps.reserveRequest())) return { ...result, aborted: 'budget' };

    let body: unknown;
    try {
      body = await deps.fetchEnvelope('/fixtures', { league: String(leagueId), season: String(season) });
    } catch {
      return { ...result, aborted: 'fetch_failed' };
    }
    const envelope = validateFixturesEnvelope(body);
    if (!envelope.ok) return { ...result, aborted: envelope.reason };
    result.fetched = envelope.response.length;

    const fixtures: CalendarFixture[] = [];
    for (const raw of envelope.response) {
      const f = trimFixture(raw);
      if (f) fixtures.push(f); else bump(result.skipped, 'invalid_fixture');
    }
    if (!fixtures.length) return { ...result, aborted: 'no_valid_fixtures' };
    // Una sola fila de otra liga u otra temporada invalida la respuesta entera.
    if (!feedMatchesSeason(leagueId, season, fixtures)) return { ...result, aborted: 'season_mismatch' };

    const observedAt = now();
    // ignoreLead: la ronda de relleno queda provisional aunque falten <10 días.
    const precision = inferFeedPrecision(fixtures, observedAt, true);
    const unknownRounds = new Set<string>();
    const mapped: Array<{ row: AfMatchRow; live: boolean }> = [];
    for (const f of fixtures) {
      const outcome = mapFixtureToRow(tournament, f, precision.get(f.fixture.id), observedAt);
      if (outcome.kind === 'skip') {
        bump(result.skipped, outcome.reason);
        if (outcome.reason === 'round_unknown' || outcome.reason === 'round_excluded') unknownRounds.add(f.league.round);
      } else mapped.push(outcome);
    }
    if (unknownRounds.size) {
      log(`[af-calendar] ${tournament}: rondas no escritas: ${Array.from(unknownRounds).sort().join(' | ')}`);
    }

    const existing = await readExisting(deps.db, tournament, observedAt);
    if (!existing) return { ...result, aborted: 'existing_read_failed' };
    const byAfId = new Map<string, ExistingMatch>();
    for (const m of existing) for (const id of linkedAfIds(m)) byAfId.set(id, m);
    const knownIds = new Map(existing.map((m) => [m.id, m] as const));

    // Los más próximos primero: si el plazo corta, queda completo lo cercano.
    mapped.sort((a, b) => Date.parse(a.row.scheduled_at) - Date.parse(b.row.scheduled_at));
    const writes: Array<{ plan: AfPlan; row: AfMatchRow }> = [];
    const untouched: Array<{ plan: AfPlan; row: AfMatchRow }> = [];
    for (const { row, live } of mapped) {
      const current = byAfId.get(row.external_id);
      if (!current) { writes.push({ plan: 'insert', row }); continue; }
      const next = live ? preserveLiveState(row, current) : row;
      if (writerWouldChange(current, next, observedAt)) writes.push({ plan: 'update', row: next });
      else untouched.push({ plan: 'unchanged', row: next });
    }
    result.unchanged = untouched.length;
    result.sample = [...writes, ...untouched].slice(0, 5)
      .sort((a, b) => Date.parse(a.row.scheduled_at) - Date.parse(b.row.scheduled_at));

    if (mode === 'dry-run') {
      result.inserted = writes.filter((w) => w.plan === 'insert').length;
      result.updated = writes.length - result.inserted;
      result.legacy = estimateLegacyLinks(existing, writes.filter((w) => w.plan === 'insert').map((w) => w.row), observedAt);
      return result;
    }

    for (let i = 0; i < writes.length; i++) {
      if (expired()) {
        bump(result.skipped, 'deadline', writes.length - i);
        result.truncated = true;
        break;
      }
      const { plan, row } = writes[i];
      try {
        const { data, error } = await deps.db.rpc('upsert_match_safe', {
          p_external_id: row.external_id, p_tournament: row.tournament, p_match_day: row.match_day,
          p_phase: row.phase, p_home_team: row.home_team, p_away_team: row.away_team,
          p_home_team_flag: row.home_team_flag, p_away_team_flag: row.away_team_flag,
          p_scheduled_at: row.scheduled_at, p_venue: row.venue,
          p_home_score: row.home_score, p_away_score: row.away_score,
          p_status: row.status, p_elapsed: row.elapsed,
          p_home_team_abbr: null, p_away_team_abbr: null,
          p_scheduled_at_confirmed: row.scheduled_at_confirmed,
        });
        if (error) {
          result.errors++;
          log(`[af-calendar] ${tournament} ${row.external_id}: ${error.message}`);
        } else if (typeof data !== 'string') {
          // NULL = el escritor rechazó a propósito (knockout sin slot resuelto).
          bump(result.skipped, 'writer_declined');
        } else if (plan === 'update') {
          result.updated++;
        } else {
          const target = knownIds.get(data);
          if (target && !linkedAfIds(target).length) result.linked++;
          else if (target) result.updated++;
          else result.inserted++;
        }
      } catch {
        result.errors++;
        log(`[af-calendar] ${tournament} ${row.external_id}: fallo de red al escribir`);
      }
    }
    return result;
  } catch {
    // Última red: una falla inesperada (DB caída leyendo cuota/temporada) no tumba al llamador.
    log(`[af-calendar] ${tournament}: refresco interrumpido`);
    return { ...result, errors: result.errors + 1, aborted: result.aborted ?? 'unexpected' };
  }
}

/**
 * Estimación del dry-run: cuántos fixtures nuevos caerían sobre una fila de
 * otro proveedor (mismos equipos normalizados, ±2 h o ±3 días si alguna hora
 * es provisional), cuántos chocarían con DOS filas legacy (el escritor lanza
 * «Ambiguous fixture identity» y ese partido no se escribe) y cuántas filas
 * legacy de la ventana no tienen fixture AF (quedarían como duplicado visible).
 * Es aproximada: la identidad real la decide `normalize_team_name` en SQL.
 */
export function estimateLegacyLinks(existing: ExistingMatch[], inserts: AfMatchRow[], nowMs: number) {
  const legacy = existing.filter((m) => !linkedAfIds(m).length && Date.parse(m.scheduled_at) >= nowMs - IMPORT_WINDOW_BACK_MS);
  const claimed = new Set<string>();
  let wouldLink = 0, ambiguous = 0;
  for (const row of inserts) {
    const home = roughTeamKey(row.home_team), away = roughTeamKey(row.away_team);
    const kickoff = Date.parse(row.scheduled_at);
    const hits = legacy.filter((m) => {
      const tolerance = m.scheduled_at_confirmed && row.scheduled_at_confirmed ? 2 * 3_600_000 : 3 * 86_400_000;
      return roughTeamKey(m.home_team) === home && roughTeamKey(m.away_team) === away
        && Math.abs(Date.parse(m.scheduled_at) - kickoff) <= tolerance;
    });
    if (hits.length > 1) ambiguous++;
    else if (hits.length === 1) wouldLink++;
    for (const hit of hits) claimed.add(hit.id);
  }
  return { wouldLink, ambiguous, unmatchedLegacyRows: legacy.filter((m) => !claimed.has(m.id)).length };
}

// ─────────────────────────────────────────
// Dependencias del runtime
// ─────────────────────────────────────────

/** GET a API-Football que devuelve el sobre completo (paging incluido). */
export async function fetchApiFootballEnvelope(
  path: '/fixtures' | '/leagues',
  params: Record<string, string>,
): Promise<unknown> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('Falta API_FOOTBALL_KEY');
  const url = new URL(`${AF_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'x-apisports-key': key },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // Nunca se propaga el objeto de error ni los headers: llevan la key.
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  return res.json();
}

/** Caché de temporadas en `app_config` (una llamada a /leagues por día). */
export function appConfigSeasonCache(db: SupabaseClient): SeasonCache {
  return {
    async read() {
      const { data, error } = await db.from('app_config').select('value').eq('key', SEASON_CACHE_KEY).maybeSingle();
      if (error || typeof data?.value !== 'string') return null;
      return JSON.parse(data.value) as CurrentSeasons;
    },
    async write(value) {
      const { error } = await db.from('app_config')
        .upsert({ key: SEASON_CACHE_KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error('No se guardó la caché de temporadas');
    },
  };
}

/** Temporadas memoizadas: una resolución (y a lo sumo una llamada) por corrida. */
export function memoizedSeasonResolver(
  resolve: () => Promise<CurrentSeasons | null>,
): (leagueId: number) => Promise<number | null> {
  let pending: Promise<CurrentSeasons | null> | null = null;
  return async (leagueId) => {
    pending ??= resolve().catch(() => null);
    return (await pending)?.byLeague[String(leagueId)] ?? null;
  };
}

/**
 * Deps del servidor. No hay RPC de reserva para una temporada completa: el
 * plan pagado lo confirma `apiFootballProActive` (que además concilia el
 * contador con el `/status` del proveedor) y se respeta el mismo techo de
 * 6.000 que detalle y equipos. Ver riesgos en el reporte del Paso 3.
 */
export async function createCalendarDeps(db?: SupabaseClient): Promise<CalendarDeps> {
  const client = db ?? (await import('@/lib/supabase/admin')).createAdminClient();
  const reserveRequest = async () => {
    const { apiFootballProActive } = await import('./account');
    if (!(await apiFootballProActive())) return false;
    const { data, error } = await client.from('api_football_budget')
      .select('request_day,requests_used').eq('singleton', true).maybeSingle();
    if (error || !data) return false;
    const today = new Date().toISOString().slice(0, 10);
    const used = data.request_day === today ? Number(data.requests_used) : 0;
    return Number.isFinite(used) && used < CALENDAR_REQUEST_CEILING;
  };
  const cache = appConfigSeasonCache(client);
  return {
    db: client,
    fetchEnvelope: fetchApiFootballEnvelope,
    reserveRequest,
    resolveSeason: memoizedSeasonResolver(async () => (await resolveCurrentSeasons({
      cache,
      fetchLeagues: async () => {
        if (!(await reserveRequest())) throw new Error('Cuota de API-Football no disponible');
        return fetchApiFootballEnvelope('/leagues', { current: 'true' });
      },
    }))?.seasons ?? null),
  };
}
