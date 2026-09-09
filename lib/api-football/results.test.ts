import {describe, it, expect} from 'vitest';
import {confirmedObservation, findResultFixture, readFinalResult, RESULT_LEAGUES} from './results';
import type {ApiFootballFixture} from './mappers';

export function fixture(status = 'FT'): ApiFootballFixture {
  return {fixture: {id: 9001, date: '2026-09-09T18:00:00Z', venue: null, status: {short: status, long: '', elapsed: 90}},
    league: {id: 39, name: 'Premier League', round: 'Regular Season - 1'},
    teams: {home: {id: 1, name: 'Arsenal', logo: ''}, away: {id: 2, name: 'Chelsea', logo: ''}},
    goals: {home: 2, away: 1}, score: {fulltime: {home: 2, away: 1}, extratime: {home: null, away: null}, penalty: {home: null, away: null}}};
}

describe('final scores and identity', () => {
  it('supports the nine requested competitions', () => expect(Object.values(RESULT_LEAGUES).sort((a,b)=>a-b)).toEqual([2,11,13,39,61,78,135,140,239]));
  it.each([[2,1,'1'],[0,0,'X'],[1,3,'2']])('derives 1X2 from %s-%s', (home,away,outcome) => {
    const f = fixture(); f.score.fulltime = {home: Number(home), away: Number(away)};
    f.goals = {...f.score.fulltime};
    expect(readFinalResult(f)?.outcome).toBe(outcome);
  });
  it('preserves 90 minute draw when extra time or shootout has a winner', () => {
    const f = fixture('PEN'); f.score.fulltime = {home:1, away:1}; f.goals = {home:2, away:2}; f.score.penalty = {home:4, away:3};
    expect(readFinalResult(f)).toMatchObject({home:1,away:1,outcome:'X',fulltime:{home:2,away:2},penalty:{home:4,away:3}});
    f.score.fulltime.home = null;
    expect(readFinalResult(f)).toBeNull();
  });
  it.each(['NS','2H','ET','P','PST','CANC','ABD','AWD','WO'])('does not settle %s', status => expect(readFinalResult(fixture(status))).toBeNull());
  it('rejects incomplete, negative and nonnumeric results', () => {
    for (const home of [null,undefined,-1,1.2,'2',NaN]) {
      const f = fixture(); f.score.fulltime.home = home as number;
      expect(readFinalResult(f)).toBeNull();
    }
  });
  it('requires both teams, tournament, time and a unique candidate', () => {
    const f = fixture(); const m = {tournament:'premier_2025',home_team:'Arsenal FC',away_team:'Chelsea FC',scheduled_at:f.fixture.date};
    expect(findResultFixture(m,[f])?.fixture.id).toBe(9001);
    expect(findResultFixture(m,[f,f])).toBeNull();
    expect(findResultFixture({...m,home_team:'Manchester City'},[f])).toBeNull();
    expect(findResultFixture({...m,tournament:'laliga_2025'},[f])).toBeNull();
    expect(findResultFixture({...m,scheduled_at:'2026-09-08T18:00:00Z'},[f])).toBeNull();
    expect(findResultFixture({...m,home_team:'Chelsea',away_team:'Arsenal'},[f])).toBeNull();
  });
  it('requires a new provider fetch, not two reads of a cached snapshot', () => {
    const note = 'pending afseen=9001:2-1@2026-09-09T20:00:00Z';
    expect(confirmedObservation(note,9001,2,1,'2026-09-09T20:00:00Z')).toBe(false);
    expect(confirmedObservation(note,9001,2,1,'2026-09-09T20:20:00Z')).toBe(true);
    expect(confirmedObservation(note,9001,3,1,'2026-09-09T20:20:00Z')).toBe(false);
    expect(confirmedObservation(note,9002,2,1,'2026-09-09T20:20:00Z')).toBe(false);
  });
});
