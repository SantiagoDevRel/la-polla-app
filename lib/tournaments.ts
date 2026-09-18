// lib/tournaments.ts — Single source of truth for tournament metadata
// Logo paths must match exact filenames in /public/tournaments/
import leagueLogos from './teams/league-logos.json' with { type: 'json' };

// Cache-bust version para los logos de torneos. Incrementar (por ejemplo
// "2" -> "3") cada vez que se reemplace el archivo fuente de un logo
// para forzar a los clientes y al service worker a pedirlo de nuevo.
const LOGO_V = "8";

export const TOURNAMENTS = [
  {
    slug: "champions_2025",
    name: "Champions League",
    apiCode: "CL",
    logoPath: `/tournaments/champions_league.svg?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/champions_league-96.webp?v=${LOGO_V}`,
    color: "#1a1aff",
  },
  {
    slug: "europa_2026",
    name: "Europa League",
    apiCode: "EL",
    logoPath: "/team-crests/db7cc73aab0c238e-96.webp",
    smallLogoPath: "/team-crests/db7cc73aab0c238e-96.webp",
    color: "#ff6900",
  },
  {
    slug: "worldcup_2026",
    name: "Mundial 2026",
    apiCode: "WC",
    logoPath: `/tournaments/mundial-2026.webp?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/mundial-2026-96.webp?v=${LOGO_V}`,
    color: "#c0392b",
  },
  {
    slug: "laliga_2025",
    name: "La Liga",
    apiCode: "PD",
    logoPath: `/tournaments/la_liga.png?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/la_liga-96.webp?v=${LOGO_V}`,
    color: "#ff6b00",
  },
  {
    slug: "premier_2025",
    name: "Premier League",
    apiCode: "PL",
    logoPath: `/tournaments/premier_league.webp?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/premier_league-96.webp?v=${LOGO_V}`,
    color: "#3d195b",
  },
  {
    slug: "seriea_2025",
    name: "Serie A",
    apiCode: "SA",
    logoPath: `/tournaments/seria_a.png?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/seria_a-96.webp?v=${LOGO_V}`,
    color: "#007bc0",
  },
  // Latin American leagues: API-Football + ESPN. The football-data free
  // plan does not cover these competitions.
  {
    slug: "libertadores_2026",
    name: "Copa Libertadores",
    apiCode: "CLI",
    logoPath: `/tournaments/copa_libertadores.svg?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/copa_libertadores-96.webp?v=${LOGO_V}`,
    color: "#005f8e",
  },
  {
    slug: "sudamericana_2026",
    name: "Copa Sudamericana",
    apiCode: "CSU",
    logoPath: `/tournaments/copa_sudamericana.svg?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/copa_sudamericana-96.webp?v=${LOGO_V}`,
    color: "#e9242a",
  },
  {
    slug: "betplay_2026",
    name: "Liga BetPlay",
    apiCode: "BP",
    logoPath: `/tournaments/liga_betplay.svg?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/liga_betplay-96.webp?v=${LOGO_V}`,
    color: "#fcd116",
  },
  // Agregadas 2026-08-25 para la polla centralizada: el owner pidio las 5
  // grandes ligas europeas y estas dos faltaban. Ambas estan en el plan free
  // de football-data (BL1 / FL1) y en ESPN (ger.1 / fra.1).
  {
    slug: "bundesliga_2025",
    name: "Bundesliga",
    apiCode: "BL1",
    logoPath: `/tournaments/bundesliga.svg?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/bundesliga-96.webp?v=${LOGO_V}`,
    color: "#d20515",
  },
  {
    slug: "ligue1_2025",
    name: "Ligue 1",
    apiCode: "FL1",
    logoPath: `/tournaments/ligue_1.svg?v=${LOGO_V}`,
    smallLogoPath: `/tournaments/ligue_1-96.webp?v=${LOGO_V}`,
    color: "#dae025",
  },
  // Agregados 2026-09-18 a pedido del dueño: once torneos más, todos con
  // cobertura completa de API-Football (eventos, estadísticas y alineaciones)
  // verificada contra /leagues?current=true el mismo día. El logo real lo
  // hornea scripts/bake-team-crests.mjs en league-logos.json; los paths de
  // acá son el respaldo que usa getTournamentLogo si esa entrada faltara.
  {
    slug: "copacolombia_2026",
    name: "Copa Colombia",
    apiCode: "CCO",
    logoPath: "/team-crests/5c77cfd14eddac8f-96.webp",
    smallLogoPath: "/team-crests/5c77cfd14eddac8f-96.webp",
    color: "#fcd116",
  },
  {
    slug: "conference_2026",
    name: "Conference League",
    apiCode: "UECL",
    logoPath: "/team-crests/3e5c234c16f63389-96.webp",
    smallLogoPath: "/team-crests/3e5c234c16f63389-96.webp",
    color: "#00b94f",
  },
  {
    slug: "eredivisie_2026",
    name: "Eredivisie",
    apiCode: "DED",
    logoPath: "/team-crests/c242e6fa2761fab1-96.webp",
    smallLogoPath: "/team-crests/c242e6fa2761fab1-96.webp",
    color: "#e2001a",
  },
  {
    slug: "primeira_2026",
    name: "Primeira Liga",
    apiCode: "PPL",
    logoPath: "/team-crests/3799c36654cbdfd3-96.webp",
    smallLogoPath: "/team-crests/3799c36654cbdfd3-96.webp",
    color: "#036c3c",
  },
  {
    slug: "brasileirao_2026",
    name: "Brasileirão",
    apiCode: "BSA",
    logoPath: "/team-crests/292cd315ccc2c20f-96.webp",
    smallLogoPath: "/team-crests/292cd315ccc2c20f-96.webp",
    color: "#14b356",
  },
  {
    slug: "copadobrasil_2026",
    name: "Copa do Brasil",
    apiCode: "CDB",
    logoPath: "/team-crests/60c99225b71b5717-96.webp",
    smallLogoPath: "/team-crests/60c99225b71b5717-96.webp",
    color: "#f7c600",
  },
  {
    slug: "ligaargentina_2026",
    name: "Liga Argentina",
    apiCode: "LPA",
    logoPath: "/team-crests/0f3982fd1786e614-96.webp",
    smallLogoPath: "/team-crests/0f3982fd1786e614-96.webp",
    color: "#75aadb",
  },
  {
    slug: "copaargentina_2026",
    name: "Copa Argentina",
    apiCode: "CAR",
    logoPath: "/team-crests/565f5c3699f12352-96.webp",
    smallLogoPath: "/team-crests/565f5c3699f12352-96.webp",
    color: "#6cace4",
  },
  {
    slug: "ligamx_2026",
    name: "Liga MX",
    apiCode: "LMX",
    logoPath: "/team-crests/b084cb75e37d328c-96.webp",
    smallLogoPath: "/team-crests/b084cb75e37d328c-96.webp",
    color: "#006847",
  },
  {
    slug: "mls_2026",
    name: "MLS",
    apiCode: "MLS",
    logoPath: "/team-crests/ffa2c1a0abfd1ed2-96.webp",
    smallLogoPath: "/team-crests/ffa2c1a0abfd1ed2-96.webp",
    color: "#001b3a",
  },
  {
    slug: "nationsleague_2026",
    name: "Nations League",
    apiCode: "UNL",
    logoPath: "/team-crests/3fe3bf8f8b7c666e-96.webp",
    smallLogoPath: "/team-crests/3fe3bf8f8b7c666e-96.webp",
    color: "#0b1b52",
  },
] as const;

export type TournamentSlug = (typeof TOURNAMENTS)[number]["slug"];

// Torneos con los que la CASA puede armar pollas. `worldcup_2026` queda fuera
// a propósito: sigue en TOURNAMENTS como metadata histórica para que las pollas
// terminadas resuelvan su nombre y su logo, pero no se puede elegir.
//
// Agregar un slug acá NO alcanza para que el torneo funcione: también necesita
// su id en RESULT_LEAGUES, su grupo en TOURNAMENT_GROUPS, sus fases en
// TOURNAMENT_STRUCTURE, su landing en TOURNAMENTS_SEO, su nombre genérico para
// iOS y un pase de scripts/bake-team-crests.mjs. Los tests
// `tournament-availability` y `football-media` fallan si falta alguno.
//
// (Ojo con el historial: entre el 2026-07-26 y el 2026-08-25 esta lista estuvo
// VACÍA como interruptor del modo "temporada cerrada". Eso se separó: hoy el
// estado de producto vive en `lib/closure.ts` y esta lista es solo un dato.)
export const CREATABLE_TOURNAMENT_SLUGS: readonly TournamentSlug[] = [
  "premier_2025",
  "laliga_2025",
  "seriea_2025",
  "bundesliga_2025",
  "ligue1_2025",
  "champions_2025",
  "europa_2026",
  "conference_2026",
  "eredivisie_2026",
  "primeira_2026",
  "libertadores_2026",
  "sudamericana_2026",
  "betplay_2026",
  "copacolombia_2026",
  "brasileirao_2026",
  "copadobrasil_2026",
  "ligaargentina_2026",
  "copaargentina_2026",
  "ligamx_2026",
  "mls_2026",
  "nationsleague_2026",
];

export const CREATABLE_TOURNAMENTS = TOURNAMENTS.filter((t) =>
  CREATABLE_TOURNAMENT_SLUGS.includes(t.slug),
);

/**
 * Los torneos que la casa puede usar, por región. Desde el 2026-09-18 son
 * veintiuno: una sola lista de botones era un muro de once filas donde había
 * que leerlos todos para encontrar uno. Agrupados se busca por región, que es
 * como los nombra la gente.
 *
 * El orden dentro de cada grupo es el de `TOURNAMENTS`. Un grupo con una
 * cantidad impar deja su último botón a lo ancho, para que la última fila se
 * lea como una decisión y no como un hueco (misma regla que la ventana de
 * fechas del selector de partidos).
 */
export const TOURNAMENT_GROUPS: ReadonlyArray<{ label: string; slugs: readonly string[] }> = [
  { label: "Colombia", slugs: ["betplay_2026", "copacolombia_2026"] },
  { label: "Copas de Europa", slugs: ["champions_2025", "europa_2026", "conference_2026", "nationsleague_2026"] },
  { label: "Ligas de Europa", slugs: ["premier_2025", "laliga_2025", "seriea_2025", "bundesliga_2025", "ligue1_2025", "eredivisie_2026", "primeira_2026"] },
  { label: "Sudamérica", slugs: ["libertadores_2026", "sudamericana_2026", "brasileirao_2026", "copadobrasil_2026", "ligaargentina_2026", "copaargentina_2026"] },
  { label: "Norteamérica", slugs: ["ligamx_2026", "mls_2026"] },
].map((group) => ({
  ...group,
  slugs: group.slugs.filter((slug) => (CREATABLE_TOURNAMENT_SLUGS as readonly string[]).includes(slug)),
})).filter((group) => group.slugs.length > 0);

export function isCreatableTournament(slug: string): boolean {
  return (CREATABLE_TOURNAMENT_SLUGS as readonly string[]).includes(slug);
}

// Torneos que se SINCRONIZAN automáticamente desde API-Football, la única
// fuente desde el 2026-09-13. Una liga que NO esté acá no se consulta en ningún
// sync automático (cron cada 2 h + refresco on-demand del panel).
//
// Se mantiene SEPARADO de CREATABLE_TOURNAMENT_SLUGS a propósito: podrías
// querer seguir sincronizando una liga para cerrar resultados de pollas ya
// terminadas sin permitir armar pollas nuevas con ella.
//
// El calendario se pide por liga (una solicitud por liga por vuelta), pero el
// feed de vivo y de resultados se pide por FECHA y filtra con RESULT_LEAGUES:
// por eso sumar torneos casi no mueve el consumo de cuota. Lo que sí se apretó
// es el recorrido del cron, que es serie dentro de los 60 s de Vercel (ver
// migración 141).
//
// Las llamadas EXPLÍCITAS por slug (admin manual / discover ?tournament=)
// NO pasan por este gate — son override deliberado con CRON_SECRET/admin.
export const SYNCABLE_TOURNAMENT_SLUGS: readonly string[] = [
  ...CREATABLE_TOURNAMENT_SLUGS,
];

export function isSyncableTournament(slug: string): boolean {
  return SYNCABLE_TOURNAMENT_SLUGS.includes(slug);
}

// Nombres localizados. Para EN: Champions/PL/Serie A son universales
// (no se traducen). Solo cambian Mundial→World Cup, Copa→Cup, Liga.
const TOURNAMENT_NAMES_EN: Record<string, string> = {
  champions_2025: "Champions League",
  europa_2026: "Europa League",
  worldcup_2026: "World Cup 2026",
  laliga_2025: "La Liga",
  premier_2025: "Premier League",
  seriea_2025: "Serie A",
  libertadores_2026: "Copa Libertadores",
  sudamericana_2026: "Copa Sudamericana",
  betplay_2026: "BetPlay League",
  bundesliga_2025: "Bundesliga",
  ligue1_2025: "Ligue 1",
  copacolombia_2026: "Colombia Cup",
  conference_2026: "Conference League",
  eredivisie_2026: "Eredivisie",
  primeira_2026: "Primeira Liga",
  brasileirao_2026: "Brasileirao",
  copadobrasil_2026: "Brazil Cup",
  ligaargentina_2026: "Argentine League",
  copaargentina_2026: "Argentina Cup",
  ligamx_2026: "Liga MX",
  mls_2026: "MLS",
  nationsleague_2026: "Nations League",
};

export function getTournamentBySlug(slug: string) {
  return TOURNAMENTS.find((t) => t.slug === slug);
}

export function getTournamentName(slug: string, locale: string = "es"): string {
  if (locale === "en") {
    return TOURNAMENT_NAMES_EN[slug] ?? getTournamentBySlug(slug)?.name ?? slug;
  }
  return getTournamentBySlug(slug)?.name ?? slug;
}

// Nombre corto para chips y listas donde el nombre completo no aporta. Es un
// mapa EXPLÍCITO y no un recorte de «Copa »/« League»: ese recorte convertía
// «Copa do Brasil» en «do Brasil» y dejaba «Copa Argentina» y «Liga Argentina»
// como «Argentina» y «Liga Argentina». Un torneo sin entrada acá conserva su
// nombre entero, que es el default correcto.
const TOURNAMENT_SHORT_NAMES: Record<string, string> = {
  champions_2025: "Champions",
  europa_2026: "Europa League",
  premier_2025: "Premier",
  libertadores_2026: "Libertadores",
  sudamericana_2026: "Sudamericana",
  betplay_2026: "BetPlay",
  worldcup_2026: "Mundial",
};

export function getTournamentShortName(slug: string, locale: string = "es"): string {
  const full = getTournamentName(slug, locale);
  if (locale === "en") return full;
  return TOURNAMENT_SHORT_NAMES[slug] ?? full;
}

export function getTournamentLogo(slug: string, size: "original" | "small" = "original"): string {
  const tournament = getTournamentBySlug(slug) ?? TOURNAMENTS[0];
  // Static 96 px assets cover a 32 px logo at 3x without Image Optimization.
  return (leagueLogos as Record<string,string>)[slug] ?? (size === "small" ? tournament.smallLogoPath : tournament.logoPath);
}

// Logos que el proveedor sirve en un tono oscuro y que sobre nuestras
// superficies casi no se ven. Comprobado mirando cada marca sobre #0e1420, no
// por su nombre: las monocromas se pasan a blanco y las que llevan color de
// marca solo se aclaran, para no perder su identidad.
const LOGOS_A_BLANCO = new Set([
  'ligue1_2025', 'sudamericana_2026', 'europa_2026',
  'conference_2026', 'eredivisie_2026',
]);
const LOGOS_A_ACLARAR = new Set([
  'betplay_2026', 'copadobrasil_2026', 'nationsleague_2026',
]);

/** Monochrome marks need their light treatment on our dark surfaces. */
export function getTournamentLogoClassName(slug: string): string {
  if (LOGOS_A_BLANCO.has(slug)) return 'brightness-0 invert';
  if (LOGOS_A_ACLARAR.has(slug)) return 'brightness-200';
  return '';
}

// Flat slug → icon-path map. Relocated from components/shared/PollaCard.tsx
// during Phase 3a so multiple UI surfaces can import without depending on a
// component file.
export const TOURNAMENT_ICONS: Record<string, string> = Object.fromEntries(
  TOURNAMENTS.map((tournament) => [tournament.slug, tournament.smallLogoPath]),
);
