import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { matchesEnJuego } from '@/lib/matches/en-juego';
import { getDataProviderMode, type DataProviderMode } from '@/lib/matches/provider-mode';
import { apiFootballProActive } from './account';
import { loadFootballDate } from './feed';
import { findResultFixture, resolveResultFixture, scorePair, type LinkedResultMatch, type ResultMatch } from './results';
import { RESULT_LEAGUES } from './leagues';
import { mapApiStatus } from './mappers';

// PST (aplazado) llega como status 'scheduled' (mapApiStatus) + detalle
// STATUS_POSTPONED; solo CANC/ABD son 'cancelled'. update_match_live_provider
// (095) rechaza un 'scheduled' sobre una fila live/finished con saque pasado,
// y matches_prevent_status_regress no deja bajar un finished.
const DETAILS: Record<string,string> = {
 NS:'STATUS_SCHEDULED','1H':'STATUS_FIRST_HALF',HT:'STATUS_HALFTIME','2H':'STATUS_SECOND_HALF',
 ET:'STATUS_OVERTIME',BT:'STATUS_OVERTIME',P:'STATUS_SHOOTOUT',FT:'STATUS_FULL_TIME',
 AET:'STATUS_FINAL_AET',PEN:'STATUS_FINAL_PEN',LIVE:'STATUS_IN_PROGRESS',SUSP:'STATUS_SUSPENDED',
 INT:'STATUS_INTERRUPTED',PST:'STATUS_POSTPONED',CANC:'STATUS_CANCELED',ABD:'STATUS_ABANDONED',
};

// 'legacy': identidad por nombres + saque, como antes. 'af' (2026-09-13): las
// filas que escribió o vinculó el calendario de API-Football
// ('apifootball:<id>' en external_id o source_external_ids) se emparejan por
// id de fixture + competición; las filas viejas sin vínculo siguen por nombres.
export async function syncApiFootballLive(mode?: DataProviderMode): Promise<Set<string>> {
 const covered=new Set<string>();
 if (!await apiFootballProActive()) return covered;
 const af=(mode ?? await getDataProviderMode())==='af';
 const admin=createAdminClient();
 const desde=new Date(Date.now()-8*3600000).toISOString(), hasta=new Date(Date.now()+30*60000).toISOString();
 // 'af': TODOS los partidos de los torneos activos en la ventana, estén o no en
 // una polla. Con API-Football como única fuente nadie más los actualiza: el
 // corte del 2026-09-13 dejó a Celta–Málaga en «vivo, minuto 48» dos horas
 // después. No cuesta cuota extra: el feed por fecha ya trae los diez torneos.
 const filas:(LinkedResultMatch&{id:string})[]=af
  ? ((await admin.from('matches')
     .select('id,tournament,home_team,away_team,scheduled_at,external_id,source_external_ids')
     .in('tournament',Object.keys(RESULT_LEAGUES)).is('final_verified_at',null)
     .gte('scheduled_at',desde).lte('scheduled_at',hasta).limit(500)).data ?? []) as (LinkedResultMatch&{id:string})[]
  : (await matchesEnJuego<LinkedResultMatch&{id:string}>(admin,'id,tournament,home_team,away_team,scheduled_at',
     q=>q.is('final_verified_at',null).gte('scheduled_at',desde).lte('scheduled_at',hasta))).filas;
 const dates=Array.from(new Set(filas.map(m=>m.scheduled_at.slice(0,10))));
 for (const date of dates) {
  const feed=await loadFootballDate(date);
  if (!feed || feed.stale) continue;
  for (const match of filas.filter(m=>m.scheduled_at.slice(0,10)===date)) {
   const f=af?resolveResultFixture(match,feed.fixtures):findResultFixture(match as ResultMatch,feed.fixtures);
   if (!f || !DETAILS[f.fixture.status.short]) continue;
   const short=f.fixture.status.short, regulation=scorePair(f.score.fulltime)?f.score.fulltime:null;
   const {data:updated,error}=await admin.rpc('update_match_live_provider',{
    p_match_id:match.id,p_source:'api-football',p_provider_id:String(f.fixture.id),
    p_status:mapApiStatus(short),p_home_score:f.goals.home,p_away_score:f.goals.away,
    p_elapsed:f.fixture.status.elapsed,p_status_detail:DETAILS[short],p_observed_at:feed.fetchedAt,
    p_regulation_home:regulation?.home??null,p_regulation_away:regulation?.away??null,
   });
   if (!error && updated===true) covered.add(match.id);
  }
 }
 return covered;
}
