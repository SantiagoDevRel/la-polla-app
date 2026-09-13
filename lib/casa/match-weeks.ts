// lib/casa/match-weeks.ts — semanas y búsqueda por equipo del selector de
// partidos de /admin/pollas/crear.
//
// Funciones puras, sin React. Las semanas van de lunes a domingo y se arman
// sobre la misma clave de día que los encabezados del formulario: un partido
// con hora confirmada cuenta en su día de Colombia y uno con hora por
// confirmar, en su fecha UTC. La zona horaria del equipo nunca interviene.

import { colombiaDateKey, formatColombiaDateTime } from "@/lib/time/colombia";
import { teamNameKey } from "@/lib/teams/team-name-key";

export interface KickoffFields {
  scheduled_at: string;
  scheduled_at_confirmed?: boolean;
}

export interface TeamFields {
  home_team: string;
  away_team: string;
}

export type WeekRelation = "current" | "next" | "other";

export interface WeekBounds {
  /** Lunes de la semana, YYYY-MM-DD. */
  startKey: string;
  /** Domingo de la semana, YYYY-MM-DD. */
  endKey: string;
  relation: WeekRelation;
}

export interface MatchWeek<T> extends WeekBounds {
  /** Igual a `startKey`: identifica la misma semana en cualquier torneo o rango. */
  key: string;
  days: { key: string; list: T[] }[];
}

/**
 * Día del encabezado. Un partido con hora confirmada se agrupa por su día en
 * Colombia; uno con hora por confirmar guarda solo la fecha (medianoche UTC,
 * migración 103), así que se lee en UTC para no correrlo al día anterior.
 */
export function matchDayKey(match: KickoffFields): string {
  return match.scheduled_at_confirmed === false
    ? new Date(match.scheduled_at).toISOString().slice(0, 10)
    : colombiaDateKey(match.scheduled_at);
}

// Una clave YYYY-MM-DD es un día calendario, no un instante: se opera en UTC
// al mediodía para que ningún cambio de horario la mueva de día.
function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Lunes de la semana (lunes a domingo) que contiene el día. */
export function mondayKey(dayKey: string): string {
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return shiftDayKey(dayKey, -((weekday + 6) % 7));
}

/** Semana actual o siguiente respecto de `todayKey` (día de Colombia). */
export function weekRelation(startKey: string, todayKey: string): WeekRelation {
  const current = mondayKey(todayKey);
  if (startKey === current) return "current";
  return startKey === shiftDayKey(current, 7) ? "next" : "other";
}

/** Confirmados primero y por hora de inicio; al final, los de hora por confirmar. */
function byKickoff(a: KickoffFields, b: KickoffFields): number {
  return (
    Number(a.scheduled_at_confirmed === false) - Number(b.scheduled_at_confirmed === false) ||
    Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)
  );
}

/** Semanas en orden, cada una con sus días en orden. No modifica `matches`. */
export function groupMatchesByWeek<T extends KickoffFields>(
  matches: readonly T[],
  dayKeyOf: (match: T) => string,
  todayKey: string,
): MatchWeek<T>[] {
  const days = new Map<string, T[]>();
  for (const match of matches) {
    const key = dayKeyOf(match);
    const list = days.get(key);
    if (list) list.push(match);
    else days.set(key, [match]);
  }

  const weeks: MatchWeek<T>[] = [];
  const ordered = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, list] of ordered) {
    const startKey = mondayKey(key);
    let week: MatchWeek<T> | undefined = weeks[weeks.length - 1];
    if (!week || week.key !== startKey) {
      week = {
        key: startKey,
        startKey,
        endKey: shiftDayKey(startKey, 6),
        relation: weekRelation(startKey, todayKey),
        days: [],
      };
      weeks.push(week);
    }
    week.days.push({ key, list: list.sort(byKickoff) });
  }
  return weeks;
}

function dayParts(dayKey: string) {
  // Mediodía de Colombia: el mismo día calendario sin importar la zona.
  const noon = `${dayKey}T12:00:00-05:00`;
  return {
    day: formatColombiaDateTime(noon, { day: "numeric" }),
    month: formatColombiaDateTime(noon, { month: "long" }),
    year: formatColombiaDateTime(noon, { year: "numeric" }),
  };
}

/**
 * "14 al 20 de septiembre", "28 de septiembre al 4 de octubre" y, solo si la
 * semana cambia de año, "28 de diciembre de 2026 al 3 de enero de 2027".
 */
export function weekRange({ startKey, endKey }: Pick<WeekBounds, "startKey" | "endKey">): string {
  const start = dayParts(startKey);
  const end = dayParts(endKey);
  if (start.year !== end.year) {
    return `${start.day} de ${start.month} de ${start.year} al ${end.day} de ${end.month} de ${end.year}`;
  }
  return start.month === end.month
    ? `${start.day} al ${end.day} de ${end.month}`
    : `${start.day} de ${start.month} al ${end.day} de ${end.month}`;
}

export function weekTitle(week: WeekBounds): string {
  if (week.relation === "current") return "Esta semana";
  if (week.relation === "next") return "Próxima semana";
  return `Semana del ${weekRange(week)}`;
}

export function matchCountLabel(count: number): string {
  return `${count} ${count === 1 ? "partido" : "partidos"}`;
}

export function selectedCountLabel(count: number): string {
  return `${count} ${count === 1 ? "elegido" : "elegidos"}`;
}

/**
 * Segunda línea del resumen de una semana. Esta y la próxima semana repiten
 * el rango porque su título no lo dice; los elegidos solo aparecen si hay.
 */
export function weekDetail(week: WeekBounds, matchCount: number, selectedCount: number): string {
  return [
    week.relation === "other" ? null : weekRange(week),
    matchCountLabel(matchCount),
    selectedCount > 0 ? selectedCountLabel(selectedCount) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Local o visitante contiene la búsqueda, sin tildes ni mayúsculas. Vacía = todos. */
export function matchesTeamQuery(match: TeamFields, query: string): boolean {
  const needle = teamNameKey(query);
  return (
    !needle ||
    teamNameKey(match.home_team).includes(needle) ||
    teamNameKey(match.away_team).includes(needle)
  );
}

/** "3 partidos de «Nacional»". */
export function teamQueryStatus(count: number, query: string): string {
  return `${matchCountLabel(count)} de «${query.trim()}»`;
}
