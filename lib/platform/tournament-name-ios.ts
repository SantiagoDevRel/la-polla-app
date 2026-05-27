// lib/platform/tournament-name-ios.ts
//
// Nombres genéricos descriptivos de torneos para mostrar dentro de la
// app iOS. Apple App Review 4.1(a)/5.2.1 marca "references to third-party
// leagues" como contenido infractor — los nombres oficiales son
// trademarks (Champions League, La Liga, Premier League, Serie A,
// Liga BetPlay, Copa Libertadores, Copa Sudamericana).
//
// Para la app iOS, mostramos un nombre descriptivo sin trademark.
// Para web y Android, se sigue usando el nombre normal de
// `lib/tournaments.ts` (sin cambios).

const IOS_NAMES: Record<string, string> = {
  // "Mundial" sigue siendo defendible (palabra genérica española = "torneo
  // mundial") pero Apple flagged the FIFA World Cup fixture schedule as
  // FIFA content. Cambio a un descriptor neutro de "selecciones nacionales
  // jugando en junio 2026" sin invocar la marca FIFA World Cup.
  worldcup_2026: "Torneo de Selecciones 2026",
  champions_2025: "Copa de Europa",
  laliga_2025: "Liga de España",
  premier_2025: "Liga de Inglaterra",
  seriea_2025: "Liga de Italia",
  libertadores_2026: "Copa Sur · Primera",
  sudamericana_2026: "Copa Sur · Segunda",
  betplay_2026: "Liga de Colombia",
};

/**
 * Devuelve el nombre genérico para mostrar en iOS. Si el slug no tiene
 * un nombre iOS definido, cae al `fallback` (el nombre normal).
 */
export function getIOSTournamentName(slug: string, fallback: string): string {
  return IOS_NAMES[slug] ?? fallback;
}
