// lib/matches/override-resolution.ts — partidos con hora fijada por el admin
// (migración 118) que ya debieron terminar.
//
// Si API-Football no tiene el partido en la fecha fijada, el vivo no lo
// actualiza y nunca pasa a `finished`: /admin/discrepancias no lo mostraba y
// el endpoint de resolución lo rechazaba. Pasados 90 minutos + adición y
// descanso desde la hora fijada, el admin puede cerrar el marcador de los 90
// minutos a mano, con el mismo RPC de siempre.

/** Pitazo + 90' + descanso + adición generosa. */
export const OVERRIDE_MANUAL_RESULT_AFTER_MS = 125 * 60_000;

export interface OverrideResolutionFields {
  status: string;
  scheduled_at: string;
  schedule_override_at?: string | null;
  final_verified_at?: string | null;
}

/** ¿Se puede cerrar a mano aunque el partido no figure como finalizado? */
export function overrideReadyForManualResult(match: OverrideResolutionFields, now = Date.now()): boolean {
  if (match.final_verified_at || !match.schedule_override_at) return false;
  if (match.status === "cancelled") return false;
  const kickoff = Date.parse(match.scheduled_at);
  return Number.isFinite(kickoff) && now - kickoff >= OVERRIDE_MANUAL_RESULT_AFTER_MS;
}

/** Instante desde el que un partido con hora fijada aparece en la lista del admin. */
export function overrideResolutionCutoffIso(now = Date.now()): string {
  return new Date(now - OVERRIDE_MANUAL_RESULT_AFTER_MS).toISOString();
}
