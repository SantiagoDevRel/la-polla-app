// lib/espn/labels-es.ts — Diccionario ES/EN estático para el conjunto FINITO
// de strings en inglés que devuelve ESPN (labels de estadísticas, tipos de
// evento del timeline, posiciones de los jugadores).
//
// 🔑 Free-tier: CERO API de traducción. El vocabulario de ESPN es un set
// cerrado y estable, así que un diccionario horneado alcanza y no cuesta nada.
// Si aparece un término nuevo no mapeado, cae al valor crudo (degrada a
// inglés, nunca queda en blanco).
//
// La traducción ocurre en RENDER (locale-aware) — NO en el fetch — porque el
// summary/roster de ESPN va cacheado COMPARTIDO entre todos los locales; no
// se puede hornear un idioma en el dato cacheado.
//
// Keys verificadas contra el Mundial 2026 real (ESPN fifa.world, 2026-06-12).

interface Label {
  es: string;
  /** Inglés "lindo" cuando el label crudo de ESPN viene feo (MAYÚSCULAS,
   *  abreviado). Si falta, se usa el fallback crudo. */
  en?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Estadísticas del boxscore. Keyeadas por el `name` ESTABLE de ESPN
// (possessionPct, foulsCommitted…) — más robusto que el `label`, que llega
// en MAYÚSCULAS raras ("SHOTS", "ON GOAL").
// ─────────────────────────────────────────────────────────────────────
const STAT_LABELS: Record<string, Label> = {
  possessionPct: { es: "Posesión" },
  foulsCommitted: { es: "Faltas" },
  yellowCards: { es: "Tarjetas amarillas" },
  redCards: { es: "Tarjetas rojas" },
  offsides: { es: "Fueras de lugar" },
  wonCorners: { es: "Tiros de esquina" },
  saves: { es: "Atajadas" },
  totalShots: { es: "Tiros", en: "Shots" },
  shotsOnTarget: { es: "Tiros al arco", en: "On target" },
  shotPct: { es: "% al arco", en: "On target %" },
  penaltyKickGoals: { es: "Goles de penal" },
  penaltyKickShots: { es: "Penales cobrados" },
  accuratePasses: { es: "Pases completados" },
  totalPasses: { es: "Pases" },
  passPct: { es: "% de pases" },
  accurateCrosses: { es: "Centros completados" },
  totalCrosses: { es: "Centros" },
  crossPct: { es: "% de centros" },
  totalLongBalls: { es: "Pases largos" },
  accurateLongBalls: { es: "Pases largos completados" },
  longballPct: { es: "% pases largos" },
  blockedShots: { es: "Tiros bloqueados" },
  effectiveTackles: { es: "Entradas efectivas" },
  totalTackles: { es: "Entradas" },
  tacklePct: { es: "% de entradas" },
  interceptions: { es: "Intercepciones" },
  effectiveClearance: { es: "Despejes efectivos" },
  totalClearance: { es: "Despejes" },
};

/**
 * Traduce el label de una estadística del boxscore.
 * @param key      `name` estable de ESPN (MatchStat.key).
 * @param fallback `label` crudo de ESPN, para cuando la key no está mapeada.
 */
export function statLabel(key: string, fallback: string, locale: string): string {
  const entry = STAT_LABELS[key];
  if (!entry) return fallback;
  return locale === "en" ? entry.en ?? fallback : entry.es;
}

// ─────────────────────────────────────────────────────────────────────
// Tipos de evento del timeline (keyEvents[].type.text).
// ─────────────────────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, Label> = {
  Goal: { es: "Gol", en: "Goal" },
  "Goal - Header": { es: "Gol de cabeza", en: "Header goal" },
  "Penalty - Scored": { es: "Gol de penal", en: "Penalty goal" },
  "Penalty - Missed": { es: "Penal fallado", en: "Penalty missed" },
  "Penalty - Saved": { es: "Penal atajado", en: "Penalty saved" },
  "Own Goal": { es: "Autogol", en: "Own goal" },
  "Yellow Card": { es: "Tarjeta amarilla", en: "Yellow card" },
  "Red Card": { es: "Tarjeta roja", en: "Red card" },
  "Yellow Red Card": { es: "Doble amarilla", en: "Second yellow" },
  "Second Yellow Card": { es: "Doble amarilla", en: "Second yellow" },
  Substitution: { es: "Cambio", en: "Substitution" },
  VAR: { es: "Revisión VAR", en: "VAR review" },
  "Var Decision": { es: "Revisión VAR", en: "VAR review" },
  "Goal Disallowed": { es: "Gol anulado", en: "Goal disallowed" },
  "Penalty Won": { es: "Penal a favor", en: "Penalty won" },
};

/** Etiqueta legible de un tipo de evento de ESPN. Desconocido → crudo. */
export function eventLabel(type: string, locale: string): string {
  const entry = EVENT_LABELS[type];
  if (!entry) return type;
  return locale === "en" ? entry.en ?? type : entry.es;
}

// ─────────────────────────────────────────────────────────────────────
// Posiciones de los jugadores. ESPN usa códigos genéricos en el roster
// (G/D/M/F) y detallados con sufijo de lado en las alineaciones del summary
// (CD-L, CM-R, CF-L…). Cubrimos ambos.
// ─────────────────────────────────────────────────────────────────────
const POSITION_LABELS: Record<string, Label> = {
  // Genéricas (endpoint de plantel /teams/{id}?enable=roster).
  G: { es: "Arquero", en: "Goalkeeper" },
  D: { es: "Defensa", en: "Defender" },
  M: { es: "Mediocampista", en: "Midfielder" },
  F: { es: "Delantero", en: "Forward" },
  // Detalladas (alineaciones del summary; el sufijo -L/-R se normaliza).
  CB: { es: "Defensa central", en: "Center back" },
  LB: { es: "Lateral izquierdo", en: "Left back" },
  RB: { es: "Lateral derecho", en: "Right back" },
  WB: { es: "Carrilero", en: "Wing back" },
  DM: { es: "Volante de marca", en: "Defensive mid" },
  CM: { es: "Mediocampista central", en: "Center mid" },
  AM: { es: "Volante ofensivo", en: "Attacking mid" },
  LM: { es: "Volante izquierdo", en: "Left mid" },
  RM: { es: "Volante derecho", en: "Right mid" },
  LW: { es: "Extremo izquierdo", en: "Left wing" },
  RW: { es: "Extremo derecho", en: "Right wing" },
  CF: { es: "Delantero centro", en: "Center forward" },
  ST: { es: "Delantero", en: "Striker" },
  SUB: { es: "Suplente", en: "Substitute" },
};

/**
 * Traduce la posición de un jugador. Acepta el código de ESPN (genérico o
 * detallado). Desconocido → crudo (nunca blanco). null → null.
 */
export function positionLabel(abbr: string | null | undefined, locale: string): string | null {
  if (!abbr) return null;
  // Normaliza el sufijo de lado ("CD-L" → "CD") y mapea "CD" (center
  // defender de ESPN) al genérico CB.
  const norm = abbr.toUpperCase().replace(/-[LR]$/, "");
  const key = norm === "CD" ? "CB" : norm;
  const entry = POSITION_LABELS[key];
  if (!entry) return abbr;
  return locale === "en" ? entry.en ?? abbr : entry.es;
}
