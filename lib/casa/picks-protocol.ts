/** Wire values describe the submitted pick, never an inferred saved draft. */
export interface PickValues {
  pick1x2?: "L" | "E" | "V" | null;
  homeScore?: number | null;
  awayScore?: number | null;
  optionId?: string | null;
  freeText?: string | null;
  pointsEarned?: number | null;
}

export interface PickTarget extends PickValues {
  matchId?: string;
  questionId?: string;
}

export interface PickSaveOperation {
  requestId: string;
  expectedRevision: number;
  picks: PickTarget[];
  entryNumber?: number;
  entryId?: string;
}

export interface PickSaveAck {
  ok: true;
  requestId: string;
  revision: number;
  guardados: number;
  avisos: string[];
  results: Array<{ targetId: string; status: "saved" | "rejected"; values?: PickValues; error?: string }>;
}

export interface PickSaveState {
  entryId: string;
  ownerId: string;
  revision: number;
  picks: Record<string, PickValues>;
  lastResult: PickSaveAck | null;
}

export const targetId = (pick: PickTarget) => pick.matchId ?? pick.questionId!;

export function normalizedPick(pick: PickValues | undefined): PickValues {
  return {
    pick1x2: pick?.pick1x2 ?? null,
    homeScore: pick?.homeScore ?? null,
    awayScore: pick?.awayScore ?? null,
    optionId: pick?.optionId ?? null,
    freeText: pick?.freeText?.trim() || null,
  };
}

export function samePick(a: PickValues | undefined, b: PickValues | undefined) {
  return JSON.stringify(normalizedPick(a)) === JSON.stringify(normalizedPick(b));
}

export function isPickValues(value: unknown): value is PickValues {
  if (!value || typeof value !== "object") return false;
  const p = value as PickValues;
  return [null, undefined, "L", "E", "V"].includes(p.pick1x2)
    && [p.homeScore, p.awayScore].every(n => n == null || (Number.isInteger(n) && n >= 0 && n <= 30))
    && (p.optionId == null || (typeof p.optionId === "string" && p.optionId.length <= 36))
    && (p.freeText == null || (typeof p.freeText === "string" && p.freeText.length <= 120));
}

export function isPickSaveAck(value: unknown): value is PickSaveAck {
  if (!value || typeof value !== "object") return false;
  const a = value as PickSaveAck;
  return a.ok === true && typeof a.requestId === "string" && Number.isSafeInteger(a.revision) && a.revision >= 0
    && Number.isInteger(a.guardados) && a.guardados >= 0 && Array.isArray(a.avisos) && a.avisos.every(s => typeof s === "string")
    && Array.isArray(a.results) && a.results.length <= 60 && a.results.every(r =>
      r && typeof r.targetId === "string" && (r.status === "saved" ? isPickValues(r.values) : r.status === "rejected" && typeof r.error === "string"));
}

export function isPickSaveState(value: unknown): value is PickSaveState {
  if (!value || typeof value !== "object") return false;
  const s = value as PickSaveState;
  return typeof s.entryId === "string" && typeof s.ownerId === "string" && Number.isSafeInteger(s.revision) && s.revision >= 0 && Boolean(s.picks) && typeof s.picks === "object"
    && !Array.isArray(s.picks) && Object.values(s.picks).every(isPickValues)
    && (s.lastResult === null || isPickSaveAck(s.lastResult));
}

/** A saved ACK must cover each captured target once, with exactly its values. */
export function acknowledgesOperation(ack: PickSaveAck, operation: PickSaveOperation) {
  if (ack.requestId !== operation.requestId || ack.results.length !== operation.picks.length) return false;
  const seen = new Set<string>();
  for (const result of ack.results) {
    const sent = operation.picks.find(p => targetId(p) === result.targetId);
    if (!sent || seen.has(result.targetId) || (result.status === "saved" && !samePick(sent, result.values))) return false;
    seen.add(result.targetId);
  }
  return ack.guardados === ack.results.filter(r => r.status === "saved").length;
}

/** Keep newer edits while only advancing confirmed values for acknowledged targets. */
export function confirmedAfterAck(saved: Record<string, PickValues>, ack: PickSaveAck) {
  const next = { ...saved };
  for (const result of ack.results) if (result.status === "saved") next[result.targetId] = result.values!;
  return next;
}

/** Refresh untouched targets without losing edits the player actually made. */
export function rebasePickDraft(draft: Record<string, PickValues>, previous: Record<string, PickValues>, latest: Record<string, PickValues>, ids: string[]) {
  const next = { ...draft };
  for (const id of ids) if (samePick(draft[id], previous[id])) {
    if (latest[id]) next[id] = latest[id];
    else delete next[id];
  }
  return next;
}
