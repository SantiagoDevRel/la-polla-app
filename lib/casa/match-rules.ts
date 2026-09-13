import type { CasaPollaStatus } from "./types";

export const CASA_MATCH_LOCK_MS = 5 * 60_000;

export interface CasaMatchTiming {
  scheduled_at: string;
  status?: string;
  elapsed?: number | null;
  live_status_detail?: string | null;
  final_verified_at?: string | null;
  voided_at?: string | null;
}

/** Passing the scheduled time alone never proves that a delayed match started. */
export function hasCasaMatchStarted(match: CasaMatchTiming, now = Date.now()) {
  if (match.voided_at) return true;
  if (["STATUS_SUSPENDED", "SUSPENDED", "SUSP", "STATUS_INTERRUPTED", "INTERRUPTED", "INT"].includes((match.live_status_detail ?? "").toUpperCase()) && !(match.elapsed && match.elapsed > 0)) return false;
  return new Date(match.scheduled_at).getTime() <= now &&
    (match.status === "live" || match.status === "finished" ||
      (match.status === "cancelled" && (match.elapsed ?? 0) > 0));
}

/**
 * Mirrors casa_guard_pick_lifecycle (migration 107). A postponed fixture keeps
 * status "cancelled" after being rescheduled, so it stays editable while it
 * never started; the five-minute lock still applies to its new time.
 */
export function canEditCasaMatch(match: CasaMatchTiming, now = Date.now()) {
  const notStarted = match.status === "scheduled" ||
    (match.status === "cancelled" && (match.elapsed ?? 0) === 0);
  return !match.voided_at && !match.final_verified_at && notStarted &&
    new Date(match.scheduled_at).getTime() - CASA_MATCH_LOCK_MS > now;
}

export function acceptsCasaMatchPicks(status: CasaPollaStatus, drawPending?: boolean) {
  return !drawPending && (status === "abierta" || status === "cerrada");
}
