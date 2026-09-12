import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';
const mocks=vi.hoisted(()=>({admin:vi.fn(),authorized:vi.fn(),extras:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/auth/admin',()=>({isCurrentUserAdmin:mocks.authorized,getAuthenticatedUser:async()=>null}));
vi.mock('@/lib/espn/knockout-extras',()=>({fetchKnockoutExtras:mocks.extras}));
import {POST} from '@/app/api/admin/discrepancies/[matchId]/route';
const fetchMock=vi.fn<typeof fetch>();
const match={id:'00000000-0000-4000-8000-000000000001',status:'finished',home_score:2,away_score:1,
 final_verified_at:null,phase:'final',tournament:'premier_2025',regulation_home_score:null,regulation_away_score:null};
const request=(source='manual')=>POST(new NextRequest('http://localhost/api/admin/discrepancies/'+match.id,
 {method:'POST',body:JSON.stringify({source,home:2,away:1})}),{params:Promise.resolve({matchId:match.id})});
beforeEach(()=>{
 vi.resetAllMocks();mocks.authorized.mockResolvedValue(true);
 mocks.admin.mockImplementation(()=>createClient('http://localhost:54321','test-key',{auth:{persistSession:false},global:{fetch:fetchMock}}));
 fetchMock.mockImplementation(async input=>new Response(JSON.stringify(String(input).includes('/rpc/')?true:match),{headers:{'content-type':'application/json'}}));
 mocks.extras.mockResolvedValue({wentToExtraTime:true,fulltime_home_score:2,fulltime_away_score:1,penalty_home:null,penalty_away:null,advancer:'home'});
});
describe('admin and automatic closure share a transaction',()=>{
 it('authorizes before reading data',async()=>{mocks.authorized.mockResolvedValue(false);expect((await request()).status).toBe(403);expect(fetchMock).not.toHaveBeenCalled();});
 it('uses only the locked RPC to write a final result',async()=>{
  expect((await request()).status).toBe(200);
  const writes=fetchMock.mock.calls.filter(c=>c[1]?.method==='POST'||c[1]?.method==='PATCH');
  expect(writes).toHaveLength(1);expect(String(writes[0][0])).toContain('/rpc/finalize_verified_match_result');
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({p_home_score:2,p_away_score:1,p_fulltime_home:null,p_advancer:null});
 });
 it('returns a conflict if another provider won the row lock',async()=>{
  fetchMock.mockImplementation(async input=>new Response(JSON.stringify(String(input).includes('/rpc/')?false:match),{headers:{'content-type':'application/json'}}));
  expect((await request()).status).toBe(409);
 });
 it('requires an explicit 90-minute score when ESPN includes extra time',async()=>{
  expect((await request('espn')).status).toBe(409);
  expect(fetchMock.mock.calls.some(c=>String(c[0]).includes('/rpc/'))).toBe(false);
 });
 it('uses the regulation snapshot instead of an ESPN extra-time total',async()=>{
  fetchMock.mockImplementation(async input=>new Response(JSON.stringify(String(input).includes('/rpc/')?true:{...match,regulation_home_score:1,regulation_away_score:1}),{headers:{'content-type':'application/json'}}));
  expect((await request('espn')).status).toBe(200);
  const call=fetchMock.mock.calls.find(c=>String(c[0]).includes('/rpc/'))!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({p_home_score:1,p_away_score:1,p_fulltime_home:2,p_fulltime_away:1});
 });
});
