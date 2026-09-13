import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadFootballTeam } from '@/lib/api-football/teams';
import { createAdminClient } from '@/lib/supabase/admin';
import { findFootballFixture } from '@/lib/api-football/feed';

export async function GET(_request: Request,{params}:{params:Promise<{id:string}>}) {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({error:'No autorizado'},{status:401});
  const {id}=await params;
  let teamId=Number(id);
  const reference=id.match(/^(home|away)\.([0-9a-f-]{36})$/i);
  if(reference){
    const {data:match}=await createAdminClient().from('matches').select('tournament,home_team,away_team,scheduled_at').eq('id',reference[2]).maybeSingle();
    const fixture=match?await findFootballFixture(match):null;
    teamId=fixture?.teams[reference[1] as 'home'|'away'].id??0;
  } else if(!/^\d{1,10}$/.test(id)||teamId<=0) return NextResponse.json({error:'Equipo inválido'},{status:400});
  const team=await loadFootballTeam(teamId);
  return NextResponse.json(team??{error:'Equipo no disponible en este calendario'},
    {status:team?200:404,headers:{'Cache-Control':'private, no-store'}});
}
