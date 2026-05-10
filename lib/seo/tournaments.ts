// lib/seo/tournaments.ts — Mapeo entre slugs internos (DB / TOURNAMENT_STRUCTURE)
// y slugs públicos URL-friendly que usamos en /torneos/[slug] y /partidos/[slug].
//
// Los slugs públicos son estables y "human-readable". Cambiarlos rompe
// URLs indexadas — sumar nuevos OK, no editar existentes.

import type { SiteLocale } from "@/lib/seo/sites";

export interface TournamentSeo {
  /** Slug interno usado en DB (matches.tournament). */
  internalSlug: string;
  /** Slug público que aparece en /torneos/[slug]. */
  publicSlug: string;
  /** Nombre humano por idioma. */
  name: Record<SiteLocale, string>;
  /** Descripción corta por idioma. */
  description: Record<SiteLocale, string>;
  /** H1 / título de página por idioma. */
  heading: Record<SiteLocale, string>;
  /** Tags / keywords. */
  keywords: Record<SiteLocale, string[]>;
}

export const TOURNAMENTS_SEO: TournamentSeo[] = [
  {
    internalSlug: "worldcup_2026",
    publicSlug: "mundial-2026",
    name: { es: "Mundial 2026", en: "World Cup 2026" },
    description: {
      es: "Polla del Mundial 2026 con todos los partidos, fases de grupos, eliminatorias y final. Invita a tus parceros y compitan por puntos.",
      en: "World Cup 2026 pool with every match: group stage, knockouts and final. Invite friends and compete on points.",
    },
    heading: {
      es: "Crea tu polla del Mundial 2026",
      en: "Create your World Cup 2026 pool",
    },
    keywords: {
      es: ["polla mundial 2026", "quiniela mundial", "pronosticos mundial", "polla copa del mundo"],
      en: ["world cup 2026 pool", "world cup picks", "world cup predictions"],
    },
  },
  {
    internalSlug: "champions_2025",
    publicSlug: "champions-league",
    name: { es: "Champions League 2025/26", en: "Champions League 2025/26" },
    description: {
      es: "Polla de la UEFA Champions League. Predice fase de liga, octavos, cuartos, semifinales y final con tus amigos.",
      en: "UEFA Champions League pool. Predict league phase, round of 16, quarter-finals, semi-finals and final with friends.",
    },
    heading: {
      es: "Polla de la Champions League",
      en: "Champions League pool",
    },
    keywords: {
      es: ["polla champions league", "quiniela champions", "pronosticos champions"],
      en: ["champions league pool", "champions league predictions"],
    },
  },
  {
    internalSlug: "libertadores_2026",
    publicSlug: "copa-libertadores",
    name: { es: "Copa Libertadores 2026", en: "Copa Libertadores 2026" },
    description: {
      es: "Polla de la Copa Libertadores 2026. Predice todos los partidos de la fase de grupos, octavos, cuartos, semis y la final.",
      en: "Copa Libertadores 2026 pool. Predict every match from group stage to the final.",
    },
    heading: {
      es: "Polla de la Copa Libertadores",
      en: "Copa Libertadores pool",
    },
    keywords: {
      es: ["polla libertadores", "quiniela copa libertadores", "pronosticos libertadores"],
      en: ["copa libertadores pool", "copa libertadores predictions"],
    },
  },
  {
    internalSlug: "sudamericana_2026",
    publicSlug: "copa-sudamericana",
    name: { es: "Copa Sudamericana 2026", en: "Copa Sudamericana 2026" },
    description: {
      es: "Polla de la Copa Sudamericana 2026. Predice resultados desde la fase de grupos hasta la final.",
      en: "Copa Sudamericana 2026 pool. Predict results from group stage to the final.",
    },
    heading: {
      es: "Polla de la Copa Sudamericana",
      en: "Copa Sudamericana pool",
    },
    keywords: {
      es: ["polla sudamericana", "pronosticos sudamericana"],
      en: ["copa sudamericana pool", "copa sudamericana predictions"],
    },
  },
  {
    internalSlug: "betplay_2026",
    publicSlug: "liga-betplay",
    name: { es: "Liga BetPlay Dimayor 2026", en: "Liga BetPlay 2026" },
    description: {
      es: "Polla de la Liga BetPlay 2026. Todos contra todos, cuartos, semifinales y final del fútbol profesional colombiano.",
      en: "Liga BetPlay 2026 pool. Round-robin, quarter-finals, semi-finals and final of Colombian football.",
    },
    heading: {
      es: "Polla de la Liga BetPlay",
      en: "Liga BetPlay pool",
    },
    keywords: {
      es: ["polla liga betplay", "polla dimayor", "pronosticos liga colombiana", "polla nacional"],
      en: ["liga betplay pool", "colombian football predictions"],
    },
  },
  {
    internalSlug: "laliga_2025",
    publicSlug: "laliga",
    name: { es: "LaLiga 2025/26", en: "LaLiga 2025/26" },
    description: {
      es: "Polla de LaLiga española. Predice todos los partidos de la temporada con tus amigos.",
      en: "Spanish LaLiga pool. Predict every match of the season with friends.",
    },
    heading: { es: "Polla de LaLiga", en: "LaLiga pool" },
    keywords: {
      es: ["polla laliga", "polla liga española", "pronosticos laliga"],
      en: ["laliga pool", "spanish league predictions"],
    },
  },
  {
    internalSlug: "premier_2025",
    publicSlug: "premier-league",
    name: { es: "Premier League 2025/26", en: "Premier League 2025/26" },
    description: {
      es: "Polla de la Premier League inglesa. Predice todos los partidos de la temporada con tus amigos.",
      en: "English Premier League pool. Predict every match of the season with friends.",
    },
    heading: { es: "Polla de la Premier League", en: "Premier League pool" },
    keywords: {
      es: ["polla premier league", "polla premier", "pronosticos premier"],
      en: ["premier league pool", "premier league predictions"],
    },
  },
  {
    internalSlug: "seriea_2025",
    publicSlug: "serie-a",
    name: { es: "Serie A 2025/26", en: "Serie A 2025/26" },
    description: {
      es: "Polla de la Serie A italiana. Predice todos los partidos de la temporada con tus amigos.",
      en: "Italian Serie A pool. Predict every match of the season with friends.",
    },
    heading: { es: "Polla de la Serie A", en: "Serie A pool" },
    keywords: {
      es: ["polla serie a", "polla calcio", "pronosticos serie a"],
      en: ["serie a pool", "italian league predictions"],
    },
  },
];

export function findByPublicSlug(slug: string): TournamentSeo | undefined {
  return TOURNAMENTS_SEO.find((t) => t.publicSlug === slug);
}

export function findByInternalSlug(internal: string): TournamentSeo | undefined {
  return TOURNAMENTS_SEO.find((t) => t.internalSlug === internal);
}
