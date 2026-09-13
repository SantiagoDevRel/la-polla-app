import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ESPN_LEAGUE_BY_TOURNAMENT, fetchEspnScoreboardWithDates } from '@/lib/espn/client';
import { fetchEspnSummary } from '@/lib/espn/summary';
import { findEspnResult } from '@/lib/matches/result-identity';
import { findFootballFixture } from '@/lib/api-football/feed';
import { loadFootballDetail } from '@/lib/api-football/details';

/** Match details are read-only. Both providers must pass ordered team/date identity. */
export async function GET(_request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({error:'No autorizado'},{status:401});
  const {id}=await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Partido inválido'},{status:400});
  const {data,error}=await createAdminClient().from('matches')
    .select('id,tournament,external_id,espn_id,scheduled_at,status,home_team,away_team,home_team_flag,away_team_flag,home_score,away_score,elapsed,final_verified_at')
    .eq('id',id).maybeSingle();
  if(error||!data) return NextResponse.json({error:'Partido no encontrado'},{status:error?500:404});
  try {
    const fixture=await findFootballFixture(data);
    const detail=fixture?await loadFootballDetail(fixture.fixture.id):null;
    if(detail) return NextResponse.json(detail,{headers:{'Cache-Control':'private, no-store'}});
  } catch { /* Use the independent, identity-checked backup below. */ }
  try {
    const league=ESPN_LEAGUE_BY_TOURNAMENT[data.tournament];
    const date=data.scheduled_at.slice(0,10).replaceAll('-','');
    const events=league?await fetchEspnScoreboardWithDates(league,date):[];
    const event=findEspnResult(data,events);
    const summary=event?await fetchEspnSummary(data.tournament,event.id,{live:data.status==='live'}):null;
    return NextResponse.json({summary,source:summary?'espn':null},{headers:{'Cache-Control':'private, no-store'}});
  } catch {
    return NextResponse.json({summary:null,source:null},{headers:{'Cache-Control':'private, no-store'}});
  }
}
