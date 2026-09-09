import {describe,it,expect} from 'vitest';
import {fdPlayedScore,fdRegulationScore} from '@/lib/football-data/scores';
import {findEspnResult,espnMatchesIdentity} from '@/lib/matches/result-identity';
import type {ESPNEvent} from '@/lib/espn/client';

const match={home_team:'Manchester United FC',away_team:'Chelsea FC',scheduled_at:'2026-09-09T18:00:00Z',espn_id:'e1'};
const event=(home='Manchester United',away='Chelsea',id='e1')=>({id,date:match.scheduled_at,
 competitions:[{competitors:[{homeAway:'home',team:{displayName:home}},{homeAway:'away',team:{displayName:away}}]}]}) as ESPNEvent;

describe('provider identity is shared by live, final and manual resolution',()=>{
 it('rejects a wrong stored ESPN id and partial team tokens',()=>{
  expect(findEspnResult(match,[event('Manchester City')])).toBeNull();
  expect(espnMatchesIdentity({...match,home_team:'United'},event())).toBe(false);
 });
 it('rejects ambiguous events, swapped teams and wrong kickoff',()=>{
  expect(findEspnResult({...match,espn_id:null},[event(),event(undefined,undefined,'e2')])).toBeNull();
  expect(findEspnResult(match,[event('Chelsea','Manchester United')])).toBeNull();
  expect(findEspnResult({...match,scheduled_at:'2026-09-08T18:00:00Z'},[event()])).toBeNull();
 });
 it('accepts exact normalized clubs and established national aliases',()=>{
  expect(findEspnResult(match,[event()])?.id).toBe('e1');
  expect(findEspnResult({...match,home_team:'USA',away_team:'Korea Republic'},[event('United States of America','South Korea')])?.id).toBe('e1');
 });
});

describe('football-data period semantics',()=>{
 const score={duration:'PENALTY_SHOOTOUT',regularTime:{home:1,away:1},extraTime:{home:1,away:1},penalties:{home:4,away:3},fullTime:{home:6,away:5}};
 it('keeps the 90-minute draw separate from extra-time and shootout goals',()=>{
  expect(fdRegulationScore(score)).toEqual({home:1,away:1});
  expect(fdPlayedScore(score)).toEqual({home:2,away:2});
  expect(fdPlayedScore({...score,extraTime:undefined})).toEqual({home:2,away:2});
 });
 it('never accepts the extra-time increment alone as the played score',()=>{
  expect(fdPlayedScore({...score,duration:'EXTRA_TIME',extraTime:{home:1,away:0},fullTime:{home:2,away:1}})).toEqual({home:2,away:1});
 });
 it('does not mix partial period pairs or guess 90 minutes from a total',()=>{
  expect(fdRegulationScore({...score,regularTime:{home:1,away:null}})).toBeNull();
  expect(fdRegulationScore({...score,regularTime:undefined})).toBeNull();
  expect(fdRegulationScore({duration:'REGULAR',fullTime:{home:2,away:1}},true)).toBeNull();
  expect(fdPlayedScore({...score,extraTime:undefined,penalties:undefined})).toBeNull();
 });
});
