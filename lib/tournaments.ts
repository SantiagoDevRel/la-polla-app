// lib/tournaments.ts — Single source of truth for tournament metadata
// Logo paths must match exact filenames in /public/tournaments/

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
    color: "#1a1aff",
  },
  {
    slug: "worldcup_2026",
    name: "Mundial 2026",
    apiCode: "WC",
    logoPath: `/tournaments/mundial-2026.webp?v=${LOGO_V}`,
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
    logoPath: `/tournaments/copa_libertadores.svg?v=${LOGO_V}`,
    color: "#005f8e",
  },
  {
    slug: "sudamericana_2026",
    name: "Copa Sudamericana",
    apiCode: "CSU",
    logoPath: `/tournaments/copa_sudamericana.svg?v=${LOGO_V}`,
    color: "#e9242a",
  },
  {
    slug: "betplay_2026",
    name: "Liga BetPlay",
    apiCode: "BP",
    logoPath: `/tournaments/liga_betplay.svg?v=${LOGO_V}`,
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
    color: "#d20515",
  },
  {
    slug: "ligue1_2025",
    name: "Ligue 1",
    apiCode: "FL1",
    logoPath: `/tournaments/ligue_1.svg?v=${LOGO_V}`,
    color: "#dae025",
  },
] as const;

export type TournamentSlug = (typeof TOURNAMENTS)[number]["slug"];

// Torneos disponibles para CREAR pollas nuevas. Post-Mundial 2026 dejamos
// SOLO el Mundial vivo (2026-06-09): las 17 pollas activas son todas
// worldcup_2026 y las demás ligas (Champions/BetPlay/Libertadores/
// Sudamericana) solo aparecen en pollas ya terminadas. El resto del array
// TOURNAMENTS se mantiene como metadata histórica para que esas pollas
// ended sigan resolviendo nombre/logo — pero no se pueden elegir al crear.
// Para reactivar una liga (ej. cuando vuelva la temporada), agregá su slug
// a esta lista. No hace falta tocar nada más.
//
// 2026-07-26 — TEMPORADA CERRADA: el Mundial terminó el 19-jul y no queda
// ningún torneo con partidos futuros en la DB (0 filas con scheduled_at >
// now(), 62/62 pollas en status='ended'). La lista queda VACÍA a
// propósito: es el interruptor único del modo cierre (ver lib/closure.ts).
// Con la lista vacía → banner de cierre en toda la app, /pollas/crear
// muestra el estado de cierre y POST /api/pollas rechaza con 403.
// Para REABRIR: descomentá/agregá el slug del torneo que vuelva y listo.
export const CREATABLE_TOURNAMENT_SLUGS: readonly TournamentSlug[] = [
  "premier_2025",
  "laliga_2025",
  "seriea_2025",
  "bundesliga_2025",
  "ligue1_2025",
  "champions_2025",
  "libertadores_2026",
  "betplay_2026",
];

export const CREATABLE_TOURNAMENTS = TOURNAMENTS.filter((t) =>
  CREATABLE_TOURNAMENT_SLUGS.includes(t.slug),
);

export function isCreatableTournament(slug: string): boolean {
  return (CREATABLE_TOURNAMENT_SLUGS as readonly string[]).includes(slug);
}

// Torneos que se SINCRONIZAN automáticamente (fetch de fixtures/scores
// desde los providers: football-data, ESPN, api-football). Una liga que
// NO esté acá no se consulta en ningún sync automático (cron + lazy
// ensure-fresh), para no quemar cuota free-tier en ligas sin pollas
// activas. Post-Mundial 2026 (2026-06-09) = solo el Mundial.
//
// Se mantiene SEPARADO de CREATABLE_TOURNAMENT_SLUGS a propósito: podrías
// querer seguir sincronizando una liga para cerrar resultados de pollas
// ended sin permitir crear pollas nuevas de ella. Hoy ambos = worldcup.
// Las llamadas EXPLÍCITAS por slug (admin manual / discover ?tournament=)
// NO pasan por este gate — son override deliberado con CRON_SECRET/admin.
//
// 2026-07-26 — TEMPORADA CERRADA: lista vacía. Con el Mundial terminado no
// queda un solo partido futuro que sincronizar, así que los crons dejan de
// pegarle a football-data / ESPN / api-football (cuota free-tier intacta).
// Todos los usos son gates (`filter` / `continue` / early-return), así que
// vaciarla convierte cada sync automático en no-op sin romper nada.
// El path EXPLÍCITO por slug (admin manual, discover ?tournament= con
// CRON_SECRET) NO pasa por este gate: si necesitás resincronizar algo
// puntual, sigue funcionando sin tocar esta lista.
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
  worldcup_2026: "World Cup 2026",
  laliga_2025: "La Liga",
  premier_2025: "Premier League",
  seriea_2025: "Serie A",
  libertadores_2026: "Copa Libertadores",
  sudamericana_2026: "Copa Sudamericana",
  betplay_2026: "BetPlay League",
  bundesliga_2025: "Bundesliga",
  ligue1_2025: "Ligue 1",
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

export function getTournamentLogo(slug: string): string {
  return getTournamentBySlug(slug)?.logoPath || `/tournaments/champions_league.svg?v=${LOGO_V}`;
}

// Flat slug → icon-path map. Relocated from components/shared/PollaCard.tsx
// during Phase 3a so multiple UI surfaces can import without depending on a
// component file.
export const TOURNAMENT_ICONS: Record<string, string> = {
  champions_2025: `/tournaments/champions_league.svg?v=${LOGO_V}`,
  worldcup_2026: `/tournaments/mundial-2026.webp?v=${LOGO_V}`,
  laliga_2025: `/tournaments/la_liga.png?v=${LOGO_V}`,
  premier_2025: `/tournaments/premier_league.webp?v=${LOGO_V}`,
  seriea_2025: `/tournaments/seria_a.png?v=${LOGO_V}`,
  libertadores_2026: `/tournaments/copa_libertadores.svg?v=${LOGO_V}`,
  sudamericana_2026: `/tournaments/copa_sudamericana.svg?v=${LOGO_V}`,
  betplay_2026: `/tournaments/liga_betplay.svg?v=${LOGO_V}`,
  bundesliga_2025: `/tournaments/bundesliga.svg?v=${LOGO_V}`,
  ligue1_2025: `/tournaments/ligue_1.svg?v=${LOGO_V}`,
};
