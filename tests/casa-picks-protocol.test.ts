import { describe, expect, it } from "vitest";
import { acknowledgesOperation, confirmedAfterAck, isPickSaveAck, rebasePickDraft, samePick, type PickSaveAck, type PickSaveOperation } from "@/lib/casa/picks-protocol";

const operation: PickSaveOperation = { requestId: "operation-a", expectedRevision: 0, picks: [
  { matchId: "open", homeScore: 2, awayScore: 1 }, { matchId: "closed", homeScore: 3, awayScore: 0 },
] };
const ack: PickSaveAck = { ok: true, requestId: "operation-a", revision: 1, guardados: 1, avisos: ["Closed"], results: [
  { targetId: "open", status: "saved", values: { homeScore: 2, awayScore: 1 } },
  { targetId: "closed", status: "rejected", error: "Closed" },
] };

describe("authoritative pick confirmations", () => {
  it("refreshes untouched Y after another device saves while retaining the player's edited X", () => {
    const previous = { x: { homeScore: 0, awayScore: 0 }, y: { homeScore: 1, awayScore: 0 } };
    const draft = { ...previous, x: { homeScore: 3, awayScore: 1 } };
    const latest = { ...previous, y: { homeScore: 2, awayScore: 0 } };
    const rebased = rebasePickDraft(draft, previous, latest, ["x", "y"]);
    expect(rebased).toEqual({ x: draft.x, y: latest.y });
    expect(Object.keys(rebased).filter(id => !samePick(rebased[id as keyof typeof rebased], latest[id as keyof typeof latest]))).toEqual(["x"]);
  });
  it("never confirms a skipped target or malformed success", () => {
    expect(isPickSaveAck({ ok: true })).toBe(false);
    expect(acknowledgesOperation({ ...ack, results: ack.results.slice(0, 1) }, operation)).toBe(false);
    expect(acknowledgesOperation({ ...ack, results: [ack.results[0], ack.results[0]] }, operation)).toBe(false);
    expect(acknowledgesOperation({ ...ack, requestId: "another" }, operation)).toBe(false);
    expect(acknowledgesOperation(ack, operation)).toBe(true);
  });
  it("keeps closed targets pending and newer B edits dirty after A confirms", () => {
    const saved = confirmedAfterAck({}, ack);
    expect(saved).toEqual({ open: { homeScore: 2, awayScore: 1 } });
    expect(samePick({ homeScore: 3, awayScore: 0 }, saved.open)).toBe(false);
    expect(samePick(operation.picks[1], saved.closed)).toBe(false);
  });
  it("rejects different stored scores even when the request ID matches", () => {
    expect(acknowledgesOperation({ ...ack, results: [{ ...ack.results[0], values: { homeScore: 1, awayScore: 2 } }, ack.results[1]] }, operation)).toBe(false);
    expect(samePick({ freeText: "  Equipo A  " }, { freeText: "Equipo A" })).toBe(true);
  });
});
