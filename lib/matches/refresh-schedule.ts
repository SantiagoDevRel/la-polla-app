import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSyncableTournament, SYNCABLE_TOURNAMENT_SLUGS } from '@/lib/tournaments';
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
  /** Conteos del refresco cuando la reserva se tomó. */
  af?: Pick<AfRefreshResult, 'fetched' | 'inserted' | 'updated' | 'linked' | 'unchanged' | 'skipped' | 'errors' | 'aborted' | 'truncated'>;
}

interface RefreshOptions {
  deadlineMs?: number;
  /** Deps compartidas entre ligas: una sola resolución de temporadas por corrida. */
  deps?: CalendarDeps;
}

/** Upcoming fixtures need refresh even when the stored list is nonempty.
 * Shared reservation limits all admin/cron callers to one refresh per
 * league per 15 minutes. It is awaited before returning the calendar.
 */
export async function refreshTournamentSchedule(tournament: string, options: RefreshOptions = {}): Promise<boolean> {
  return (await refreshTournamentScheduleDetailed(tournament, options)).refreshed;
}

/**
 * API-Football es la única fuente de calendario (2026-09-13). 'fresh' solo si
 * la temporada llegó completa, sin errores de fila y sin que el plazo cortara
 * escrituras. Estado compartido en `app_config.schedule_<t>`.
 */
export async function refreshTournamentScheduleDetailed(
  tournament: string,
  options: RefreshOptions = {},
): Promise<ScheduleRefresh> {
  if (!isSyncableTournament(tournament) || !afLeagueIdForTournament(tournament)) {
    return { tournament, refreshed: false, state: 'unsupported' };
  }

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
  const result = await refreshAfTournament(tournament, {
    mode: 'apply',
    deadlineMs: options.deadlineMs ?? Date.now() + DEFAULT_REFRESH_BUDGET_MS,
  }, options.deps ?? await createCalendarDeps(admin));
  const { fetched, inserted, updated, linked, unchanged, skipped, errors, aborted, truncated } = result;
  const af = { fetched, inserted, updated, linked, unchanged, skipped, errors, aborted, truncated };
  const refreshed = aborted === null && errors === 0 && !truncated;
  if (!refreshed) {
    console.warn('[schedule] API-Football calendar incomplete:', tournament, aborted ?? (truncated ? 'truncated' : `errors=${errors}`));
  }
  const { error: writeError } = await admin.from('app_config')
    .update({ value: refreshed ? 'fresh' : 'failed' }).eq('key', `schedule_${tournament}`);
  const ok = refreshed && !writeError;
  return { tournament, refreshed: ok, state: ok ? 'fresh' : 'failed', af };
}

/**
 * Cron: recorre las ligas de la última intentada a la más reciente
 * (`schedule_<t>.updated_at` lo fija la reserva), en serie, y no arranca una
 * liga nueva pasado el presupuesto. Las que no alcanzan quedan 'not_started'
 * y la próxima corrida las toma primero.
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
    results.push(await refreshTournamentScheduleDetailed(tournament, { deps, deadlineMs: writeDeadline }));
  }
  return results;
}
