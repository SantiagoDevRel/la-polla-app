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
      es: "Pollas del Mundial 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "World Cup 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas del Mundial 2026",
      en: "World Cup 2026 pools",
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
      es: "Pollas de la UEFA Champions League publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "UEFA Champions League pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de la Champions League",
      en: "Champions League pools",
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
      es: "Pollas de la Copa Libertadores 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Copa Libertadores 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de la Copa Libertadores",
      en: "Copa Libertadores pools",
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
      es: "Pollas de la Copa Sudamericana 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Copa Sudamericana 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de la Copa Sudamericana",
      en: "Copa Sudamericana pools",
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
      es: "Pollas de la Liga BetPlay 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Liga BetPlay 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de la Liga BetPlay",
      en: "Liga BetPlay pools",
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
      es: "Pollas de LaLiga publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "LaLiga pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: { es: "Pollas de LaLiga", en: "LaLiga pools" },
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
      es: "Pollas de la Premier League publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Premier League pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: { es: "Pollas de la Premier League", en: "Premier League pools" },
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
      es: "Pollas de la Serie A publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Serie A pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: { es: "Pollas de la Serie A", en: "Serie A pools" },
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
