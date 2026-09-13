// lib/football/summary.ts — Forma normalizada del detalle de UN partido
// (timeline, estadísticas y alineaciones) que consume la UI.
//
// Vivía en lib/espn/summary.ts cuando ESPN alimentaba el detalle. Desde el
// 2026-09-13 la única fuente es API-Football (lib/api-football/detail-model.ts
// la produce), así que los tipos viven acá, sin depender de ningún proveedor.
// Solo tipos: cero runtime, seguro para componentes cliente.

export type MatchSide = "home" | "away" | "neutral";

export interface TimelineEvent {
  /** "9′", "45+2′", "" (sin minuto). */
  minute: string;
  /** "Goal", "Yellow Card", "Substitution"… (clave de lib/football/labels.ts). */
  type: string;
  side: MatchSide;
  isGoal: boolean;
  scorer: string | null;
  assist: string | null;
  /** Jugador principal del evento (amonestado, sustituido…) cuando no es gol. */
  player: string | null;
  /** Descripción corta (p. ej. "Entra → Sale" en los cambios). */
  text: string;
}

export interface MatchStat {
  /** Clave estable (possessionPct, totalShots…) para traducir la etiqueta. */
  key: string;
  /** Etiqueta cruda del proveedor, usada si la clave no está traducida. */
  label: string;
  home: string;
  away: string;
}

export interface LineupPlayer {
  name: string;
  jersey: string | null;
  pos: string | null;
  starter: boolean;
  headshot: string | null;
  /** Club del jugador (o el equipo de la alineación); null si no se conoce. */
  club: string | null;
}

export interface Lineup {
  side: MatchSide;
  team: string;
  formation: string | null;
  players: LineupPlayer[];
}

export interface MatchSummary {
  timeline: TimelineEvent[];
  stats: MatchStat[];
  lineups: Lineup[];
}
