import { describe, expect, it } from "vitest";
import { canEditCasaMatch, hasCasaMatchStarted, acceptsCasaMatchPicks } from "@/lib/casa/match-rules";

const now = Date.parse("2026-09-13T18:00:00Z");
const scheduled = (minutes: number, status = "scheduled") => ({ scheduled_at: new Date(now + minutes * 60_000).toISOString(), status });

describe("Casa match windows", () => {
  it("locks at exactly five minutes while allowing later matches after inscriptions close", () => {
    expect(acceptsCasaMatchPicks("cerrada")).toBe(true);
    expect(canEditCasaMatch(scheduled(6), now)).toBe(true);
    expect(canEditCasaMatch(scheduled(5), now)).toBe(false);
    expect(canEditCasaMatch(scheduled(4), now)).toBe(false);
  });
  it.each(["borrador", "resuelta", "anulada"] as const)("freezes %s pollas", status => {
    expect(acceptsCasaMatchPicks(status)).toBe(false);
  });
  it("freezes a pending draw and rejects completed or voided matches", () => {
    expect(acceptsCasaMatchPicks("cerrada", true)).toBe(false);
    expect(canEditCasaMatch({ ...scheduled(60), final_verified_at: new Date(now).toISOString() }, now)).toBe(false);
    expect(canEditCasaMatch({ ...scheduled(60), voided_at: new Date(now).toISOString() }, now)).toBe(false);
  });
  it("keeps a postponed and rescheduled fixture editable until its new five-minute lock", () => {
    expect(canEditCasaMatch(scheduled(60, "cancelled"), now)).toBe(true);
    expect(canEditCasaMatch({ ...scheduled(60, "cancelled"), elapsed: null }, now)).toBe(true);
    expect(canEditCasaMatch(scheduled(5, "cancelled"), now)).toBe(false);
    expect(canEditCasaMatch({ ...scheduled(60, "cancelled"), elapsed: 60 }, now)).toBe(false);
    expect(canEditCasaMatch({ ...scheduled(60, "cancelled"), voided_at: new Date(now).toISOString() }, now)).toBe(false);
    expect(canEditCasaMatch(scheduled(60, "live"), now)).toBe(false);
    expect(canEditCasaMatch(scheduled(60, "finished"), now)).toBe(false);
  });
  it("does not reveal picks from a delayed fixture just because its advertised time passed", () => {
    expect(hasCasaMatchStarted(scheduled(-60), now)).toBe(false);
    expect(hasCasaMatchStarted(scheduled(-60, "cancelled"), now)).toBe(false);
    expect(hasCasaMatchStarted(scheduled(5, "live"), now)).toBe(false);
    expect(hasCasaMatchStarted({ scheduled_at: "invalid", status: "live" }, now)).toBe(false);
  });
  it.each(["live", "finished"])("reveals %s matches after kickoff", status => {
    expect(hasCasaMatchStarted(scheduled(-1, status), now)).toBe(true);
  });
  it.each(["STATUS_SUSPENDED", "STATUS_INTERRUPTED"])("requires real start evidence for %s because providers map it to live", live_status_detail => {
    const match = { ...scheduled(-1, "live"), live_status_detail, elapsed: 0 };
    expect(hasCasaMatchStarted(match, now)).toBe(false);
    expect(hasCasaMatchStarted({ ...match, elapsed: 12 }, now)).toBe(true);
    expect(hasCasaMatchStarted({ ...match, voided_at: new Date(now).toISOString() }, now)).toBe(true);
  });
});
