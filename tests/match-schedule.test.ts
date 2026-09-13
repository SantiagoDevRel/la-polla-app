import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),sync:vi.fn(),discover:vi.fn(),cached:vi.fn(),saved:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:mocks.rpc,
 from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.cached})}),update:()=>({eq:mocks.saved})})})}));
vi.mock('@/lib/football-data/sync',()=>({COMPETITIONS:[{id:2014,tournament:'laliga_2025'}],syncCompetition:mocks.sync}));
vi.mock('@/lib/espn/discover',()=>({discoverTournament:mocks.discover}));
import { refreshTournamentSchedule } from '@/lib/matches/refresh-schedule';
import { formatMatchTime } from '@/lib/casa/format';

beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockResolvedValue({data:true,error:null});
 mocks.cached.mockResolvedValue({data:{value:'fresh'}});mocks.saved.mockResolvedValue({error:null});});
describe('upcoming schedules',()=>{
 it('refreshes future fixtures even when there are already stored matches',async()=>{
   mocks.sync.mockResolvedValue({errors:0,total:10,synced:10});
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(true);
   const [,slug,,from,to]=mocks.sync.mock.calls[0];
   expect(slug).toBe('laliga_2025');
   expect(Date.parse(to)-Date.parse(from)).toBe(32*86400000);
   expect(mocks.discover).not.toHaveBeenCalled();
 });
 it('shares the reservation across requests',async()=>{
   mocks.rpc.mockResolvedValue({data:false,error:null});
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(true);
   expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.discover).not.toHaveBeenCalled();
 });
 it('does not bypass a failed reservation',async()=>{
   mocks.rpc.mockResolvedValue({data:null,error:{message:'Unavailable'}});
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(false);
   expect(mocks.sync).not.toHaveBeenCalled();
 });
 it.each(['pending','failed'])('does not label a %s refresh as fresh',async value=>{
   mocks.rpc.mockResolvedValue({data:false,error:null});mocks.cached.mockResolvedValue({data:{value}});
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(false);
   expect(mocks.sync).not.toHaveBeenCalled();
 });
 it('uses ESPN if the primary calendar fails',async()=>{
   mocks.sync.mockResolvedValue({errors:1,total:0,synced:0});
   mocks.discover.mockResolvedValue({errors:0});
   expect(await refreshTournamentSchedule('laliga_2025')).toBe(true);
   expect(mocks.discover).toHaveBeenCalledWith('laliga_2025',{daysAhead:30,daysBack:1});
 });
 it('rejects unsupported tournaments before database access',async()=>{
   expect(await refreshTournamentSchedule('unknown')).toBe(false);
   expect(mocks.rpc).not.toHaveBeenCalled();
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
