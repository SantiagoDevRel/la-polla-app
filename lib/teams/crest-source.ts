import catalog from './crest-catalog.json';
import overrides from './crest-overrides.json';
import {teamNameKey} from './team-name-key';
import {flagUrlForTeam} from '@/lib/flags/country-iso';

/** Reviewed identities take precedence over an incorrect historical provider URL. */
export function localCrestSource(team:string,source:string|null|undefined):string|undefined {
  const name=teamNameKey(team),reviewed=(overrides as Record<string,{source:string}>)[name];
  const bySource:Record<string,string>=catalog.bySource,byName:Record<string,string>=catalog.byName;
  return flagUrlForTeam(team)??(reviewed?bySource[reviewed.source]:undefined)??(source?bySource[source]:undefined)??byName[name];
}

/** Fixed CDN path -> same-origin image. Never accepts arbitrary proxy targets. */
export function crestFallbackSource(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  const espn = source.match(/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/(?:500|100)\/([1-9]\d{0,7})\.png$/);
  return espn ? `/api/teams/crest?espn=${espn[1]}` : source;
}
