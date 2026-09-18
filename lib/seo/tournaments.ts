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
    internalSlug: "europa_2026",
    publicSlug: "europa-league",
    name: { es: "Europa League 2026/27", en: "Europa League 2026/27" },
    description: {
      es: "Pollas de la UEFA Europa League publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "UEFA Europa League pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de la Europa League",
      en: "Europa League pools",
    },
    keywords: {
      es: ["polla europa league", "quiniela europa league", "pronosticos europa league"],
      en: ["europa league pool", "europa league predictions"],
    },
  },
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
  {
    internalSlug: "copacolombia_2026",
    publicSlug: "copa-colombia",
    name: { es: "Copa Colombia 2026", en: "Colombia Cup 2026" },
    description: {
      es: "Pollas de Copa Colombia 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Colombia Cup 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Copa Colombia",
      en: "Colombia Cup pools",
    },
    keywords: {
      es: ["polla copa colombia", "quiniela copa colombia", "pronosticos copa colombia"],
      en: ["colombia cup pool", "colombia cup predictions"],
    },
  },
  {
    internalSlug: "conference_2026",
    publicSlug: "conference-league",
    name: { es: "Conference League 2026/27", en: "Conference League 2026/27" },
    description: {
      es: "Pollas de Conference League 2026/27 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Conference League 2026/27 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Conference League",
      en: "Conference League pools",
    },
    keywords: {
      es: ["polla conference league", "quiniela conference league", "pronosticos conference league"],
      en: ["conference league pool", "conference league predictions"],
    },
  },
  {
    internalSlug: "eredivisie_2026",
    publicSlug: "eredivisie",
    name: { es: "Eredivisie 2026/27", en: "Eredivisie 2026/27" },
    description: {
      es: "Pollas de Eredivisie 2026/27 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Eredivisie 2026/27 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Eredivisie",
      en: "Eredivisie pools",
    },
    keywords: {
      es: ["polla eredivisie", "quiniela liga holandesa", "pronosticos eredivisie"],
      en: ["eredivisie pool", "eredivisie predictions"],
    },
  },
  {
    internalSlug: "primeira_2026",
    publicSlug: "primeira-liga",
    name: { es: "Primeira Liga 2026/27", en: "Primeira Liga 2026/27" },
    description: {
      es: "Pollas de Primeira Liga 2026/27 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Primeira Liga 2026/27 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Primeira Liga",
      en: "Primeira Liga pools",
    },
    keywords: {
      es: ["polla primeira liga", "quiniela liga portuguesa", "pronosticos liga de portugal"],
      en: ["primeira liga pool", "primeira liga predictions"],
    },
  },
  {
    internalSlug: "brasileirao_2026",
    publicSlug: "brasileirao",
    name: { es: "Brasileirão 2026", en: "Brasileirao 2026" },
    description: {
      es: "Pollas de Brasileirão 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Brasileirao 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Brasileirão",
      en: "Brasileirao pools",
    },
    keywords: {
      es: ["polla brasileirao", "quiniela liga brasilena", "pronosticos brasileirao"],
      en: ["brasileirao pool", "brasileirao predictions"],
    },
  },
  {
    internalSlug: "copadobrasil_2026",
    publicSlug: "copa-do-brasil",
    name: { es: "Copa do Brasil 2026", en: "Brazil Cup 2026" },
    description: {
      es: "Pollas de Copa do Brasil 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Brazil Cup 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Copa do Brasil",
      en: "Brazil Cup pools",
    },
    keywords: {
      es: ["polla copa do brasil", "quiniela copa de brasil", "pronosticos copa do brasil"],
      en: ["brazil cup pool", "brazil cup predictions"],
    },
  },
  {
    internalSlug: "ligaargentina_2026",
    publicSlug: "liga-argentina",
    name: { es: "Liga Argentina 2026", en: "Argentine League 2026" },
    description: {
      es: "Pollas de Liga Argentina 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Argentine League 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Liga Argentina",
      en: "Argentine League pools",
    },
    keywords: {
      es: ["polla liga argentina", "quiniela futbol argentino", "pronosticos liga argentina"],
      en: ["argentine league pool", "argentine league predictions"],
    },
  },
  {
    internalSlug: "copaargentina_2026",
    publicSlug: "copa-argentina",
    name: { es: "Copa Argentina 2026", en: "Argentina Cup 2026" },
    description: {
      es: "Pollas de Copa Argentina 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Argentina Cup 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Copa Argentina",
      en: "Argentina Cup pools",
    },
    keywords: {
      es: ["polla copa argentina", "quiniela copa argentina", "pronosticos copa argentina"],
      en: ["argentina cup pool", "argentina cup predictions"],
    },
  },
  {
    internalSlug: "ligamx_2026",
    publicSlug: "liga-mx",
    name: { es: "Liga MX 2026", en: "Liga MX 2026" },
    description: {
      es: "Pollas de Liga MX 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Liga MX 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Liga MX",
      en: "Liga MX pools",
    },
    keywords: {
      es: ["polla liga mx", "quiniela liga mx", "pronosticos futbol mexicano"],
      en: ["liga mx pool", "liga mx predictions"],
    },
  },
  {
    internalSlug: "mls_2026",
    publicSlug: "mls",
    name: { es: "MLS 2026", en: "MLS 2026" },
    description: {
      es: "Pollas de MLS 2026 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "MLS 2026 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de MLS",
      en: "MLS pools",
    },
    keywords: {
      es: ["polla mls", "quiniela mls", "pronosticos mls"],
      en: ["mls pool", "mls predictions"],
    },
  },
  {
    internalSlug: "nationsleague_2026",
    publicSlug: "nations-league",
    name: { es: "Nations League 2026/27", en: "Nations League 2026/27" },
    description: {
      es: "Pollas de Nations League 2026/27 publicadas por la casa. Paga la entrada, pronostica y compite por el pozo.",
      en: "Nations League 2026/27 pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.",
    },
    heading: {
      es: "Pollas de Nations League",
      en: "Nations League pools",
    },
    keywords: {
      es: ["polla nations league", "quiniela nations league", "pronosticos nations league"],
      en: ["nations league pool", "nations league predictions"],
    },
  },];

export function findByPublicSlug(slug: string): TournamentSeo | undefined {
  return TOURNAMENTS_SEO.find((t) => t.publicSlug === slug);
}

export function findByInternalSlug(internal: string): TournamentSeo | undefined {
  return TOURNAMENTS_SEO.find((t) => t.internalSlug === internal);
}
