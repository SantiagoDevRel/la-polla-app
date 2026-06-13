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

// ─────────────────────────────────────────────────────────────────────
// Enriquecimiento de club actual (selecciones).
// ─────────────────────────────────────────────────────────────────────
//
// El roster de la scoreboard API NO trae el club del jugador (defaultTeam,
// team y leagues vienen como stubs vacíos — verificado 2026-06-12). El club
// vive SOLO en la "core" API por atleta: /athletes/{id} → defaultTeam.$ref,
// que apunta a /teams/{clubId}. El escudo se arma del clubId sin fetch
// (CDN estable); solo el NOMBRE del club necesita un fetch extra (deduplicado
// por club dentro del plantel y cacheado 24h, así un parche entero comparte
// la misma resolución y los reloads son instantáneos).

/** Torneos de SELECCIONES — solo acá tiene sentido mostrar el club del
 *  jugador (en ligas de clubes el plantel ya ES el club). */
const NATIONAL_TEAM_TOURNAMENTS: ReadonlySet<string> = new Set(["worldcup_2026"]);

const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/soccer";

/** core /athletes/{id} → clubId (extraído del $ref de defaultTeam). */
async function fetchAthleteClubId(athleteId: string): Promise<string | null> {
  try {
    const res = await fetch(`${ESPN_CORE}/athletes/${encodeURIComponent(athleteId)}?lang=en&region=us`, {
      headers: { accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { defaultTeam?: { $ref?: string } };
    const ref = j.defaultTeam?.$ref;
    if (!ref) return null;
    const m = ref.match(/teams\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** core /teams/{clubId} → nombre display del club. */
async function fetchClubName(clubId: string): Promise<string | null> {
  try {
    const res = await fetch(`${ESPN_CORE}/teams/${encodeURIComponent(clubId)}?lang=en&region=us`, {
      headers: { accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { displayName?: string; name?: string };
    return j.displayName ?? j.name ?? null;
  } catch {
    return null;
  }
}

/** map con límite de concurrencia (no martillar ESPN en el cold load). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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
  const players: (SquadPlayer & { _id: string | null })[] = athletes
    .map((a) => {
      const pos = a.position?.abbreviation ?? null;
      return {
        _id: a.id ?? null,
        name: a.displayName ?? "",
        jersey: a.jersey ?? null,
        pos,
        line: lineFromPos(pos, a.position?.name ?? null),
        age: typeof a.age === "number" ? a.age : null,
        headshot: a.headshot?.href ?? null,
        club: null as string | null,
        clubCrest: null as string | null,
      };
    })
    .filter((p) => p.name);

  // Club actual: solo para selecciones (en ligas de clubes sería redundante).
  if (NATIONAL_TEAM_TOURNAMENTS.has(tournamentSlug)) {
    // Cache de nombre por club dentro de este plantel (un club lo comparten
    // varios jugadores → un solo fetch por club).
    const clubNameByIdPromise = new Map<string, Promise<string | null>>();
    await mapWithConcurrency(players, 8, async (p) => {
      if (!p._id) return;
      const clubId = await fetchAthleteClubId(p._id);
      if (!clubId) return;
      p.clubCrest = `https://a.espncdn.com/i/teamlogos/soccer/500/${clubId}.png`;
      if (!clubNameByIdPromise.has(clubId)) clubNameByIdPromise.set(clubId, fetchClubName(clubId));
      p.club = await clubNameByIdPromise.get(clubId)!;
    });
  }

  // Drop el id interno antes de devolver (no es parte del contrato público).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return players.map(({ _id, ...rest }) => rest);
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
