import catalog from './crest-catalog.json';
import overrides from './crest-overrides.json';
import {teamNameKey} from './team-name-key';
import {flagUrlForTeam} from '@/lib/flags/country-iso';

/** Reviewed identities take precedence over an incorrect historical provider URL. */
export function localCrestSource(team:string,source:string|null|undefined):string|undefined {
  const name=teamNameKey(team),reviewed=(overrides as Record<string,{source:string;local?:string}>)[name];
  const bySource:Record<string,string>=catalog.bySource,byName:Record<string,string>=catalog.byName;
  return flagUrlForTeam(team)??reviewed?.local??(reviewed?bySource[reviewed.source]:undefined)??(source?bySource[source]:undefined)??byName[name];
}

// Historical ESPN crest URLs are identities, never images to load: every one
// referenced by `matches` is baked into the local catalog (2026-09-13), and the
// same-origin ESPN proxy was removed along with ESPN as a provider.
const ESPN_CREST = /^https:\/\/a\.espncdn\.com\//i;

/** Last-resort remote crest (API-Football or another reviewed CDN). Never ESPN. */
export function crestFallbackSource(source: string | null | undefined): string | undefined {
  if (!source || ESPN_CREST.test(source)) return undefined;
  return source;
}
