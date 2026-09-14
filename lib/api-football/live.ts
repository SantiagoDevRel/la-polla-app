import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiFootballProActive } from './account';
import { loadFootballDate } from './feed';
import { resolveResultFixture, scorePair, type LinkedResultMatch } from './results';
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

// API-Football es la única fuente de vivo (2026-09-13). Las filas que escribió
// o vinculó el calendario ('apifootball:<id>' en external_id o
// source_external_ids) se emparejan por id de fixture + competición; las filas
// viejas sin vínculo siguen por nombres, competición y saque.
export async function syncApiFootballLive(): Promise<Set<string>> {
 const covered=new Set<string>();
 if (!await apiFootballProActive()) return covered;
 const admin=createAdminClient();
 const desde=new Date(Date.now()-8*3600000).toISOString(), hasta=new Date(Date.now()+30*60000).toISOString();
 // TODOS los partidos de los torneos activos en la ventana, estén o no en una
 // polla: nadie más los actualiza. El corte del 2026-09-13 dejó a Celta–Málaga
 // en «vivo, minuto 48» dos horas después. No cuesta cuota extra: el feed por
 // fecha ya trae los diez torneos.
 //
 // Las filas ya terminadas (finished/cancelled) salen de la ventana: el vivo no
 // tiene nada más que escribirles (matches_prevent_status_regress no deja bajar
 // un finished) y el cierre lo hace verify-final con su propia lectura. Sin este
 // filtro, después de medianoche UTC los partidos de ayer mantenían una consulta
 // por minuto al feed de su fecha (2026-09-14). Las filas 'live' viejas siguen
 // en la ventana hasta que el proveedor las cierre, y flip_stale_live_matches
 // cubre las que el proveedor deja de reportar.
 const filas=((await admin.from('matches')
  .select('id,tournament,home_team,away_team,scheduled_at,external_id,source_external_ids')
  .in('tournament',Object.keys(RESULT_LEAGUES)).is('final_verified_at',null)
  .not('status','in','(finished,cancelled)')
  .gte('scheduled_at',desde).lte('scheduled_at',hasta).limit(500)).data ?? []) as (LinkedResultMatch&{id:string})[];
 const dates=Array.from(new Set(filas.map(m=>m.scheduled_at.slice(0,10))));
 for (const date of dates) {
  const feed=await loadFootballDate(date);
  if (!feed || feed.stale) continue;
  for (const match of filas.filter(m=>m.scheduled_at.slice(0,10)===date)) {
   const f=resolveResultFixture(match,feed.fixtures);
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
