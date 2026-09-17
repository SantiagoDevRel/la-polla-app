// lib/casa/picks-sections.ts — cómo se ordena la lista de partidos de una polla.
//
// (2026-09-16) Pedido del dueño: volver al recorrido de la polla vieja, que era
// más fácil de entender. Tres bloques, en orden de tiempo:
//   · Finalizados — desplegable CERRADO, del más reciente al más viejo.
//   · En vivo     — se están jugando (o cierran en menos de 5 minutos): ya no
//                   se pueden cambiar, pero es lo que la gente quiere mirar.
//   · Próximos    — por día, cada día abierto, donde se pronostica.
//
// Funciones puras: se prueban en node sin React ni base de datos.

import { COLOMBIA_TIME_ZONE, colombiaDateKey } from "@/lib/time/colombia";
import { canEditCasaMatch, hasCasaMatchStarted } from "./match-rules";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** «mar 22 sep»: Intl en es-CO devuelve «mar, 22 de sept», que no cabe ni se lee igual. */
function shortDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric", month: "numeric" }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return `${DIAS[weekday] ?? ""} ${get("day")} ${MESES[Number(get("month")) - 1] ?? ""}`.trim();
}

export interface SectionMatch {
  id: string;
  scheduled_at: string;
  scheduled_at_confirmed?: boolean;
  status: string;
  elapsed?: number | null;
  live_status_detail?: string | null;
  final_verified_at: string | null;
  voided_at?: string | null;
}

export interface DayGroup<T> {
  /** Clave estable del día (YYYY-MM-DD en Colombia, o «tbd-…» sin hora confirmada). */
  key: string;
  label: string;
  matches: T[];
}

export interface MatchSections<T> {
  finished: T[];
  live: T[];
  upcoming: Array<DayGroup<T>>;
}

/** Terminó para efectos de la polla: verificado, anulado o el proveedor dio el final. */
export function isSectionFinished(match: SectionMatch): boolean {
  return Boolean(match.final_verified_at || match.voided_at || match.status === "finished");
}

const kickoff = (match: SectionMatch) => new Date(match.scheduled_at).getTime();

/** «Hoy», «Mañana» o «sáb 20 sep», siempre en hora de Colombia. */
export function dayLabel(iso: string, now = Date.now()): string {
  const key = colombiaDateKey(iso);
  if (key === colombiaDateKey(new Date(now))) return "Hoy";
  if (key === colombiaDateKey(new Date(now + 86_400_000))) return "Mañana";
  return shortDay(iso, COLOMBIA_TIME_ZONE);
}

export function partitionCasaMatches<T extends SectionMatch>(matches: T[], now = Date.now()): MatchSections<T> {
  const finished: T[] = [];
  const live: T[] = [];
  const upcoming: T[] = [];
  for (const match of matches) {
    if (isSectionFinished(match)) finished.push(match);
    // Empezó según el proveedor, o cierra ya (5 min) sin estar verificado: se
    // mira, no se edita. Los reprogramados sin minutos siguen editables.
    else if (hasCasaMatchStarted(match, now) || !canEditCasaMatch(match, now)) live.push(match);
    else upcoming.push(match);
  }
  finished.sort((a, b) => kickoff(b) - kickoff(a));
  live.sort((a, b) => kickoff(a) - kickoff(b));
  upcoming.sort((a, b) => kickoff(a) - kickoff(b));

  const groups = new Map<string, DayGroup<T>>();
  for (const match of upcoming) {
    const confirmed = match.scheduled_at_confirmed !== false;
    const key = confirmed ? colombiaDateKey(match.scheduled_at) : `tbd-${match.scheduled_at.slice(0, 10)}`;
    const group = groups.get(key) ?? {
      key,
      // Sin hora confirmada la fecha es la civil UTC del proveedor (regla del repo): sin corrimiento.
      label: confirmed ? dayLabel(match.scheduled_at, now) : `${shortDay(match.scheduled_at, "UTC")} · hora por confirmar`,
      matches: [],
    };
    group.matches.push(match);
    groups.set(key, group);
  }
  return { finished, live, upcoming: [...groups.values()] };
}
