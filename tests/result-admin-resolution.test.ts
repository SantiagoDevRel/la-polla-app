import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';
// /admin/discrepancias: API-Football (caché, sin cuota) o marcador manual.
// ESPN y football-data dejaron de ser fuentes el 2026-09-13.
const mocks=vi.hoisted(()=>({admin:vi.fn(),authorized:vi.fn(),cached:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/auth/admin',()=>({isCurrentUserAdmin:mocks.authorized,getAuthenticatedUser:async()=>null}));
vi.mock('@/lib/matches/af-cached-result',()=>({cachedApiFootballResult:mocks.cached}));
import {POST} from '@/app/api/admin/discrepancies/[matchId]/route';
const fetchMock=vi.fn<typeof fetch>();
const match={id:'00000000-0000-4000-8000-000000000001',status:'finished',home_score:2,away_score:1,
 final_verified_at:null,phase:'final',tournament:'premier_2025',home_team:'Arsenal',away_team:'Chelsea',
 scheduled_at:'2026-09-09T18:00:00Z',external_id:'apifootball:9001',source_external_ids:[]};
const fixture=(short='FT',over:Record<string,unknown>={})=>({fixture:{id:9001,date:match.scheduled_at,venue:null,status:{short,long:'',elapsed:90}},
 league:{id:39,name:'Premier League',round:'Final'},teams:{home:{id:1,name:'Arsenal',logo:''},away:{id:2,name:'Chelsea',logo:''}},
 goals:{home:2,away:1},score:{fulltime:{home:2,away:1},extratime:{home:null,away:null},penalty:{home:null,away:null}},...over});
const request=(body:object={source:'manual',home:2,away:1})=>POST(new NextRequest('http://localhost/api/admin/discrepancies/'+match.id,
 {method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({matchId:match.id})});
const rpcBody=()=>JSON.parse(String(fetchMock.mock.calls.find(c=>String(c[0]).includes('/rpc/'))![1]?.body));
beforeEach(()=>{
 vi.resetAllMocks();mocks.authorized.mockResolvedValue(true);
 mocks.admin.mockImplementation(()=>createClient('http://localhost:54321','test-key',{auth:{persistSession:false},global:{fetch:fetchMock}}));
 fetchMock.mockImplementation(async input=>new Response(JSON.stringify(String(input).includes('/rpc/')?true:match),{headers:{'content-type':'application/json'}}));
 mocks.cached.mockResolvedValue({fixture:fixture(),fetchedAt:'2026-09-09T20:00:00Z'});
});
describe('admin and automatic closure share a transaction',()=>{
 it('authorizes before reading data',async()=>{mocks.authorized.mockResolvedValue(false);expect((await request()).status).toBe(403);expect(fetchMock).not.toHaveBeenCalled();});
 it('uses only the locked RPC to write a manual result',async()=>{
  expect((await request()).status).toBe(200);
  const writes=fetchMock.mock.calls.filter(c=>c[1]?.method==='POST'||c[1]?.method==='PATCH');
  expect(writes).toHaveLength(1);expect(String(writes[0][0])).toContain('/rpc/finalize_verified_match_result');
  expect(rpcBody()).toMatchObject({p_home_score:2,p_away_score:1,p_fulltime_home:null,p_advancer:null});
  expect(mocks.cached).not.toHaveBeenCalled();
 });
 it('returns a conflict if another process won the row lock',async()=>{
  fetchMock.mockImplementation(async input=>new Response(JSON.stringify(String(input).includes('/rpc/')?false:match),{headers:{'content-type':'application/json'}}));
  expect((await request()).status).toBe(409);
 });
 it.each(['espn','fd'])('rejects the retired %s source with 400 before reading the match',async source=>{
  expect((await request({source,home:2,away:1})).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it('api-football: scores the cached 90-minute result, never numbers from the client',async()=>{
  expect((await request({source:'api-football',home:9,away:9})).status).toBe(200);
  expect(rpcBody()).toMatchObject({p_home_score:2,p_away_score:1,p_fulltime_home:2,p_fulltime_away:1,p_advancer:null});
  expect(mocks.cached).toHaveBeenCalledWith(expect.objectContaining({id:match.id,external_id:'apifootball:9001'}));
 });
 it('api-football AET/PEN: 90-minute draw, full score and shootout advancer in one call',async()=>{
  mocks.cached.mockResolvedValue({fixture:fixture('PEN',{goals:{home:1,away:1},score:{fulltime:{home:1,away:1},extratime:{home:0,away:0},penalty:{home:3,away:4}}}),fetchedAt:'2026-09-09T20:00:00Z'});
  expect((await request({source:'api-football'})).status).toBe(200);
  expect(rpcBody()).toMatchObject({p_home_score:1,p_away_score:1,p_fulltime_home:1,p_fulltime_away:1,p_penalty_home:3,p_penalty_away:4,p_advancer:'away'});
 });
 it('api-football without a usable cached final asks for the manual score',async()=>{
  mocks.cached.mockResolvedValue({fixture:fixture('2H'),fetchedAt:'2026-09-09T19:00:00Z'});
  expect((await request({source:'api-football'})).status).toBe(409);
  mocks.cached.mockResolvedValue(null);
  expect((await request({source:'api-football'})).status).toBe(409);
  expect(fetchMock.mock.calls.some(c=>String(c[0]).includes('/rpc/'))).toBe(false);
 });
});
