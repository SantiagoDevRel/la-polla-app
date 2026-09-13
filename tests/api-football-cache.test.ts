import {beforeEach, afterEach, it, expect, vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
const mocks = vi.hoisted(()=>({admin:vi.fn(), get:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/api-football/account',()=>({apiFootballProActive:async()=>false}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/api-football/client',()=>({apiFootballGet:mocks.get}));
import {loadDailyResults} from '@/lib/api-football/daily-results';
const dbFetch=vi.fn<typeof fetch>();
const matches=[{tournament:'premier_2025',home_team:'Arsenal',away_team:'Chelsea',scheduled_at:'2026-09-09T18:00:00Z'}];
beforeEach(()=>{
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T20:30:00Z'));
  vi.stubEnv('API_FOOTBALL_KEY','test-only'); vi.stubEnv('API_FOOTBALL_FINALS_ENABLED','true');
  mocks.admin.mockImplementation(()=>createClient('http://localhost:54321','test-key',{auth:{persistSession:false},global:{fetch:dbFetch}}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it('fetches one daily feed for multiple matches and leagues after a shared reservation',async()=>{
  dbFetch.mockResolvedValueOnce(new Response('true')).mockResolvedValueOnce(new Response(''));
  mocks.get.mockResolvedValue([]);
  expect((await loadDailyResults([...matches,{...matches[0],tournament:'betplay_2026'}])).size).toBe(1);
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/fixtures',{date:'2026-09-09'},{attempts:1,direct:true});
});
it('serves the cache without a billed request when another worker reserved the date',async()=>{
  dbFetch.mockResolvedValueOnce(new Response('false')).mockResolvedValueOnce(new Response(JSON.stringify({fixtures:[],fetched_at:'2026-09-09T20:20:00Z'})));
  expect((await loadDailyResults(matches)).size).toBe(1); expect(mocks.get).not.toHaveBeenCalled();
});
it('does not bypass the quota when reservation fails',async()=>{
  dbFetch.mockResolvedValue(new Response(JSON.stringify({message:'not available'}),{status:403}));
  expect((await loadDailyResults(matches)).size).toBe(0); expect(mocks.get).not.toHaveBeenCalled();
});
it('does not fetch historical seasons or future fixtures',async()=>{
  expect((await loadDailyResults([{...matches[0],scheduled_at:'2024-09-09T18:00:00Z'}])).size).toBe(0);
  expect(dbFetch).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
});
it('falls back on API errors and rejects stale caches',async()=>{
  dbFetch.mockResolvedValueOnce(new Response('true')); mocks.get.mockRejectedValue(new Error('provider unavailable'));
  expect((await loadDailyResults(matches)).size).toBe(0); expect(mocks.get).toHaveBeenCalledOnce();
  dbFetch.mockResolvedValueOnce(new Response('false')).mockResolvedValueOnce(new Response(JSON.stringify({fixtures:[],fetched_at:'2026-09-09T18:00:00Z'})));
  expect((await loadDailyResults(matches)).size).toBe(0);
});
it('does nothing when disabled',async()=>{
  vi.stubEnv('API_FOOTBALL_FINALS_ENABLED','false');
  expect((await loadDailyResults(matches)).size).toBe(0); expect(dbFetch).not.toHaveBeenCalled();
});
