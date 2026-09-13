import type { FootballMatch } from './detail-model';

export interface FootballSquadPlayer {
  id: number; name: string; age: number | null; number: number | null; position: string; photo: string | null;
}
export interface FootballTeam {
  team: {id: number; name: string; logo: string; country: string | null; founded: number | null};
  venue: {name: string | null; city: string | null; capacity: number | null; image: string | null} | null;
  players: FootballSquadPlayer[]; matches: FootballMatch[]; fetchedAt: string | null;
}
