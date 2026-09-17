// lib/casa/live-status.ts — cómo se lee un pronóstico contra un marcador que
// todavía se está jugando. Funciones puras, sin DOM ni base: las usan la franja
// «En vivo» de /casa y las tarjetas de partido de la polla.

import { computeLiveMinute, formatLiveMinute, specialStatusLabel } from "@/lib/matches/live-minute";
import type { CasaScoringMode, Pick1x2 } from "./types";

export interface ScorePair {
  home: number | null;
  away: number | null;
}

export interface PickShape {
  pick1x2: Pick1x2 | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** L / E / V de un marcador cualquiera (parcial o final). null sin marcador. */
export function result1x2Of(home: number | null | undefined, away: number | null | undefined): Pick1x2 | null {
  if (home == null || away == null) return null;
  if (home > away) return "L";
  if (home < away) return "V";
  return "E";
}

/** La persona dejó un pronóstico completo para este modo. */
export function hasPick(mode: CasaScoringMode, pick: PickShape | null | undefined): boolean {
  if (!pick) return false;
  return mode === "1x2" ? pick.pick1x2 != null : pick.homeScore != null && pick.awayScore != null;
}

/**
 * ¿El pronóstico coincide con el marcador de este momento?
 *   · marcador: solo el exacto vale (regla de la casa desde el 2026-09-16).
 *   · 1x2: coincide el resultado.
 * null cuando no hay pronóstico o no hay marcador con qué comparar.
 */
export function pickOnTrack(mode: CasaScoringMode, pick: PickShape | null | undefined, score: ScorePair): boolean | null {
  if (!hasPick(mode, pick) || score.home == null || score.away == null) return null;
  if (mode === "1x2") return pick!.pick1x2 === result1x2Of(score.home, score.away);
  return pick!.homeScore === score.home && pick!.awayScore === score.away;
}

/** Nombre corto para chips: sin sufijos societarios. «United» y «Club» se quedan. */
export function shortTeam(name: string): string {
  return name.replace(/\s+(FC|CF|AFC|SC|AC|SAD)$/i, "").replace(/^(FC|CF|AFC|SC|AC)\s+/i, "").trim();
}

/** «2-1» en modo marcador; el equipo elegido o «Empate» en 1X2. null sin pronóstico. */
export function pickLabel(mode: CasaScoringMode, pick: PickShape | null | undefined, homeTeam: string, awayTeam: string): string | null {
  if (!hasPick(mode, pick)) return null;
  if (mode === "marcador") return `${pick!.homeScore}-${pick!.awayScore}`;
  return pick!.pick1x2 === "L" ? shortTeam(homeTeam) : pick!.pick1x2 === "V" ? shortTeam(awayTeam) : "Empate";
}

export interface LiveClock {
  scheduled_at: string;
  elapsed?: number | null;
  live_status_detail?: string | null;
}

/** «34'», «Descanso», «90+'»… o "" si no hay dato. Misma fuente que el resto de la app. */
export function liveMinuteLabel(match: LiveClock): string {
  const special = specialStatusLabel(match.live_status_detail);
  if (special) return special;
  return formatLiveMinute(computeLiveMinute(match.scheduled_at, match.elapsed)) ?? "";
}
