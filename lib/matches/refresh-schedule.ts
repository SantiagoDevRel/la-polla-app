import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { COMPETITIONS, syncCompetition } from '@/lib/football-data/sync';
import { discoverTournament } from '@/lib/espn/discover';
import { ESPN_LEAGUE_BY_TOURNAMENT } from '@/lib/espn/client';
import { isSyncableTournament, SYNCABLE_TOURNAMENT_SLUGS } from '@/lib/tournaments';
import { getDataProviderMode, type DataProviderMode } from '@/lib/matches/provider-mode';
import { createCalendarDeps, refreshAfTournament, type AfRefreshResult, type CalendarDeps } from '@/lib/api-football/calendar';
import { afLeagueIdForTournament } from '@/lib/api-football/season';

/** Plazo por defecto de un refresco: deja margen al techo de 60 s de Vercel. */
const DEFAULT_REFRESH_BUDGET_MS = 45_000;
/** Recorrido de todas las ligas (cron): no se arranca una liga nueva pasado esto. */
export const AF_START_BUDGET_MS = 35_000;
/** Ni la última liga escribe después de esto. */
export const AF_WRITE_BUDGET_MS = 50_000;

export type ScheduleState = 'fresh' | 'failed' | 'pending' | 'unsupported' | 'reservation_error' | 'not_started';

export interface ScheduleRefresh {
  tournament: string;
  refreshed: boolean;
  state: ScheduleState;
  /** Solo modo 'af' cuando la reserva se tomó: conteos del refresco. */
  af?: Pick<AfRefreshResult, 'fetched' | 'inserted' | 'updated' | 'linked' | 'unchanged' | 'skipped' | 'errors' | 'aborted' | 'truncated'>;
}

interface RefreshOptions {
  deadlineMs?: number;
  /** Deps AF compartidas entre ligas: una sola resolución de temporadas por corrida. */
  deps?: CalendarDeps;
  mode?: DataProviderMode;
}

/** Upcoming fixtures need refresh even when the stored list is nonempty.
 * Shared reservation limits all admin/legacy/cron callers to one refresh per
 * league per 15 minutes. It is awaited before returning the calendar.
 */
export async function refreshTournamentSchedule(tournament: string, options: RefreshOptions = {}): Promise<boolean> {
  return (await refreshTournamentScheduleDetailed(tournament, options)).refreshed;
}

/**
 * Misma reserva y mismo estado `schedule_<t>` en los dos modos. En 'legacy'
 * es exactamente el comportamiento previo (football-data y ESPN). En 'af' la
 * única fuente es API-Football: 'fresh' solo si la temporada llegó completa,
 * sin errores de fila y sin que el plazo cortara escrituras.
 */
export async function refreshTournamentScheduleDetailed(
  tournament: string,
  options: RefreshOptions = {},
): Promise<ScheduleRefresh> {
  const unsupported: ScheduleRefresh = { tournament, refreshed: false, state: 'unsupported' };
  if (!isSyncableTournament(tournament)) return unsupported;
  const mode = options.mode ?? await getDataProviderMode();
  if (mode === 'af' ? !afLeagueIdForTournament(tournament) : !ESPN_LEAGUE_BY_TOURNAMENT[tournament]) return unsupported;

  const admin = createAdminClient();
  const { data: reserved, error } = await admin.rpc('reserve_tournament_schedule_sync', {
    p_tournament: tournament,
  });
  if (error) return { tournament, refreshed: false, state: 'reservation_error' };
  if (!reserved) {
    const { data } = await admin.from('app_config').select('value').eq('key', `schedule_${tournament}`).maybeSingle();
    return data?.value === 'fresh'
      ? { tournament, refreshed: true, state: 'fresh' }
      : { tournament, refreshed: false, state: 'pending' };
  }
  let refreshed = false;
  let af: ScheduleRefresh['af'];
  if (mode === 'af') {
    const result = await refreshAfTournament(tournament, {
      mode: 'apply',
      deadlineMs: options.deadlineMs ?? Date.now() + DEFAULT_REFRESH_BUDGET_MS,
    }, options.deps ?? await createCalendarDeps(admin));
    const { fetched, inserted, updated, linked, unchanged, skipped, errors, aborted, truncated } = result;
    af = { fetched, inserted, updated, linked, unchanged, skipped, errors, aborted, truncated };
    refreshed = aborted === null && errors === 0 && !truncated;
    if (!refreshed) {
      console.warn('[schedule] API-Football calendar incomplete:', tournament, aborted ?? (truncated ? 'truncated' : `errors=${errors}`));
    }
  } else {
    try {
      const competition = COMPETITIONS.find(c => c.tournament === tournament);
      if (competition) {
        const now = Date.now();
        // dateTo is exclusive in football-data v4. Include 30 full upcoming days.
        const from = new Date(now - 86400000).toISOString().slice(0, 10);
        const to = new Date(now + 31 * 86400000).toISOString().slice(0, 10);
        const result = await syncCompetition(competition.id, tournament, undefined, from, to);
        refreshed = result.errors === 0 && result.total > 0;
      }
      if (!refreshed) {
        const result = await discoverTournament(tournament, { daysAhead: 30, daysBack: 1 });
        refreshed = result.errors === 0;
      }
    } catch {
      console.warn('[schedule] Upcoming calendar could not be refreshed:', tournament);
    }
  }
  const { error: writeError } = await admin.from('app_config')
    .update({ value: refreshed ? 'fresh' : 'failed' }).eq('key', `schedule_${tournament}`);
  const ok = refreshed && !writeError;
  return { tournament, refreshed: ok, state: ok ? 'fresh' : 'failed', ...(af ? { af } : {}) };
}

/**
 * Cron en modo 'af': recorre las ligas de la última intentada a la más
 * reciente (`schedule_<t>.updated_at` lo fija la reserva), en serie, y no
 * arranca una liga nueva pasados 40 s. Las que no alcanzan quedan
 * 'not_started' y la próxima corrida las toma primero.
 */
export async function refreshAfSchedules(
  options: { startBudgetMs?: number; writeBudgetMs?: number; now?: () => number } = {},
): Promise<ScheduleRefresh[]> {
  const now = options.now ?? Date.now;
  const started = now();
  const startBudget = options.startBudgetMs ?? AF_START_BUDGET_MS;
  const writeDeadline = started + (options.writeBudgetMs ?? AF_WRITE_BUDGET_MS);
  const slugs = SYNCABLE_TOURNAMENT_SLUGS.filter(s => afLeagueIdForTournament(s));
  const admin = createAdminClient();
  const { data } = await admin.from('app_config').select('key,updated_at')
    .in('key', slugs.map(s => `schedule_${s}`));
  const lastAttempt = new Map((data ?? []).map(r => [r.key as string, Date.parse(r.updated_at as string) || 0]));
  const ordered = [...slugs].sort((a, b) =>
    (lastAttempt.get(`schedule_${a}`) ?? 0) - (lastAttempt.get(`schedule_${b}`) ?? 0)
    || slugs.indexOf(a) - slugs.indexOf(b));

  const deps = await createCalendarDeps(admin);
  const results: ScheduleRefresh[] = [];
  for (const tournament of ordered) {
    if (now() - started >= startBudget) {
      results.push({ tournament, refreshed: false, state: 'not_started' });
      continue;
    }
    results.push(await refreshTournamentScheduleDetailed(tournament, { mode: 'af', deps, deadlineMs: writeDeadline }));
  }
  return results;
}
