/**
 * Módulo de Sincronización: API-Football → Supabase
 *
 * Contiene las 3 funciones principales del módulo:
 *
 * 1. importMatches()     - Importa todos los partidos del Mundial 2026
 * 2. pollLiveMatches()   - Polling de resultados en vivo
 * 3. lockPredictions()   - Lock automático de pronósticos 5 min antes del partido
 *
 * Usa el Supabase service role client para bypass de RLS,
 * ya que estas operaciones son server-side y no tienen contexto de usuario.
 */

import { apiFootballGet } from './client';
import { createAdminClient } from '../supabase/admin';
import { hasPlaceholderTeam } from '@/lib/matches/is-placeholder';
import {
  ApiFootballFixture,
  MatchRow,
  mapFixtureToMatch,
  isValidFixture,
  mapApiStatus,
  mapFinalScore,
} from './mappers';

// ─────────────────────────────────────────
// Supabase service role client
// Usa createAdminClient de lib/supabase/admin.ts
// ─────────────────────────────────────────

function getSupabaseAdmin() {
  return createAdminClient();
}

// ─────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────

/** World Cup league ID en API-Football */
const WORLD_CUP_LEAGUE_ID = 1;

/** Identificador del torneo en nuestra DB */
const TOURNAMENT_ID = 'worldcup_2026';

// ─────────────────────────────────────────
// Cálculo dinámico de temporada
// ─────────────────────────────────────────

/** Ligas que abarcan dos años (temporada comienza en segundo semestre) */
const MULTI_YEAR_LEAGUES = new Set([2, 3, 4, 5, 848]); // UCL, Europa League, top-5 ligas europeas

/**
 * Calcula la temporada correcta para una liga dada.
 * - Ligas multi-año (UCL, etc.): si estamos >= junio, season = year actual; si < junio, season = year - 1
 * - Ligas de año único (Mundial, Copa América): season = year actual
 */
export function getSeasonForLeague(leagueId: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  if (MULTI_YEAR_LEAGUES.has(leagueId)) {
    const season = currentMonth >= 6 ? currentYear : currentYear - 1;
    console.log(`[sync] Liga ${leagueId} (multi-año): mes=${currentMonth}, season=${season}`);
    return season;
  }

  console.log(`[sync] Liga ${leagueId} (año único): season=${currentYear}`);
  return currentYear;
}

// ─────────────────────────────────────────
// 0. SYNC GENÉRICO POR LIGA
// ─────────────────────────────────────────

/**
 * Mapeo de league ID + season a nombre de torneo en nuestra DB.
 * Si la combinación no está mapeada, genera un nombre automático: "league_{id}_{season}"
 */
const TOURNAMENT_NAMES: Record<string, string> = {
  '1_2026': 'worldcup_2026',
  '2_2024': 'champions_2025',       // Champions 2024-2025 season (started Aug 2024)
  '2_2025': 'champions_2025',       // Champions 2025-2026 season — maps to same DB tournament
  '239_2025': 'liga_betplay_2025',
  '239_2024': 'liga_betplay_2024',
};

function getTournamentName(leagueId: number, season: number): string {
  return TOURNAMENT_NAMES[`${leagueId}_${season}`] || `league_${leagueId}_${season}`;
}

/**
 * Sincroniza todos los partidos de una liga/temporada desde API-Football a Supabase.
 *
 * Función genérica que reemplaza importMatches() para soportar cualquier liga.
 * Usa upsert con external_id como campo de conflicto para evitar duplicados.
 *
 * @param leagueId - ID de la liga en API-Football (1=World Cup, 2=Champions, 239=BetPlay)
 * @param season - Temporada (ej: 2024, 2025, 2026)
 * @returns Resumen: { synced, errors, total }
 */
export async function syncLeague(
  leagueId: number,
  season: number
): Promise<{ synced: number; errors: number; total: number }> {
  const tournament = getTournamentName(leagueId, season);
  console.log(`[sync] Sincronizando league=${leagueId} season=${season} → tournament="${tournament}"`);

  // 1. Consultar API-Football por todos los fixtures de la liga/temporada
  let fixtures: ApiFootballFixture[];
  try {
    fixtures = await apiFootballGet<ApiFootballFixture>('/fixtures', {
      league: leagueId,
      season,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Manejar errores de suscripción o acceso gracefully
    if (msg.includes('403') || msg.includes('subscription') || msg.includes('plan')) {
      console.warn(`[sync] Liga ${leagueId} season ${season} requiere plan pago de API-Football: ${msg}`);
      return { synced: 0, errors: 0, total: 0 };
    }
    throw err;
  }

  console.log(`[sync] API-Football devolvió ${fixtures.length} fixtures para liga ${leagueId} season ${season}`);

  if (fixtures.length === 0) {
    console.warn(`[sync] Fixtures no disponibles aun para liga ${leagueId} season ${season}`);
    return { synced: 0, errors: 0, total: 0 };
  }

  const supabase = getSupabaseAdmin();
  let synced = 0;
  let errors = 0;

  // 2. Procesar cada fixture
  for (const fixture of fixtures) {
    if (!isValidFixture(fixture)) {
      console.warn(
        `[sync] Fixture inválido, saltando:`,
        JSON.stringify(fixture).substring(0, 200)
      );
      errors++;
      continue;
    }

    // 3. Mapear al schema de Supabase
    const matchRow: MatchRow = mapFixtureToMatch(fixture, tournament);

    // REGLA #2: skip si home/away son placeholders del bracket (ej: "1A",
    // "W73", "L101"). API-Football devuelve esto para knockout slots aun
    // sin resolver — no entran en matches.
    if (hasPlaceholderTeam(matchRow.home_team, matchRow.away_team)) {
      console.warn(
        `[sync] Skip placeholder ${matchRow.external_id}: ${matchRow.home_team} vs ${matchRow.away_team}`,
      );
      continue;
    }

    try {
      // 4. CRITICAL: usar upsert_match_safe (no upsert directo) para que
      // el dedup cross-provider funcione. Bug fixed 2026-05-06: antes
      // este sync hacia .upsert(matchRow, {onConflict:'external_id'}) que
      // solo dedupa contra rows del mismo proveedor, creando duplicados
      // cuando ESPN o openfootball habian sincronizado el mismo partido.
      const { error } = await supabase.rpc('upsert_match_safe', {
        p_external_id: matchRow.external_id,
        p_tournament: matchRow.tournament,
        p_match_day: matchRow.match_day,
        p_phase: matchRow.phase,
        p_home_team: matchRow.home_team,
        p_away_team: matchRow.away_team,
        p_home_team_flag: matchRow.home_team_flag,
        p_away_team_flag: matchRow.away_team_flag,
        p_scheduled_at: matchRow.scheduled_at,
        p_venue: matchRow.venue,
        p_home_score: matchRow.home_score,
        p_away_score: matchRow.away_score,
        p_status: matchRow.status,
        p_elapsed: null,
      });

      if (error) {
        console.error(`[sync] Error en upsert_match_safe fixture ${matchRow.external_id}:`, error.message);
        errors++;
      } else {
        synced++;
      }
    } catch (err) {
      console.error(
        `[sync] Error inesperado en fixture ${matchRow.external_id}:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    }
  }

  const result = { synced, errors, total: fixtures.length };
  console.log(`[sync] Sincronización completada:`, result);
  return result;
}

// ─────────────────────────────────────────
// 1. IMPORTAR PARTIDOS DEL MUNDIAL 2026 (legacy — usa syncLeague internamente)
// ─────────────────────────────────────────

/**
 * Importa TODOS los partidos del Mundial 2026 desde API-Football a Supabase.
 *
 * Endpoint de API-Football: GET /fixtures?league=1&season=2026
 * - league=1 es World Cup
 * - season=2026 es la edición 2026
 *
 * Comportamiento:
 * - Si el partido ya existe (por external_id), hace UPDATE
 * - Si es nuevo, hace INSERT
 * - Descarga las URLs de banderas de los equipos (campo `logo` de la API)
 * - Retorna un resumen de cuántos se importaron/actualizaron
 *
 * Uso: Se ejecuta una sola vez al inicio del torneo, o cuando
 *       se necesite re-sincronizar todos los partidos.
 */
export async function importMatches(): Promise<{
  imported: number;
  updated: number;
  errors: number;
  total: number;
}> {
  console.log('[sync] Iniciando importación de partidos del Mundial 2026...');

  // 1. Consultar API-Football por todos los fixtures del Mundial
  const worldCupSeason = getSeasonForLeague(WORLD_CUP_LEAGUE_ID);
  const fixtures = await apiFootballGet<ApiFootballFixture>('/fixtures', {
    league: WORLD_CUP_LEAGUE_ID,
    season: worldCupSeason,
  });

  console.log(`[sync] API-Football devolvió ${fixtures.length} fixtures`);

  const supabase = getSupabaseAdmin();
  let imported = 0;
  // updated ya no se usa: el RPC upsert_match_safe no diferencia
  // insert vs update y todo entra al contador imported.
  const updated = 0;
  let errors = 0;

  // 2. Procesar cada fixture
  for (const fixture of fixtures) {
    // Validar que el fixture tenga datos completos
    if (!isValidFixture(fixture)) {
      console.warn(
        `[sync] Fixture inválido o incompleto, saltando:`,
        JSON.stringify(fixture).substring(0, 200)
      );
      errors++;
      continue;
    }

    // 3. Mapear al schema de Supabase
    const matchRow: MatchRow = mapFixtureToMatch(fixture, TOURNAMENT_ID);

    // REGLA #2: skip placeholders del bracket. Mismo guard que arriba.
    if (hasPlaceholderTeam(matchRow.home_team, matchRow.away_team)) {
      console.warn(
        `[sync] Skip placeholder ${matchRow.external_id}: ${matchRow.home_team} vs ${matchRow.away_team}`,
      );
      continue;
    }

    try {
      // 4. CRITICAL: usar upsert_match_safe (no insert/update directo)
      // para que el dedup cross-provider funcione. Antes este path tenia
      // un select+insert/update por external_id que dedupaba solo contra
      // sus propios rows. Ahora delegamos al RPC que tambien chequea
      // espn_id y match-by-team.
      const { error } = await supabase.rpc('upsert_match_safe', {
        p_external_id: matchRow.external_id,
        p_tournament: matchRow.tournament,
        p_match_day: matchRow.match_day,
        p_phase: matchRow.phase,
        p_home_team: matchRow.home_team,
        p_away_team: matchRow.away_team,
        p_home_team_flag: matchRow.home_team_flag,
        p_away_team_flag: matchRow.away_team_flag,
        p_scheduled_at: matchRow.scheduled_at,
        p_venue: matchRow.venue,
        p_home_score: matchRow.home_score,
        p_away_score: matchRow.away_score,
        p_status: matchRow.status,
        p_elapsed: null,
      });
      if (error) {
        console.error(`[sync] Error procesando fixture ${matchRow.external_id}:`, error.message);
        errors++;
      } else {
        // No distinguimos imported vs updated cuando vamos por RPC; se
        // suma al contador combinado.
        imported++;
      }
    } catch (err) {
      // Si Supabase falla, logueamos pero NO rompemos el proceso
      console.error(
        `[sync] Error inesperado procesando fixture ${matchRow.external_id}:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    }
  }

  const summary = { imported, updated, errors, total: fixtures.length };
  console.log('[sync] Importación completada:', summary);
  return summary;
}

// ─────────────────────────────────────────
// 2. POLLING DE RESULTADOS EN VIVO
// ─────────────────────────────────────────

/**
 * Verifica si el polling está activado consultando la tabla app_config.
 *
 * La tabla app_config tiene un registro con key='polling_active' y value='true'/'false'.
 * Esto permite activar/desactivar el polling desde un panel admin
 * sin necesidad de re-deploy.
 *
 * Si la tabla no existe o no tiene el registro, retorna true (polling activo por defecto).
 */
async function isPollingActive(): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'polling_active')
    .maybeSingle();

  if (error || !data) {
    // Si no existe la tabla o el registro, polling activo por defecto
    return true;
  }

  return data.value === 'true';
}

/**
 * Polling de resultados en vivo.
 *
 * Estrategia para ahorrar requests (plan gratuito = 100/día):
 * 1. Solo consulta partidos con status='scheduled' o 'live' en las próximas 24h
 * 2. Si no hay partidos activos, no hace ninguna llamada a la API
 * 3. Consulta cada partido individualmente: GET /fixtures?id={external_id}
 * 4. Si el status cambió, actualiza en Supabase (el trigger de DB calcula puntos)
 *
 * El trigger `trigger_match_status_change` en Supabase se encarga de:
 * - Calcular puntos cuando un partido termina (status → 'finished')
 * - Hacer visibles los pronósticos cuando un partido comienza (status → 'live')
 *
 * @returns Resumen de partidos consultados y actualizados
 */
export async function pollLiveMatches(): Promise<{
  checked: number;
  updated: number;
  skipped: boolean;
  reason?: string;
}> {
  // Verificar si el polling está activado
  const active = await isPollingActive();
  if (!active) {
    console.log('[poll] Polling desactivado desde app_config');
    return { checked: 0, updated: 0, skipped: true, reason: 'polling_disabled' };
  }

  const supabase = getSupabaseAdmin();

  // 1. Buscar partidos que necesitan actualización:
  //    - status='scheduled' o 'live'
  //    - scheduled_at dentro de las próximas 24 horas O ya empezaron (live)
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: activeMatches, error: queryError } = await supabase
    .from('matches')
    .select('id, external_id, status, home_team, away_team, home_score, away_score')
    .in('status', ['scheduled', 'live'])
    .or(`scheduled_at.lte.${in24h},status.eq.live`)
    .not('external_id', 'is', null);

  if (queryError) {
    console.error('[poll] Error consultando partidos activos:', queryError.message);
    return { checked: 0, updated: 0, skipped: true, reason: 'db_query_error' };
  }

  if (!activeMatches || activeMatches.length === 0) {
    console.log('[poll] No hay partidos activos en las próximas 24h');
    return { checked: 0, updated: 0, skipped: true, reason: 'no_active_matches' };
  }

  console.log(`[poll] ${activeMatches.length} partidos activos para verificar`);

  let updated = 0;

  // 2. Consultar cada partido activo en API-Football
  for (const match of activeMatches) {
    try {
      // GET /fixtures?id={external_id}
      const fixtures = await apiFootballGet<ApiFootballFixture>('/fixtures', {
        id: Number(match.external_id),
      });

      if (!fixtures || fixtures.length === 0) {
        console.warn(`[poll] No se encontró fixture ${match.external_id} en API-Football`);
        continue;
      }

      const fixture = fixtures[0];

      // Validar respuesta
      if (!isValidFixture(fixture)) {
        console.warn(`[poll] Respuesta inválida para fixture ${match.external_id}, saltando`);
        continue;
      }

      // 3. Mapear el nuevo status
      const newStatus = mapApiStatus(fixture.fixture.status.short);
      const { home: newHomeScore, away: newAwayScore } = mapFinalScore(fixture);

      // 4. Verificar si algo cambió
      const statusChanged = newStatus !== match.status;
      const scoreChanged =
        newHomeScore !== match.home_score || newAwayScore !== match.away_score;

      if (!statusChanged && !scoreChanged) {
        continue; // Sin cambios, siguiente partido
      }

      // 5. Preparar el update
      const updateData: Record<string, unknown> = {};

      if (statusChanged) {
        updateData.status = newStatus;
        console.log(
          `[poll] ${match.home_team} vs ${match.away_team}: ` +
            `status ${match.status} -> ${newStatus} ` +
            `[${new Date().toISOString()}]`
        );
      }

      // Solo actualizar scores si el partido terminó y los datos son válidos
      if (
        newStatus === 'finished' &&
        newHomeScore !== null &&
        newAwayScore !== null
      ) {
        updateData.home_score = newHomeScore;
        updateData.away_score = newAwayScore;
        console.log(
          `[poll] ${match.home_team} ${newHomeScore} - ${newAwayScore} ${match.away_team} ` +
            `[${new Date().toISOString()}]`
        );
      }

      // También actualizar scores para partidos en vivo (para mostrar en tiempo real)
      if (newStatus === 'live' && fixture.goals.home !== null && fixture.goals.away !== null) {
        updateData.home_score = fixture.goals.home;
        updateData.away_score = fixture.goals.away;
      }

      // 6. Actualizar en Supabase
      const { error: updateError } = await supabase
        .from('matches')
        .update(updateData)
        .eq('id', match.id);

      if (updateError) {
        console.error(
          `[poll] Error actualizando match ${match.external_id}:`,
          updateError.message
        );
      } else {
        updated++;
      }
    } catch (err) {
      // Si falla un partido, seguir con los demás
      console.error(
        `[poll] Error procesando fixture ${match.external_id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[poll] Polling completado: ${activeMatches.length} verificados, ${updated} actualizados ` +
      `[${new Date().toISOString()}]`
  );

  return { checked: activeMatches.length, updated, skipped: false };
}

// ─────────────────────────────────────────
// 3. LOCK AUTOMÁTICO DE PRONÓSTICOS
// ─────────────────────────────────────────

/**
 * Bloquea automáticamente los pronósticos 5 minutos antes de cada partido.
 *
 * Busca partidos que empiezan entre 4 y 6 minutos a partir de ahora
 * (ventana de 2 minutos para que el cron de cada minuto los capture).
 *
 * Para cada partido encontrado:
 * 1. UPDATE predictions SET locked=true WHERE match_id=partido.id
 *
 * NOTA: El trigger `check_prediction_lock` en la DB es el guardián definitivo
 * que impide INSERT/UPDATE en predictions si faltan <5 min.
 * Este lock proactivo es para que el frontend muestre el estado correcto
 * en tiempo real (sin esperar a que el usuario intente hacer submit).
 *
 * @returns Número de partidos y pronósticos bloqueados
 */
export async function lockPredictions(): Promise<{
  matchesLocked: number;
  predictionsLocked: number;
}> {
  const supabase = getSupabaseAdmin();

  // Buscar partidos que empiezan en ~5 minutos (ventana 4-6 min)
  // Esto permite que un cron que corre cada minuto siempre los capture
  const now = new Date();
  const in4min = new Date(now.getTime() + 4 * 60 * 1000).toISOString();
  const in6min = new Date(now.getTime() + 6 * 60 * 1000).toISOString();

  const { data: matchesToLock, error: queryError } = await supabase
    .from('matches')
    .select('id, home_team, away_team, scheduled_at')
    .eq('status', 'scheduled')
    .gte('scheduled_at', in4min)
    .lte('scheduled_at', in6min);

  if (queryError) {
    console.error('[lock] Error consultando partidos a bloquear:', queryError.message);
    return { matchesLocked: 0, predictionsLocked: 0 };
  }

  if (!matchesToLock || matchesToLock.length === 0) {
    return { matchesLocked: 0, predictionsLocked: 0 };
  }

  let totalPredictionsLocked = 0;

  for (const match of matchesToLock) {
    console.log(
      `[lock] Bloqueando pronósticos para ${match.home_team} vs ${match.away_team} ` +
        `(inicia: ${match.scheduled_at}) [${new Date().toISOString()}]`
    );

    // Bloquear todos los pronósticos de este partido que no estén ya bloqueados
    const { data: updatedPreds, error: lockError } = await supabase
      .from('predictions')
      .update({ locked: true })
      .eq('match_id', match.id)
      .eq('locked', false)
      .select('id');

    if (lockError) {
      console.error(
        `[lock] Error bloqueando predicciones del match ${match.id}:`,
        lockError.message
      );
    } else {
      const count = updatedPreds?.length || 0;
      totalPredictionsLocked += count;
      console.log(`[lock] ${count} pronósticos bloqueados para este partido`);
    }
  }

  return {
    matchesLocked: matchesToLock.length,
    predictionsLocked: totalPredictionsLocked,
  };
}
