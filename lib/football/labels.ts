// lib/football/labels.ts — Diccionario ES/EN estático para el conjunto FINITO
// de términos en inglés del detalle de partido: estadísticas, tipos de evento
// del timeline y posiciones de los jugadores.
//
// Movido desde lib/espn/labels-es.ts (2026-09-13): API-Football es la única
// fuente y lib/api-football/detail-model.ts ya normaliza sus eventos y
// estadísticas a estas mismas claves. Las claves históricas se conservan.
//
// Free-tier: cero API de traducción. Si aparece un término no mapeado, cae
// al valor crudo (degrada a inglés, nunca queda en blanco). La traducción
// ocurre en RENDER (según el idioma) porque el detalle se cachea compartido
// entre idiomas.

interface Label {
  es: string;
  /** Inglés legible cuando el término crudo viene abreviado o en mayúsculas. */
  en?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Estadísticas. Clave estable (possessionPct, foulsCommitted…); ver STAT_KEYS
// en lib/api-football/detail-model.ts.
// ─────────────────────────────────────────────────────────────────────
const STAT_LABELS: Record<string, Label> = {
  "Free Kicks": { es: "Tiros libres", en: "Free kicks" },
  goals_prevented: { es: "Goles evitados", en: "Goals prevented" },
  shotsOffTarget: { es: "Tiros desviados", en: "Shots off target" },
  shotsInsideBox: { es: "Tiros dentro del área", en: "Shots inside the box" },
  shotsOutsideBox: { es: "Tiros fuera del área", en: "Shots outside the box" },
  expectedGoals: { es: "Goles esperados", en: "Expected goals" },
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
 * Traduce la etiqueta de una estadística.
 * @param key      clave estable (MatchStat.key).
 * @param fallback etiqueta cruda, para cuando la clave no está mapeada.
 */
export function statLabel(key: string, fallback: string, locale: string): string {
  const entry = STAT_LABELS[key];
  if (!entry) return fallback;
  return locale === "en" ? entry.en ?? fallback : entry.es;
}

// ─────────────────────────────────────────────────────────────────────
// Tipos de evento del timeline. Clave en minúsculas: API-Football no es
// consistente con las mayúsculas ("Red Card" / "Second Yellow card").
// ─────────────────────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, Label> = {
  goal: { es: "Gol", en: "Goal" },
  "goal - header": { es: "Gol de cabeza", en: "Header goal" },
  "penalty - scored": { es: "Gol de penal", en: "Penalty goal" },
  "penalty - missed": { es: "Penal fallado", en: "Penalty missed" },
  "penalty - saved": { es: "Penal atajado", en: "Penalty saved" },
  "own goal": { es: "Autogol", en: "Own goal" },
  "yellow card": { es: "Tarjeta amarilla", en: "Yellow card" },
  "red card": { es: "Tarjeta roja", en: "Red card" },
  "yellow red card": { es: "Doble amarilla", en: "Second yellow" },
  "second yellow card": { es: "Doble amarilla", en: "Second yellow" },
  substitution: { es: "Cambio", en: "Substitution" },
  var: { es: "Revisión VAR", en: "VAR review" },
  "var decision": { es: "Revisión VAR", en: "VAR review" },
  "goal disallowed": { es: "Gol anulado", en: "Goal disallowed" },
  "penalty won": { es: "Penal a favor", en: "Penalty won" },
};

/** Etiqueta legible de un tipo de evento. Desconocido → crudo. */
export function eventLabel(type: string, locale: string): string {
  const entry = EVENT_LABELS[type.toLowerCase()];
  if (!entry) return type;
  return locale === "en" ? entry.en ?? type : entry.es;
}

// ─────────────────────────────────────────────────────────────────────
// Posiciones. Códigos genéricos (G/D/M/F: alineaciones de API-Football y
// planteles) y detallados con sufijo de lado (CD-L, CM-R…: planteles
// horneados del Mundial).
// ─────────────────────────────────────────────────────────────────────
const POSITION_LABELS: Record<string, Label> = {
  G: { es: "Arquero", en: "Goalkeeper" },
  D: { es: "Defensa", en: "Defender" },
  M: { es: "Mediocampista", en: "Midfielder" },
  F: { es: "Delantero", en: "Forward" },
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
 * Traduce la posición de un jugador (código genérico o detallado).
 * Desconocido → crudo (nunca blanco). null → null.
 */
export function positionLabel(abbr: string | null | undefined, locale: string): string | null {
  if (!abbr) return null;
  // Normaliza el sufijo de lado ("CD-L" → "CD") y mapea "CD" al genérico CB.
  const norm = abbr.toUpperCase().replace(/-[LR]$/, "");
  const key = norm === "CD" ? "CB" : norm;
  const entry = POSITION_LABELS[key];
  if (!entry) return abbr;
  return locale === "en" ? entry.en ?? abbr : entry.es;
}
