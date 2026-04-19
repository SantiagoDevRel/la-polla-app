// lib/tournaments.ts — Single source of truth for tournament metadata
// Logo paths must match exact filenames in /public/tournaments/

export const TOURNAMENTS = [
  {
    slug: "champions_2025",
    name: "Champions League",
    apiCode: "CL",
    logoPath: "/tournaments/champions_league.svg",
    color: "#1a1aff",
  },
  {
    slug: "worldcup_2026",
    name: "Mundial 2026",
    apiCode: "WC",
    logoPath: "/tournaments/world_cup.svg",
    color: "#c0392b",
  },
  {
    slug: "laliga_2025",
    name: "La Liga",
    apiCode: "PD",
    logoPath: "/tournaments/la_liga.png",
    color: "#ff6b00",
  },
  {
    slug: "premier_2025",
    name: "Premier League",
    apiCode: "PL",
    logoPath: "/tournaments/premier_league.webp",
    color: "#3d195b",
  },
  {
    slug: "seriea_2025",
    name: "Serie A",
    apiCode: "SA",
    logoPath: "/tournaments/seria_a.png",
    color: "#007bc0",
  },
] as const;

export type TournamentSlug = (typeof TOURNAMENTS)[number]["slug"];

export function getTournamentBySlug(slug: string) {
  return TOURNAMENTS.find((t) => t.slug === slug);
}

export function getTournamentName(slug: string): string {
  return getTournamentBySlug(slug)?.name || slug;
}

export function getTournamentLogo(slug: string): string {
  return getTournamentBySlug(slug)?.logoPath || "/tournaments/champions_league.svg";
}

// Flat slug → icon-path map. Relocated from components/shared/PollaCard.tsx
// during Phase 3a so multiple UI surfaces can import without depending on a
// component file. Includes legacy slug aliases for backward-compat.
export const TOURNAMENT_ICONS: Record<string, string> = {
  champions_2025: "/tournaments/champions_league.svg",
  worldcup_2026: "/tournaments/world_cup.svg",
  laliga_2025: "/tournaments/la_liga.png",
  premier_2025: "/tournaments/premier_league.webp",
  seriea_2025: "/tournaments/seria_a.png",
  // Legacy slugs (backward compat)
  la_liga_2025: "/tournaments/la_liga.png",
  premier_league: "/tournaments/premier_league.webp",
  seria_a: "/tournaments/seria_a.png",
};
