import { describe, expect, it } from "vitest";
import {
  OVERRIDE_MANUAL_RESULT_AFTER_MS,
  overrideReadyForManualResult,
  overrideResolutionCutoffIso,
} from "@/lib/matches/override-resolution";

const kickoff = "2026-09-17T01:20:00Z";
const at = (ms: number) => Date.parse(kickoff) + ms;

describe("manual result for a match with an admin-fixed kickoff (migration 118)", () => {
  const base = { status: "scheduled", scheduled_at: kickoff, schedule_override_at: kickoff, final_verified_at: null };

  it("opens only after the playing time has passed", () => {
    expect(overrideReadyForManualResult(base, at(OVERRIDE_MANUAL_RESULT_AFTER_MS - 1))).toBe(false);
    expect(overrideReadyForManualResult(base, at(OVERRIDE_MANUAL_RESULT_AFTER_MS))).toBe(true);
  });

  it("never applies without an override, once verified, or for a cancelled match", () => {
    const later = at(OVERRIDE_MANUAL_RESULT_AFTER_MS + 60_000);
    expect(overrideReadyForManualResult({ ...base, schedule_override_at: null }, later)).toBe(false);
    expect(overrideReadyForManualResult({ ...base, final_verified_at: "2026-09-17T04:00:00Z" }, later)).toBe(false);
    expect(overrideReadyForManualResult({ ...base, status: "cancelled" }, later)).toBe(false);
    expect(overrideReadyForManualResult({ ...base, scheduled_at: "not a date" }, later)).toBe(false);
  });

  it("lists matches whose kickoff is at or before the cutoff", () => {
    const now = at(OVERRIDE_MANUAL_RESULT_AFTER_MS);
    expect(overrideResolutionCutoffIso(now)).toBe(new Date(Date.parse(kickoff)).toISOString());
  });
});
