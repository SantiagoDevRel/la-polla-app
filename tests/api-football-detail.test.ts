import {describe,it,expect} from 'vitest';
import {footballDetail,latestFootballFixtures,type DetailedFixture} from '@/lib/api-football/detail-model';

const fixture=():DetailedFixture=>({fixture:{id:123,date:'2026-09-09T19:00:00Z',venue:null,status:{short:'PEN',long:'After penalties',elapsed:120}},
 league:{id:2,name:'Champions',round:'Final'},teams:{home:{id:1,name:'Home',logo:''},away:{id:2,name:'Away',logo:''}},
 goals:{home:2,away:2},score:{fulltime:{home:1,away:1},extratime:{home:2,away:2},penalty:{home:4,away:3}}});

describe('football detail semantics',()=>{
 it('never lets an older club calendar replace a newer live score',()=>{
  const fresh=fixture(),old=fixture();old.goals={home:0,away:0};
  const merged=latestFootballFixtures([{fixtures:[fresh],fetchedAt:'2026-09-09T20:00:00Z'},{fixtures:[old],fetchedAt:'2026-09-09T19:00:00Z'}]);
  expect(merged).toHaveLength(1);expect(merged[0].goals).toEqual({home:2,away:2});
 });
 it('keeps played score, regulation and shootout separate',()=>{
  const d=footballDetail(fixture(),new Date().toISOString());
  expect(d.match.score).toEqual({home:2,away:2});expect(d.match.regulation).toEqual({home:1,away:1});expect(d.match.penalty).toEqual({home:4,away:3});
 });
 it('does not turn an unavailable stat into zero and matches sides by team ID',()=>{
  const f=fixture();f.statistics=[{team:{id:2},statistics:[{type:'Total Shots',value:0}]},{team:{id:1},statistics:[{type:'Total Shots',value:null}]}];
  expect(footballDetail(f,'').summary.stats[0]).toMatchObject({key:'totalShots',home:'—',away:'0'});
 });
 it('distinguishes actual goals, missed penalties and VAR annulments',()=>{
  const f=fixture();f.events=[{type:'Goal',detail:'Normal Goal',team:{id:1},time:{elapsed:90,extra:5},player:{name:'Striker'}},
   {type:'Goal',detail:'Missed Penalty',team:{id:2}},{type:'Var',detail:'Goal cancelled',team:{id:1}}];
  const e=footballDetail(f,'').summary.timeline;
  expect(e.map(x=>x.isGoal)).toEqual([true,false,false]);expect(e[0].minute).toBe('90+5′');expect(e[2].type).toBe('Goal Disallowed');
 });
 it('uses startXI as lineup authority even if player stats disagree, preserving photos and bench',()=>{
  const f=fixture();f.lineups=[{team:{id:1,name:'Home'},formation:'4-3-3',startXI:[{player:{id:7,name:'Starter',number:9,pos:'F'}}],substitutes:[{player:{id:8,name:'Bench',number:12}}]}];
  f.players=[{team:{id:1},players:[{player:{id:7,photo:'photo.png'},statistics:[{games:{minutes:80,rating:'7.1'},goals:{total:1,assists:0}}]}]}];
  const p=footballDetail(f,'').players.home;
  expect(p[0]).toMatchObject({starter:true,headshot:'photo.png',jersey:'9',goals:1,minutes:80});expect(p[1]).toMatchObject({starter:false,headshot:null,minutes:null});
 });
 it('handles an upcoming fixture with no lineup or stats without inventing players',()=>{
  const d=footballDetail(fixture(),'');expect(d.summary.lineups).toEqual([]);expect(d.players.home).toEqual([]);
 });
});
