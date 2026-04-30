// lib/tournaments.ts — Single source of truth for tournament metadata
// Logo paths must match exact filenames in /public/tournaments/

// Cache-bust version para los logos de torneos. Incrementar (por ejemplo
// "2" -> "3") cada vez que se reemplace el archivo fuente de un logo
// para forzar a los clientes y al service worker a pedirlo de nuevo.
const LOGO_V = "3";

export const TOURNAMENTS = [
  {
    slug: "champions_2025",
    name: "Champions League",
    apiCode: "CL",
    logoPath: `/tournaments/champions_league.svg?v=${LOGO_V}`,
    color: "#1a1aff",
  },
  {
    slug: "worldcup_2026",
    name: "Mundial 2026",
    apiCode: "WC",
    logoPath: `/tournaments/world_cup.svg?v=${LOGO_V}`,
    color: "#c0392b",
  },
  {
    slug: "laliga_2025",
    name: "La Liga",
    apiCode: "PD",
    logoPath: `/tournaments/la_liga.png?v=${LOGO_V}`,
    color: "#ff6b00",
  },
  {
    slug: "premier_2025",
    name: "Premier League",
    apiCode: "PL",
    logoPath: `/tournaments/premier_league.webp?v=${LOGO_V}`,
    color: "#3d195b",
  },
  {
    slug: "seriea_2025",
    name: "Serie A",
    apiCode: "SA",
    logoPath: `/tournaments/seria_a.png?v=${LOGO_V}`,
    color: "#007bc0",
  },
  // Latin American leagues — ESPN-only (football-data plan free no las
  // cubre). Single-source verification por ahora; cuando agreguemos
  // un segundo proveedor (API-Football u otro), pasan a doble check.
  {
    slug: "libertadores_2026",
    name: "Copa Libertadores",
    apiCode: "CLI",
    logoPath: `/tournaments/copa_libertadores.png?v=${LOGO_V}`,
    color: "#005f8e",
  },
  {
    slug: "sudamericana_2026",
    name: "Copa Sudamericana",
    apiCode: "CSU",
    logoPath: `/tournaments/copa_sudamericana.png?v=${LOGO_V}`,
    color: "#e9242a",
  },
  {
    slug: "betplay_2026",
    name: "Liga BetPlay",
    apiCode: "BP",
    logoPath: `/tournaments/liga_betplay.png?v=${LOGO_V}`,
    color: "#fcd116",
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
  return getTournamentBySlug(slug)?.logoPath || `/tournaments/champions_league.svg?v=${LOGO_V}`;
}

// Flat slug → icon-path map. Relocated from components/shared/PollaCard.tsx
// during Phase 3a so multiple UI surfaces can import without depending on a
// component file.
export const TOURNAMENT_ICONS: Record<string, string> = {
  champions_2025: `/tournaments/champions_league.svg?v=${LOGO_V}`,
  worldcup_2026: `/tournaments/world_cup.svg?v=${LOGO_V}`,
  laliga_2025: `/tournaments/la_liga.png?v=${LOGO_V}`,
  premier_2025: `/tournaments/premier_league.webp?v=${LOGO_V}`,
  seriea_2025: `/tournaments/seria_a.png?v=${LOGO_V}`,
  libertadores_2026: `/tournaments/copa_libertadores.png?v=${LOGO_V}`,
  sudamericana_2026: `/tournaments/copa_sudamericana.png?v=${LOGO_V}`,
  betplay_2026: `/tournaments/liga_betplay.png?v=${LOGO_V}`,
};
