import {describe,it,expect} from 'vitest';
import coverage from '@/lib/teams/crest-coverage.json';
import {RESULT_LEAGUES} from '@/lib/api-football/leagues';
import {TOURNAMENTS} from '@/lib/tournaments';
import {buildTeamCatalog,searchTeams,type CatalogTeam} from '@/lib/teams/team-search';

const league=(slug:string,teams:[number,string][])=>({slug,teams:teams.map(([id,name])=>({id,name,source:`https://media.api-sports.io/football/teams/${id}.png`}))});
const catalog=buildTeamCatalog({leagues:[
 league('betplay_2026',[[1137,'Atletico Nacional'],[1125,'Millonarios'],[1128,'Águilas Doradas'],[9001,'Club Zeta']]),
 league('sudamericana_2026',[[1137,'Atletico Nacional'],[1125,'Millonarios'],[9002,'Ábaco Club'],[9003,'Avenida Club']]),
 league('laliga_2025',[[530,'Atletico Madrid'],[541,'Real Madrid'],[543,'Real Betis'],[548,'Real Sociedad'],[9004,'Nacional Madrid']]),
]});
const names=(teams:CatalogTeam[])=>teams.map(team=>team.name);

describe('football team search',()=>{
 it('keeps one entry per team id and merges the tournaments it plays',()=>{
  expect(catalog).toHaveLength(11);
  expect(catalog.filter(team=>team.id===1137)).toEqual([{id:1137,name:'Atletico Nacional',logo:'https://media.api-sports.io/football/teams/1137.png',tournaments:['betplay_2026','sudamericana_2026']}]);
  expect(catalog.find(team=>team.id===530)?.tournaments).toEqual(['laliga_2025']);
 });

 it('ignores accents and letter case in the query and in the catalog names',()=>{
  expect(names(searchTeams(catalog,'atletico','all',6).results)).toContain('Atletico Nacional');
  expect(names(searchTeams(catalog,'ATLÉTICO','all',6).results)).toContain('Atletico Nacional');
  expect(names(searchTeams(catalog,'  aguilas ','all',6).results)).toEqual(['Águilas Doradas']);
 });

 it('restricts results to the selected tournament unless it is all',()=>{
  expect(names(searchTeams(catalog,'atletico','all',6).results)).toEqual(['Atletico Madrid','Atletico Nacional']);
  expect(names(searchTeams(catalog,'atletico','laliga_2025',6).results)).toEqual(['Atletico Madrid']);
  expect(names(searchTeams(catalog,'atletico','sudamericana_2026',6).results)).toEqual(['Atletico Nacional']);
  expect(searchTeams(catalog,'real','betplay_2026',6)).toEqual({results:[],total:0});
 });

 it('lists names that start with the query first, then in Spanish alphabetical order',()=>{
  expect(names(searchTeams(catalog,'nacional','all',6).results)).toEqual(['Nacional Madrid','Atletico Nacional']);
  // Code-unit order would put «Avenida» before «Ábaco»; Spanish collation does not.
  expect(names(searchTeams(catalog,'club','all',6).results)).toEqual(['Club Zeta','Ábaco Club','Avenida Club']);
 });

 it('returns at most the limit and reports how many teams matched',()=>{
  const madrid=searchTeams(catalog,'madrid','all',2);
  expect(madrid.total).toBe(3);
  expect(names(madrid.results)).toEqual(['Atletico Madrid','Nacional Madrid']);
  expect(searchTeams(catalog,'a','all',6)).toEqual({results:[],total:0});
  expect(searchTeams(catalog,'re','all',0)).toEqual({results:[],total:3});
 });

 it('does not search with fewer than two characters',()=>{
  for(const query of ['','   ','m',' r ','É'])expect(searchTeams(catalog,query,'all',6)).toEqual({results:[],total:0});
  expect(searchTeams(catalog,'mi','all',6).total).toBe(1);
 });

 it('covers every competition in the Torneos select with the real coverage catalog',()=>{
  const real=buildTeamCatalog(coverage);
  const select=TOURNAMENTS.filter(t=>RESULT_LEAGUES[t.slug]).map(t=>t.slug);
  expect(coverage.leagues.map(l=>l.slug).sort()).toEqual([...select].sort());
  for(const slug of select)expect(real.some(team=>team.tournaments.includes(slug)),slug).toBe(true);
  expect(new Set(real.map(team=>team.id)).size).toBe(real.length);
  expect([...searchTeams(real,'ATLÉTICO NACIONAL','all',6).results.find(team=>team.name==='Atletico Nacional')?.tournaments??[]].sort()).toEqual(['betplay_2026','sudamericana_2026']);
 });
});
