// lib/espn/teams.ts — Catálogo de selecciones, plantel y noticias de ESPN.
//
// /teams              → lista (name → id). Los nombres matchean EXACTO los
//                       de matches.home_team (verificado 2026-06-12), así
//                       que el mapping no necesita bake/diccionario.
// /teams/{id}?roster  → plantel completo (25 jugadores con dorsal, posición,
//                       edad, foto si existe).
// /news               → titulares de la liga (filtrables por equipo).
//
// Todo público, sin auth, sin API key. Cacheado 24h (catálogo/plantel
// cambian poco) / 1h (noticias). Next Data Cache, compartido global.
import { ESPN_LEAGUE_BY_TOURNAMENT } from "./client";
import { WORLDCUP_ESPN_TEAM_IDS } from "./worldcup-team-ids";
import {
  NATIONAL_TEAM_TOURNAMENTS,
  clubCrestUrl,
  fetchAthleteClubId,
  fetchClubName,
  mapWithConcurrency,
} from "./club";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// ─────────────────────────────────────────────────────────────────────
// Catálogo de equipos + resolución name → ESPN id.
// ─────────────────────────────────────────────────────────────────────
interface RawTeamEntry {
  team: {
    id: string;
    displayName: string;
    abbreviation?: string;
    logos?: { href: string }[];
  };
}
interface RawTeamsResponse {
  sports?: { leagues?: { teams?: RawTeamEntry[] }[] }[];
}

export interface EspnTeam {
  id: string;
  name: string;
  abbr: string | null;
  logo: string | null;
}

export async function fetchEspnTeams(tournamentSlug: string): Promise<EspnTeam[]> {
  const league = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!league) return [];
  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/${league}/teams`, {
      headers: { accept: "application/json" },
      next: { revalidate: 86400 },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const raw = (await res.json()) as RawTeamsResponse;
  const list = raw.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return list.map((t) => ({
    id: t.team.id,
    name: t.team.displayName,
    abbr: t.team.abbreviation ?? null,
    logo: t.team.logos?.[0]?.href ?? null,
  }));
}

/** name (matches.home_team) → ESPN id. Exacto, luego case-insensitive. */
export async function resolveEspnTeamId(
  tournamentSlug: string,
  teamName: string,
): Promise<string | null> {
  // Fast path: id horneado del Mundial → evita el fetch de /teams (~460ms
  // menos en el cold load del Plantel).
  if (tournamentSlug === "worldcup_2026") {
    const baked = WORLDCUP_ESPN_TEAM_IDS[teamName];
    if (baked) return baked;
  }
  const teams = await fetchEspnTeams(tournamentSlug);
  const exact = teams.find((t) => t.name === teamName);
  if (exact) return exact.id;
  const lower = teamName.toLowerCase();
  return teams.find((t) => t.name.toLowerCase() === lower)?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Plantel de un equipo.
// ─────────────────────────────────────────────────────────────────────
interface RawRosterAthlete {
  id?: string;
  displayName?: string;
  jersey?: string;
  age?: number;
  position?: { abbreviation?: string; name?: string };
  headshot?: { href?: string };
}
interface RawTeamDetail {
  team?: { displayName?: string; athletes?: RawRosterAthlete[] };
}

/** Línea gruesa a partir de la posición de ESPN, para agrupar el plantel. */
export type PlayerLine = "GK" | "DEF" | "MID" | "FWD" | "OTH";

export interface SquadPlayer {
  name: string;
  jersey: string | null;
  pos: string | null;
  line: PlayerLine;
  age: number | null;
  headshot: string | null;
  /** Club actual del jugador (solo para selecciones — en ligas de clubes
   *  el plantel YA es un club, así que se omite). null si ESPN no lo trae. */
  club: string | null;
  /** Escudo del club, URL estable del CDN de ESPN (no requiere fetch). */
  clubCrest: string | null;
}

function lineFromPos(abbr: string | null, name: string | null): PlayerLine {
  const a = (abbr ?? "").toUpperCase();
  const n = (name ?? "").toLowerCase();
  if (a === "G" || n.includes("goalkeeper")) return "GK";
  if (["D", "CB", "LB", "RB", "WB", "LWB", "RWB"].includes(a) || n.includes("back") || n.includes("defender"))
    return "DEF";
  if (["M", "CM", "DM", "AM", "LM", "RM", "CDM", "CAM"].includes(a) || n.includes("midfield"))
    return "MID";
  if (["F", "ST", "CF", "LW", "RW", "W"].includes(a) || n.includes("forward") || n.includes("striker") || n.includes("wing"))
    return "FWD";
  return "OTH";
}

export async function fetchEspnTeamRoster(
  tournamentSlug: string,
  espnTeamId: string,
): Promise<SquadPlayer[]> {
  const league = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!league) return [];
  let res: Response;
  try {
    res = await fetch(
      `${ESPN_BASE}/${league}/teams/${encodeURIComponent(espnTeamId)}?enable=roster`,
      { headers: { accept: "application/json" }, next: { revalidate: 86400 } },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const raw = (await res.json()) as RawTeamDetail;
  const athletes = raw.team?.athletes ?? [];
  // El id del atleta NO va dentro de SquadPlayer (no es parte del contrato
  // público): se lleva en un array paralelo solo para enriquecer el club.
  const athleteIds: (string | null)[] = [];
  const players: SquadPlayer[] = [];
  for (const a of athletes) {
    if (!a.displayName) continue;
    const pos = a.position?.abbreviation ?? null;
    players.push({
      name: a.displayName,
      jersey: a.jersey ?? null,
      pos,
      line: lineFromPos(pos, a.position?.name ?? null),
      age: typeof a.age === "number" ? a.age : null,
      headshot: a.headshot?.href ?? null,
      club: null,
      clubCrest: null,
    });
    athleteIds.push(a.id ?? null);
  }

  // Club actual: solo para selecciones (en ligas de clubes sería redundante).
  if (NATIONAL_TEAM_TOURNAMENTS.has(tournamentSlug)) {
    // Cache de nombre por club dentro de este plantel (un club lo comparten
    // varios jugadores → un solo fetch por club).
    const clubNameByIdPromise = new Map<string, Promise<string | null>>();
    await mapWithConcurrency(players, 8, async (p, idx) => {
      const athleteId = athleteIds[idx];
      if (!athleteId) return;
      const clubId = await fetchAthleteClubId(athleteId);
      if (!clubId) return;
      p.clubCrest = clubCrestUrl(clubId);
      if (!clubNameByIdPromise.has(clubId)) clubNameByIdPromise.set(clubId, fetchClubName(clubId));
      p.club = await clubNameByIdPromise.get(clubId)!;
    });
  }

  return players;
}

// ─────────────────────────────────────────────────────────────────────
// Noticias de la liga (opcionalmente filtradas por equipo).
// ─────────────────────────────────────────────────────────────────────
interface RawArticle {
  headline?: string;
  description?: string;
  published?: string;
  links?: { web?: { href?: string } };
  images?: { url?: string }[];
}
interface RawNewsResponse {
  articles?: RawArticle[];
}

export interface NewsItem {
  headline: string;
  description: string;
  url: string | null;
  image: string | null;
  publishedAt: string | null;
}

export async function fetchEspnLeagueNews(tournamentSlug: string): Promise<NewsItem[]> {
  const league = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!league) return [];
  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/${league}/news`, {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const raw = (await res.json()) as RawNewsResponse;
  return (raw.articles ?? [])
    .map((a) => ({
      headline: a.headline ?? "",
      description: a.description ?? "",
      url: a.links?.web?.href ?? null,
      image: a.images?.[0]?.url ?? null,
      publishedAt: a.published ?? null,
    }))
    .filter((n) => n.headline);
}

/**
 * Noticias que mencionan a un equipo (por nombre en headline/description).
 * Si ninguna lo menciona, devuelve la lista completa de la liga — mejor
 * mostrar algo relevante del torneo que un tab vacío.
 */
export async function fetchEspnTeamNews(
  tournamentSlug: string,
  teamName: string,
): Promise<NewsItem[]> {
  const all = await fetchEspnLeagueNews(tournamentSlug);
  const needle = teamName.toLowerCase();
  const matched = all.filter(
    (n) =>
      n.headline.toLowerCase().includes(needle) ||
      n.description.toLowerCase().includes(needle),
  );
  return matched.length > 0 ? matched : all;
}
