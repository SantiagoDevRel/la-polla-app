// lib/espn/club.ts — Helpers compartidos para resolver el CLUB ACTUAL de un
// jugador de selección desde la "core" API de ESPN.
//
// Ni el roster (site scoreboard) ni el summary de un partido traen el club
// del jugador (defaultTeam/team/leagues vienen como stubs vacíos — verificado
// 2026-06-12). El club vive SOLO en la core API por atleta:
//   /athletes/{id} → defaultTeam.$ref → /teams/{clubId}
// El escudo se arma del clubId sin fetch (CDN estable); solo el NOMBRE del
// club necesita un fetch extra, deduplicado por club y cacheado 24h (Next Data
// Cache, compartido global → reloads instantáneos, free-tier intacto).
//
// Lo usan tanto el plantel (lib/espn/teams.ts) como las alineaciones en vivo
// (lib/espn/summary.ts).

const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/soccer";

/** Torneos de SELECCIONES — solo acá tiene sentido mostrar el club del
 *  jugador (en ligas de clubes el plantel ya ES el club). */
export const NATIONAL_TEAM_TOURNAMENTS: ReadonlySet<string> = new Set(["worldcup_2026"]);

/** Escudo del club, URL estable del CDN de ESPN (no requiere fetch). */
export function clubCrestUrl(clubId: string): string {
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${clubId}.png`;
}

/** core /athletes/{id} → clubId (extraído del $ref de defaultTeam). */
export async function fetchAthleteClubId(athleteId: string): Promise<string | null> {
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
export async function fetchClubName(clubId: string): Promise<string | null> {
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
export async function mapWithConcurrency<T, R>(
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
