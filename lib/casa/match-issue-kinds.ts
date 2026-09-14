// lib/casa/match-issue-kinds.ts — nombres y descripciones de los casos de
// partidos (migraciones 108 y 121). Sin dependencias de servidor: lo usan la
// pantalla /admin/issues, el correo de avisos y las pruebas.

import { formatColombiaDateTime } from "@/lib/time/colombia";

export type MatchIssueKind = "suspendido" | "aplazado" | "cancelado" | "abandonado" | "sin_datos";
/** `resuelto` solo existe para `sin_datos`: llegaron datos, se verificó o se puso el resultado manual. */
export type MatchIssueDecisionValue = "anular" | "mantener" | "resuelto";

export const MATCH_ISSUE_KIND_LABEL: Record<MatchIssueKind, string> = {
  suspendido: "Suspendido",
  aplazado: "Aplazado",
  cancelado: "Cancelado",
  abandonado: "Abandonado",
  sin_datos: "Sin datos del proveedor",
};

export function matchIssueKindLabel(kind: string): string {
  return MATCH_ISSUE_KIND_LABEL[kind as MatchIssueKind] ?? "Partido con novedades";
}

function validMinute(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 150;
}

/** "Qué pasó" en lenguaje simple, a partir del tipo de caso y el minuto observado. */
export function describeMatchIssue(kind: MatchIssueKind, elapsed: number | null | undefined): string {
  switch (kind) {
    case "suspendido":
      return validMinute(elapsed) ? `Suspendido en el minuto ${elapsed}` : "Suspendido";
    case "abandonado":
      return validMinute(elapsed) ? `Abandonado en el minuto ${elapsed}` : "Abandonado";
    case "aplazado":
      return "Aplazado";
    case "cancelado":
      return "Cancelado";
    case "sin_datos":
      return "Sin datos del proveedor";
    default:
      return "Partido con novedades";
  }
}

const KICKOFF_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/**
 * Inicio del partido. Confirmado: fecha y hora de Colombia. Provisional
 * (`scheduled_at_confirmed=false`, migración 103): el timestamp es solo una
 * fecha a medianoche UTC, así que se muestra esa fecha sin corrimiento y
 * «hora por confirmar».
 */
export function formatIssueKickoff(iso: string, confirmed: boolean | null | undefined): string {
  if (confirmed === false) {
    const date = new Intl.DateTimeFormat("es-CO", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(iso));
    return `${date}, hora por confirmar`;
  }
  return `${formatColombiaDateTime(iso, KICKOFF_OPTIONS)} (hora de Colombia)`;
}
