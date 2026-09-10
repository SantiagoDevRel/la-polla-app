import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiFootballProActive } from './account';
import { apiFootballGet } from './client';
import { isValidFixture } from './mappers';
import { footballMatch, latestFootballFixtures } from './detail-model';
import { RESULT_LEAGUES } from './results';
import type { FootballSquadPlayer, FootballTeam } from './team-model';
import { apiFootballPlayerPhoto } from './player-photo';

export async function loadFootballTeam(id: number): Promise<FootballTeam | null> {
  if (!Number.isSafeInteger(id) || id<=0) return null;
  const admin=createAdminClient();
  const {data: feeds}=await admin.from('api_football_cache').select('fixtures,fetched_at')
    .gte('fixture_date',new Date(Date.now()-7*86400000).toISOString().slice(0,10))
    .lte('fixture_date',new Date(Date.now()+7*86400000).toISOString().slice(0,10));
  const {data: clubFeeds}=await admin.from('api_football_teams').select('matches,fetched_at').gte('fetched_at',new Date(Date.now()-2*86400000).toISOString());
  const observations=[...(feeds??[]).map(d=>({fixtures:Array.isArray(d.fixtures)?d.fixtures.filter(isValidFixture):[],fetchedAt:d.fetched_at})),
    ...(clubFeeds??[]).map(d=>({fixtures:Array.isArray(d.matches)?d.matches.filter(isValidFixture):[],fetchedAt:d.fetched_at}))];
  const fixtures=latestFootballFixtures(observations)
    .filter(f=>f.teams.home.id===id||f.teams.away.id===id);
  const known=fixtures[0];
  if (!known) return null;
  const seed=known.teams.home.id===id?known.teams.home:known.teams.away;
  if (await apiFootballProActive()) {
    const {data: reserved}=await admin.rpc('reserve_api_football_team',{p_team_id:id});
    if (reserved===true) {
      // Four calls reserved together: club, squad, recent and upcoming fixtures.
      // last/next are date-relative API queries; no hardcoded season is used.
      const results=await Promise.allSettled([
        apiFootballGet<{team:FootballTeam['team'];venue:FootballTeam['venue']}>('/teams',{id},{attempts:1,direct:true}),
        apiFootballGet<{team:{id:number};players:FootballSquadPlayer[]}>('/players/squads',{team:id},{attempts:1,direct:true}),
        apiFootballGet<unknown>('/fixtures',{team:id,last:5},{attempts:1,direct:true}),
        apiFootballGet<unknown>('/fixtures',{team:id,next:5},{attempts:1,direct:true}),
      ]);
      const profile=results[0].status==='fulfilled'?results[0].value.find(x=>x.team?.id===id):undefined;
      const squad=results[1].status==='fulfilled'?results[1].value.find(x=>x.team?.id===id)?.players:undefined;
      const recent=results[2].status==='fulfilled'?results[2].value:null;
      const upcoming=results[3].status==='fulfilled'?results[3].value:null;
      const matches=recent&&upcoming?[...recent,...upcoming].filter(isValidFixture)
        .filter(f=>Object.values(RESULT_LEAGUES).includes(f.league?.id)&&(f.teams.home.id===id||f.teams.away.id===id)):null;
      if (profile || squad || matches) await admin.from('api_football_teams').update({
        ...(profile?{profile}:{}),...(Array.isArray(squad)?{squad}:{}),
        // This timestamp orders score observations. A successful squad/profile call
        // must never make a failed (older) calendar look newer than a live feed.
        ...(matches?{matches,fetched_at:new Date().toISOString()}:{}),
      }).eq('team_id',id);
    }
  }
  const {data}=await admin.from('api_football_teams').select('profile,squad,matches,fetched_at').eq('team_id',id).maybeSingle();
  const teamMatches=Array.isArray(data?.matches)?data.matches.filter(isValidFixture):[];
  const merged=latestFootballFixtures([...observations,{fixtures:teamMatches,fetchedAt:data?.fetched_at??null}])
    .filter(f=>f.teams.home.id===id||f.teams.away.id===id);
  return {team:data?.profile?.team??{...seed,country:null,founded:null},venue:data?.profile?.venue??null,
    players:Array.isArray(data?.squad)?data.squad.map((player:FootballSquadPlayer)=>({...player,photo:player.photo||apiFootballPlayerPhoto(player.id)})):[],
    matches:merged.map(footballMatch).sort((a,b)=>a.date.localeCompare(b.date)),fetchedAt:data?.fetched_at??null};
}
