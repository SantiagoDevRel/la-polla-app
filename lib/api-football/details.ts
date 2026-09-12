import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiFootballProActive } from './account';
import { apiFootballGet } from './client';
import { knownFootballObservation } from './feed';
import { isValidFixture } from './mappers';
import { footballDetail, footballMatch, type DetailedFixture } from './detail-model';
import { findResultFixture } from './results';

export async function loadFootballDetail(id: number) {
  if (!Number.isSafeInteger(id) || id<=0) return null;
  const observation = await knownFootballObservation(id);
  if (!observation) return null;
  const seed=observation.fixture;
  const admin=createAdminClient();
  if (await apiFootballProActive()) {
    const {data: reserved}=await admin.rpc('reserve_api_football_detail',{p_fixture_id:id});
    if (reserved===true) {
      try {
        const raw=await apiFootballGet<unknown>('/fixtures',{ids:String(id)},{attempts:1,direct:true});
        const f=raw.filter(isValidFixture).find(x=>x.fixture.id===id) as DetailedFixture|undefined;
        // A fixture ID never bypasses semantic identity (league, ordered teams, kickoff).
        if (f && findResultFixture({tournament:footballMatch(seed).tournament,
          home_team:seed.teams.home.name,away_team:seed.teams.away.name,scheduled_at:seed.fixture.date},[f])) {
          const fetchedAt=new Date().toISOString();
          const {error}=await admin.from('api_football_details').update({fixture:f,fetched_at:fetchedAt}).eq('fixture_id',id);
          if (!error) return footballDetail(f,fetchedAt);
        }
      } catch { /* Failed calls still count; don't replace good cached data with empty content. */ }
    }
  }
  const {data}=await admin.from('api_football_details').select('fixture,fetched_at').eq('fixture_id',id).maybeSingle();
  if(!data?.fetched_at || !isValidFixture(data.fixture))return null;
  const detail=footballDetail(data.fixture,data.fetched_at);
  if(Date.parse(observation.fetchedAt)>Date.parse(data.fetched_at))detail.match=footballMatch(seed);
  return detail;
}
