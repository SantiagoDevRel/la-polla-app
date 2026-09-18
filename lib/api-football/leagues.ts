/** Shared league identities for runtime data and the local media catalog. */
export const RESULT_LEAGUES: Record<string, number> = {
  betplay_2026: 239, copacolombia_2026: 241,
  libertadores_2026: 13, sudamericana_2026: 11,
  champions_2025: 2, europa_2026: 3, conference_2026: 848,
  premier_2025: 39, ligue1_2025: 61, bundesliga_2025: 78,
  laliga_2025: 140, seriea_2025: 135,
  eredivisie_2026: 88, primeira_2026: 94,
  brasileirao_2026: 71, copadobrasil_2026: 73,
  ligaargentina_2026: 128, copaargentina_2026: 130,
  ligamx_2026: 262, mls_2026: 253,
  nationsleague_2026: 5,
};

/**
 * Ligas cuyo nombre de ronda necesita saber DE QUÉ liga viene para no ser
 * ambiguo (ver `classifyRound`). Una ronda «Play-offs» es una fase real en la
 * Copa Colombia y una previa que no guardamos en la UEFA; «3» solo es una
 * jornada en la Nations League.
 */
export const AF_LEAGUE_COPA_COLOMBIA = 241;
export const AF_LEAGUE_NATIONS = 5;
