// lib/casa/picks-sections.ts — cómo se ordena la lista de partidos de una polla.
//
// (2026-09-18) Regla del dueño, y es la única: los partidos van SIEMPRE en
// orden de empezada — arriba el que arranca primero, abajo el que arranca de
// último — y no se mueven de lugar por ninguna otra razón.
//
// Antes (16-sep) la lista se partía en tres bloques por estado: Finalizados,
// En vivo y Próximos. Se veía ordenada, pero el orden CAMBIABA SOLO: cada vez
// que un partido arrancaba saltaba de bloque, así que quien había marcado el
// sábado encontraba otra lista el domingo. Un jugador lo reportó así: «ayer
// tenían un orden y hoy otro orden», y tenía razón — la lista es el mapa con
// el que la gente revisa sus pronósticos, y moverla les hace marcar el palo
// equivocado.
//
// El estado de cada partido (en vivo, final, anulado) se muestra DENTRO de su
// tarjeta, sin sacarlo de su lugar. Los encabezados de día solo separan; no
// reordenan, porque los días también van en orden de empezada.
//
// Funciones puras: se prueban en node sin React ni base de datos.

import { COLOMBIA_TIME_ZONE, colombiaDateKey } from "@/lib/time/colombia";

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

/**
 * Los partidos en orden de empezada, agrupados por día.
 *
 * Dos partidos a la misma hora conservan el orden en que vienen (el que la
 * casa definió al crear la polla): el sort es estable y el empate se resuelve
 * por la posición original, nunca por el estado ni por el nombre.
 */
export function groupCasaMatchesByDay<T extends SectionMatch>(matches: T[], now = Date.now()): Array<DayGroup<T>> {
  const enOrden = matches
    .map((match, index) => ({ match, index }))
    .sort((a, b) => (kickoff(a.match) - kickoff(b.match)) || (a.index - b.index))
    .map((fila) => fila.match);

  const groups = new Map<string, DayGroup<T>>();
  for (const match of enOrden) {
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
  return [...groups.values()];
}
