import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { COMPETITIONS, syncCompetition } from '@/lib/football-data/sync';
import { discoverTournament } from '@/lib/espn/discover';
import { ESPN_LEAGUE_BY_TOURNAMENT } from '@/lib/espn/client';
import { isSyncableTournament } from '@/lib/tournaments';

/** Upcoming fixtures need refresh even when the stored list is nonempty.
 * Shared reservation limits all admin/legacy/cron callers to one refresh per
 * league per 15 minutes. It is awaited before returning the calendar.
 */
export async function refreshTournamentSchedule(tournament: string): Promise<boolean> {
  if (!isSyncableTournament(tournament) || !ESPN_LEAGUE_BY_TOURNAMENT[tournament]) return false;
  const admin = createAdminClient();
  const { data: reserved, error } = await admin.rpc('reserve_tournament_schedule_sync', {
    p_tournament: tournament,
  });
  if (error) return false;
  if (!reserved) {
    const { data } = await admin.from('app_config').select('value').eq('key', `schedule_${tournament}`).maybeSingle();
    return data?.value === 'fresh';
  }
  let refreshed = false;
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
  const { error: writeError } = await admin.from('app_config')
    .update({ value: refreshed ? 'fresh' : 'failed' }).eq('key', `schedule_${tournament}`);
  return refreshed && !writeError;
}
