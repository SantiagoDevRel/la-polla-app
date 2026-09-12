import type { MatchSummary, LineupPlayer, TimelineEvent } from '@/lib/espn/summary';
import type { ApiFootballFixture } from './mappers';
import { RESULT_LEAGUES } from './results';
import { apiFootballPlayerPhoto } from './player-photo';

export interface PlayerPerformance extends LineupPlayer {
  id: number; grid: string | null; minutes: number | null; goals: number | null;
  assists: number | null; rating: string | null; yellow: number | null; red: number | null;
}
type RawPlayer = {id: number; name: string; number?: number; pos?: string; grid?: string};
export interface DetailedFixture extends ApiFootballFixture {
  events?: {time?: {elapsed?: number; extra?: number}; team?: {id: number}; player?: {name?: string};
    assist?: {name?: string}; type?: string; detail?: string; comments?: string}[];
  statistics?: {team: {id: number}; statistics: {type: string; value: number | string | null}[]}[];
  lineups?: {team: {id: number; name: string}; formation?: string; coach?: {name?: string};
    startXI?: {player: RawPlayer}[]; substitutes?: {player: RawPlayer}[]}[];
  players?: {team: {id: number}; players: {player: {id: number; photo?: string}; statistics?: {
    games?: {minutes?: number; rating?: string}; goals?: {total?: number; assists?: number}; cards?: {yellow?: number; red?: number}
  }[]}[] }[];
}
export interface FootballMatch {
  id: number; tournament: string; date: string; status: string; minute: number | null;
  home: {id: number; name: string; logo: string}; away: {id: number; name: string; logo: string};
  score: {home: number | null; away: number | null}; regulation: ApiFootballFixture['score']['fulltime'];
  penalty: ApiFootballFixture['score']['penalty']; venue: string | null; round: string;
}
export interface FootballDetail {
  match: FootballMatch; summary: MatchSummary; players: {home: PlayerPerformance[]; away: PlayerPerformance[]};
  coaches: {home: string | null; away: string | null}; fetchedAt: string; stale: boolean; source: 'api-football';
}
export const isLiveStatus = (s: string) => ['1H','HT','2H','ET','BT','P','LIVE','INT','SUSP'].includes(s);
export function latestFootballFixtures(feeds:{fixtures:ApiFootballFixture[];fetchedAt:string|null}[]):ApiFootballFixture[] {
  const byId=new Map<number,{fixture:ApiFootballFixture;time:number}>();
  for(const feed of feeds){
    const time=Date.parse(feed.fetchedAt??'')||0;
    for(const fixture of feed.fixtures){
      if(time>=(byId.get(fixture.fixture.id)?.time??-1))byId.set(fixture.fixture.id,{fixture,time});
    }
  }
  return Array.from(byId.values(),v=>v.fixture);
}
export function footballMatch(f: ApiFootballFixture): FootballMatch {
  return {id: f.fixture.id, tournament: Object.keys(RESULT_LEAGUES).find(k=>RESULT_LEAGUES[k]===f.league.id) ?? '',
    date: f.fixture.date, status: f.fixture.status.short, minute: f.fixture.status.elapsed,
    home: f.teams.home, away: f.teams.away, score: f.goals, regulation: f.score.fulltime,
    penalty: f.score.penalty, venue: f.fixture.venue?.name ?? null, round: f.league.round};
}

const STAT_KEYS: Record<string,string> = {
  'Ball Possession':'possessionPct','Total Shots':'totalShots','Shots on Goal':'shotsOnTarget',
  'Shots off Goal':'shotsOffTarget','Blocked Shots':'blockedShots','Corner Kicks':'wonCorners',
  'Fouls':'foulsCommitted','Offsides':'offsides','Yellow Cards':'yellowCards','Red Cards':'redCards',
  'Goalkeeper Saves':'saves','Total passes':'totalPasses','Passes accurate':'accuratePasses','Passes %':'passPct',
  'expected_goals':'expectedGoals','Shots insidebox':'shotsInsideBox','Shots outsidebox':'shotsOutsideBox',
};
const statValue = (v: unknown) => typeof v === 'number' || typeof v === 'string' ? String(v) : '—';

export function footballDetail(f: DetailedFixture, fetchedAt: string): FootballDetail {
  const homeId=f.teams.home.id, awayId=f.teams.away.id;
  const side = (id?: number): TimelineEvent['side'] => id===homeId?'home':id===awayId?'away':'neutral';
  const timeline: TimelineEvent[]=(Array.isArray(f.events)?f.events:[]).map(e=>{
    const type=e.type==='subst'?'Substitution':e.type==='Var'?(e.detail?.includes('cancelled')?'Goal Disallowed':'VAR')
      :e.detail==='Normal Goal'?'Goal':e.detail==='Missed Penalty'?'Penalty - Missed'
      :e.detail==='Penalty'?'Penalty - Scored':e.detail||e.type||'';
    const isGoal=e.type==='Goal' && !/missed|cancelled|disallowed/i.test(e.detail??'');
    return {minute:e.time?.elapsed==null?'':`${e.time.elapsed}${e.time.extra?`+${e.time.extra}`:''}′`,
      type,side:side(e.team?.id),isGoal,scorer:isGoal?e.player?.name??null:null,
      assist:isGoal?e.assist?.name??null:null,player:e.player?.name??null,
      text:e.type==='subst'?[e.player?.name,e.assist?.name].filter(Boolean).join(' → '):''};
  });
  const statTeams=Array.isArray(f.statistics)?f.statistics:[];
  const homeStats=statTeams.find(t=>t.team.id===homeId)?.statistics??[];
  const awayStats=statTeams.find(t=>t.team.id===awayId)?.statistics??[];
  const keys=Array.from(new Set([...homeStats,...awayStats].map(s=>s.type)));
  const stats=keys.map(key=>({key:STAT_KEYS[key]??key,label:key,
    home:statValue(homeStats.find(s=>s.type===key)?.value),away:statValue(awayStats.find(s=>s.type===key)?.value)}));
  const players={home:[] as PlayerPerformance[],away:[] as PlayerPerformance[]};
  const coaches={home:null as string|null,away:null as string|null};
  const lineups=(Array.isArray(f.lineups)?f.lineups:[]).filter(l=>l.team.id===homeId||l.team.id===awayId).map(l=>{
    const teamSide=l.team.id===homeId?'home':'away';
    const performances=(Array.isArray(f.players)?f.players:[]).find(t=>t.team.id===l.team.id)?.players??[];
    const list: PlayerPerformance[]=[...(l.startXI??[]).map(x=>({...x,starter:true})),...(l.substitutes??[]).map(x=>({...x,starter:false}))].map(({player:p,starter})=>{
      const performance=performances.find(x=>x.player.id===p.id),s=performance?.statistics?.[0];
      return {id:p.id,name:p.name,jersey:p.number==null?null:String(p.number),pos:p.pos??null,starter,
        grid:p.grid??null,club:l.team.name,headshot:performance?.player.photo||apiFootballPlayerPhoto(p.id),
        minutes:s?.games?.minutes??null,goals:s?.goals?.total??null,assists:s?.goals?.assists??null,
        rating:s?.games?.rating && Number(s.games.rating)>0?s.games.rating:null,
        yellow:s?.cards?.yellow??null,red:s?.cards?.red??null};
    });
    players[teamSide]=list;coaches[teamSide]=l.coach?.name??null;
    return {side:teamSide as 'home'|'away',team:l.team.name,formation:l.formation??null,players:list};
  });
  return {match:footballMatch(f),summary:{timeline,stats,lineups},players,coaches,fetchedAt,
    stale:Date.now()-Date.parse(fetchedAt)>180_000 && isLiveStatus(f.fixture.status.short),source:'api-football'};
}
