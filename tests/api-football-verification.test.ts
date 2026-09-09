import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({admin:vi.fn(), matches:vi.fn(), daily:vi.fn(), fd:vi.fn(), espn:vi.fn(), alert:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/matches/en-juego',()=>({matchesEnJuego:mocks.matches}));
vi.mock('@/lib/api-football/daily-results',()=>({loadDailyResults:mocks.daily,apiFootballFinalsEnabled:()=>true}));
vi.mock('@/lib/football-data/client',()=>({fetchCompetitionMatches:mocks.fd}));
vi.mock('@/lib/football-data/sync',()=>({COMPETITIONS:[{tournament:'premier_2025',id:2021}]}));
vi.mock('@/lib/notifications/admin-alert',()=>({notifyAdmin:mocks.alert}));
vi.mock('@/lib/espn/client',()=>({ESPN_LEAGUE_BY_TOURNAMENT:{premier_2025:'eng.1'},ESPN_ONLY_TOURNAMENTS:new Set(),
  fetchEspnScoreboard:mocks.espn,mapEspnStatus:()=> 'finished',parseEspnScore:(x:unknown)=>x === undefined ? null : Number(x)}));
import {verifyPendingFinals} from '@/lib/matches/verify-final';

const fetchMock = vi.fn<typeof fetch>();
const candidate = {id:'00000000-0000-4000-8000-000000000001',external_id:'unrelated',espn_id:null,
  tournament:'premier_2025',phase:'regular_season',home_team:'Arsenal',away_team:'Chelsea',
  home_score:2,away_score:1,status:'finished',scheduled_at:'2026-09-09T18:00:00Z',final_verified_at:null,
  final_verification_notes:null as string|null,live_status_detail:null,regulation_home_score:null,regulation_away_score:null};
const makeFixture = (status='FT') => ({fixture:{id:9001,date:candidate.scheduled_at,status:{short:status}},league:{id:39},
  teams:{home:{name:'Arsenal'},away:{name:'Chelsea'}},goals:{home:2,away:1},
  score:{fulltime:{home:2,away:1},penalty:{home:null,away:null}}});
const fd = {status:'FINISHED',utcDate:candidate.scheduled_at,homeTeam:{name:'Arsenal FC'},awayTeam:{name:'Chelsea FC'},
  score:{duration:'REGULAR',fullTime:{home:2,away:1}}};

beforeEach(()=>{
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T20:30:00Z'));
  mocks.admin.mockImplementation(()=>createClient('http://localhost:54321','test-key',{auth:{persistSession:false},global:{fetch:fetchMock}}));
  mocks.matches.mockResolvedValue({filas:[{...candidate}],errores:[]});
  mocks.daily.mockResolvedValue(new Map([['2026-09-09',{fixtures:[makeFixture()],fetchedAt:'2026-09-09T20:20:00Z'}]]));
  mocks.fd.mockResolvedValue([fd]); mocks.espn.mockResolvedValue([]);
  fetchMock.mockImplementation(async(input)=>new Response(String(input).includes('/rpc/')?'true':'', {status:200}));
});
afterEach(()=>vi.useRealTimers());
const finalCalls=()=>fetchMock.mock.calls.filter(c=>String(c[0]).includes('/rpc/finalize_api_football_result'));

describe('API-Football within the existing scoring chain',()=>{
  it('corroborates and finalizes via the atomic RPC, without writing predictions',async()=>{
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(finalCalls()).toHaveLength(1);
    expect(JSON.parse(String(finalCalls()[0][1]?.body))).toMatchObject({p_home_score:2,p_away_score:1});
    expect(fetchMock.mock.calls.some(c=>String(c[0]).includes('/predictions'))).toBe(false);
  });
  it('can recover a final even when the existing live status is stale',async()=>{
    mocks.matches.mockResolvedValue({filas:[{...candidate,status:'scheduled'}],errores:[]});
    expect((await verifyPendingFinals())[0].status).toBe('verified');
  });
  it('does not pass unfinished rows into legacy verification when the API fails',async()=>{
    mocks.matches.mockResolvedValue({filas:[{...candidate,status:'live'}],errores:[]}); mocks.daily.mockResolvedValue(new Map());
    expect(await verifyPendingFinals()).toEqual([]); expect(finalCalls()).toHaveLength(0);
  });
  it('blocks disagreement with another provider',async()=>{
    mocks.fd.mockResolvedValue([{...fd,score:{duration:'REGULAR',fullTime:{home:1,away:1}}}]);
    expect((await verifyPendingFinals())[0].status).toBe('discrepancy');
    expect(finalCalls()).toHaveLength(0); expect(mocks.alert).toHaveBeenCalledOnce();
  });
  it('requires another fetch when there is no corroborator',async()=>{
    mocks.fd.mockResolvedValue([]);
    expect((await verifyPendingFinals())[0].status).toBe('pending'); expect(finalCalls()).toHaveLength(0);
    mocks.matches.mockResolvedValue({filas:[{...candidate,final_verification_notes:'pending afseen=9001:2-1@2026-09-09T20:00:00Z'}],errores:[]});
    expect((await verifyPendingFinals())[0].status).toBe('verified');
  });
  it('stores 90 minute draw plus extra-time score atomically',async()=>{
    const f=makeFixture('AET'); f.score.fulltime={home:1,away:1};
    mocks.daily.mockResolvedValue(new Map([['2026-09-09',{fixtures:[f],fetchedAt:'2026-09-09T20:20:00Z'}]]));
    mocks.matches.mockResolvedValue({filas:[{...candidate,phase:'final',final_verification_notes:' afseen=9001:1-1@2026-09-09T20:00:00Z'}],errores:[]});
    mocks.fd.mockResolvedValue([]);
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(JSON.parse(String(finalCalls()[0][1]?.body))).toMatchObject({p_home_score:1,p_away_score:1,p_fulltime_home:2,p_fulltime_away:1});
  });
  it('reports a failed RPC instead of claiming success',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({message:'test failure'}),{status:500}));
    expect((await verifyPendingFinals())[0].status).toBe('error');
  });
  it('preserves legacy verification when no API-Football result exists',async()=>{
    mocks.daily.mockResolvedValue(new Map());
    expect((await verifyPendingFinals())[0].status).toBe('verified');
    expect(finalCalls()).toHaveLength(0);
    expect(fetchMock.mock.calls.some(c=>String(c[0]).includes('/rpc/finalize_match_result'))).toBe(true);
  });
});
