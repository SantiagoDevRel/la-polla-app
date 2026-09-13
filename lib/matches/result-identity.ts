import { resultTeamKey } from '@/lib/api-football/results';
import type { ESPNEvent } from '@/lib/espn/client';

export function normalizeResultTeam(name: string): string {
  let v = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const aliases: Array<[RegExp, string]> = [
    [/\busa\b|\bunited states of america\b/g, "united states"],
    [/\bczechia\b/g, "czech republic"],
    [/\bbosnia(?: and | & |-)herzegovina\b/g, "bosnia herzegovina"],
    [/\bcote d.?ivoire\b/g, "ivory coast"],
    [/\bcape verde islands\b/g, "cape verde"], // football-data
    [/\bcabo verde\b/g, "cape verde"],
    [/\bsouth korea\b|\brepublic of korea\b/g, "korea republic"],
    [/\bir iran\b/g, "iran"], // football-data
    [/\bchina pr\b/g, "china"], // football-data
    [/\bcurazao\b/g, "curacao"],
    [/\bturkiye\b/g, "turkey"],
    [/\bcongo dr\b|\bcongo-kinshasa\b|\bdemocratic republic of congo\b/g, "dr congo"],
  ];
  for (const [rx, to] of aliases) v = v.replace(rx, to);
  return resultTeamKey(v.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
}


export interface ResultIdentity { home_team: string; away_team: string; scheduled_at: string; espn_id?: string | null }

/** Both teams and kickoff must agree, even when a stored provider ID exists. */
export function espnMatchesIdentity(match: ResultIdentity, event: ESPNEvent): boolean {
 const competitors=event.competitions[0]?.competitors ?? [];
 const home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
 const h=normalizeResultTeam(match.home_team),a=normalizeResultTeam(match.away_team);
 return !!home && !!away && !!h && !!a
  && Math.abs(Date.parse(event.date)-Date.parse(match.scheduled_at))<=2*3600000
  && normalizeResultTeam(home.team.displayName)===h && normalizeResultTeam(away.team.displayName)===a;
}

export function findEspnResult(match: ResultIdentity, events: ESPNEvent[]): ESPNEvent | null {
 const candidates=events.filter(e=>espnMatchesIdentity(match,e));
 const direct=match.espn_id ? candidates.filter(e=>e.id===match.espn_id) : [];
 if(direct.length===1)return direct[0];
 return candidates.length===1 ? candidates[0] : null;
}
