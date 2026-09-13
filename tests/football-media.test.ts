import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import catalog from '@/lib/teams/crest-catalog.json';
import coverage from '@/lib/teams/crest-coverage.json';
import logos from '@/lib/teams/league-logos.json';
import {RESULT_LEAGUES} from '@/lib/api-football/leagues';
import {TOURNAMENTS,getTournamentLogo} from '@/lib/tournaments';
import {teamNameKey} from '@/lib/teams/team-name-key';
import {flagUrlForTeam} from '@/lib/flags/country-iso';
import {localCrestSource} from '@/lib/teams/crest-source';

const sources:Record<string,string>=catalog.bySource,names:Record<string,string>=catalog.byName;
const sharp=createRequire(createRequire(import.meta.url).resolve('next/package.json'))('sharp') as (input:Uint8Array)=>{
 metadata():Promise<{width?:number;height?:number}>;
 flatten(options:{background:string}):{stats():Promise<{channels:{stdev:number}[]}>};
};
describe('complete football media catalog',()=>{
 it('corrects a mismatched historical URL without giving Espanyol the Brugge crest',()=>{
  const source='https://a.espncdn.com/i/teamlogos/soccer/500/570.png';
  expect(localCrestSource('Club Brugge',source)).toBe(sources['https://media.api-sports.io/football/teams/569.png']);
  expect(localCrestSource('Espanyol',source)).toBe(sources[source]);
  expect(localCrestSource('Deportivo Recoleta','https://media.api-sports.io/football/teams/10476.png')).toBe(sources['https://a.espncdn.com/i/teamlogos/soccer/500/22517.png']);
 });
 it('covers every configured competition and every current provider team with local artwork',()=>{
  expect(Object.keys(logos).sort()).toEqual(Object.keys(RESULT_LEAGUES).sort());
  expect(coverage.leagues.map(l=>l.slug).sort()).toEqual(Object.keys(RESULT_LEAGUES).sort());
  const byId=new Map<number,string>();
  for(const league of coverage.leagues){
   expect(league.teams.length).toBeGreaterThan(0);
   for(const team of league.teams){expect(sources[team.source]).toMatch(/^\/team-crests\/[a-z0-9-]+\.(webp|png|svg)$/);byId.set(team.id,sources[team.source]);}
  }
  // A generic placeholder reused for two different clubs is not coverage.
  expect(new Set(byId.values()).size).toBe(byId.size);
 });
 it('covers all observed club and national-team names, including fixtures with no provider URL',()=>{
  for(const team of coverage.observedTeams){
   expect(flagUrlForTeam(team.name)??names[teamNameKey(team.name)],team.name).toMatch(/^\/(team-crests|flags)\//);
   if(team.source&&!flagUrlForTeam(team.name))expect(sources[team.source],team.name).toBeTruthy();
  }
 });
 it('ships decodable, visible images for every catalog reference and tournament size',async()=>{
  const assets=new Set([...Object.values(sources),...Object.values(names),...Object.values(logos),...TOURNAMENTS.flatMap(t=>[getTournamentLogo(t.slug,'small'),getTournamentLogo(t.slug)])]);
  await Promise.all([...assets].map(async asset=>{
   expect(asset).toMatch(/^\/(team-crests|flags|tournaments)\//);
   const image=await fs.readFile(path.join(process.cwd(),'public',asset.split('?')[0]));
   const metadata=await sharp(image).metadata();expect(metadata.width,asset).toBeGreaterThan(0);expect(metadata.height,asset).toBeGreaterThan(0);
   const stats=await sharp(image).flatten({background:'#f5f7fa'}).stats();expect(stats.channels.some(c=>c.stdev>=3),`Blank image: ${asset}`).toBe(true);
  }));
 },30000);
});
