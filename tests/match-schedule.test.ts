import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),cached:vi.fn(),saved:vi.fn(),af:vi.fn(),deps:vi.fn(),attempts:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:mocks.rpc,
 from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.cached}),in:mocks.attempts}),update:()=>({eq:mocks.saved})})})}));
vi.mock('@/lib/api-football/calendar',()=>({refreshAfTournament:mocks.af,createCalendarDeps:mocks.deps}));
import { refreshAfSchedules, refreshTournamentSchedule, refreshTournamentScheduleDetailed } from '@/lib/matches/refresh-schedule';
import { SYNCABLE_TOURNAMENT_SLUGS } from '@/lib/tournaments';
import { formatMatchTime } from '@/lib/casa/format';

const afResult=(extra:object={})=>({tournament:'laliga_2025',leagueId:140,season:2026,fetched:380,inserted:3,updated:1,linked:0,
 unchanged:300,skipped:{before_window:76},errors:0,aborted:null,truncated:false,sample:[],...extra});
beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockResolvedValue({data:true,error:null});
 mocks.cached.mockResolvedValue({data:{value:'fresh'}});mocks.saved.mockResolvedValue({error:null});
 mocks.deps.mockResolvedValue({});mocks.af.mockResolvedValue(afResult());
 mocks.attempts.mockResolvedValue({data:[]});});
describe('API-Football calendar refresh',()=>{
 it('refreshes the season from API-Football, behind the shared reservation',async()=>{
   const r=await refreshTournamentScheduleDetailed('laliga_2025');
   expect(r).toMatchObject({refreshed:true,state:'fresh',af:{inserted:3,updated:1,unchanged:300}});
   expect(mocks.rpc).toHaveBeenCalledWith('reserve_tournament_schedule_sync',{p_tournament:'laliga_2025'});
   expect(mocks.af).toHaveBeenCalledWith('laliga_2025',expect.objectContaining({mode:'apply'}),{});
   expect(mocks.saved).toHaveBeenCalledWith('key','schedule_laliga_2025');
 });
 it('shares the reservation across requests without spending a request',async()=>{
   mocks.rpc.mockResolvedValue({data:false,error:null});
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(true);
   expect(mocks.af).not.toHaveBeenCalled();
 });
 it('does not bypass a failed reservation',async()=>{
   mocks.rpc.mockResolvedValue({data:null,error:{message:'Unavailable'}});
   expect(await refreshTournamentScheduleDetailed('laliga_2025')).toEqual({tournament:'laliga_2025',refreshed:false,state:'reservation_error'});
   expect(mocks.af).not.toHaveBeenCalled();
 });
 it.each(['pending','failed'])('does not label a %s refresh as fresh',async value=>{
   mocks.rpc.mockResolvedValue({data:false,error:null});mocks.cached.mockResolvedValue({data:{value}});
   expect(await refreshTournamentScheduleDetailed('laliga_2025')).toEqual({tournament:'laliga_2025',refreshed:false,state:'pending'});
   expect(mocks.af).not.toHaveBeenCalled();
 });
 it.each([[{aborted:'paged'}],[{errors:2}],[{truncated:true}]])('does not label %o as fresh',async extra=>{
   mocks.af.mockResolvedValue(afResult(extra));
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(false);
   expect(mocks.saved).toHaveBeenCalledWith('key','schedule_laliga_2025');
 });
 it('rejects unsupported tournaments before database access',async()=>{
   expect(await refreshTournamentSchedule('unknown')).toBe(false);
   expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.af).not.toHaveBeenCalled();
 });
 it('walks leagues oldest attempt first and starts none after the budget',async()=>{
   let clock=0;
   mocks.attempts.mockResolvedValue({data:[
     {key:'schedule_premier_2025',updated_at:'2026-09-13T10:00:00Z'},
     {key:'schedule_laliga_2025',updated_at:'2026-09-13T06:00:00Z'},
   ]});
   mocks.af.mockImplementation(async(t:string)=>{clock+=15_000;return afResult({tournament:t});});
   const results=await refreshAfSchedules({now:()=>clock});
   const started=results.filter(r=>r.state!=='not_started').map(r=>r.tournament);
   expect(results).toHaveLength(SYNCABLE_TOURNAMENT_SLUGS.length);
   // Nunca intentadas primero (en el orden de la lista), después la más vieja.
   const neverTried=SYNCABLE_TOURNAMENT_SLUGS.filter(s=>!['premier_2025','laliga_2025'].includes(s));
   expect(started).toEqual(neverTried.slice(0,3));
   expect(results.at(-1)?.tournament).toBe('premier_2025');
   expect(results.at(-2)?.tournament).toBe('laliga_2025');
   expect(mocks.af).toHaveBeenCalledTimes(3);
   expect(mocks.deps).toHaveBeenCalledOnce();
   for(const call of mocks.af.mock.calls)expect(call[1].deadlineMs).toBe(50_000);
 });
});
describe('Colombian kickoff display',()=>{
 it('renders the confirmed Wednesday fixtures in Colombia',()=>{
   expect(formatMatchTime('2026-09-16T19:30:00Z')).toMatch(/mié.*16.*sept.*2:30/);
   expect(formatMatchTime('2026-09-16T17:00:00Z')).toMatch(/mié.*16.*sept.*12:00/);
 });
 it('keeps a provisional Wednesday as Wednesday without inventing a time',()=>{
   expect(formatMatchTime('2026-09-16T00:00:00Z',false)).toMatch(/mié.*16.*sept.*hora por confirmar/);
   expect(formatMatchTime('2026-09-16T00:00:00Z',false)).not.toContain('7:00');
 });
 it('still converts a confirmed UTC-midnight kickoff to the previous Colombian evening',()=>{
   expect(formatMatchTime('2026-09-16T00:00:00Z',true)).toMatch(/mar.*15.*sept.*7:00/);
 });
});
