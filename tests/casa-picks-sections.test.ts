import { describe, expect, it } from "vitest";
import { dayLabel, isSectionFinished, partitionCasaMatches } from "@/lib/casa/picks-sections";

// 2026-09-19 (sábado) a las 20:00 en Colombia = 01:00 UTC del domingo 20.
const NOW = Date.parse("2026-09-20T01:00:00Z");
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3_600_000).toISOString();

const match = (id: string, extra: Partial<Parameters<typeof partitionCasaMatches>[0][number]> & { scheduled_at: string }) => ({
  id, status: "scheduled", final_verified_at: null, voided_at: null, ...extra,
});

describe("partitionCasaMatches (2026-09-16: Finalizados · En vivo · Próximos)", () => {
  it("sends verified, voided and provider-finished matches to Finalizados, most recent first", () => {
    const sections = partitionCasaMatches([
      match("old", { scheduled_at: at(-48), status: "finished", final_verified_at: at(-46) }),
      match("void", { scheduled_at: at(-30), voided_at: at(-29) }),
      match("ft", { scheduled_at: at(-3), status: "finished" }),
    ], NOW);
    expect(sections.finished.map((m) => m.id)).toEqual(["ft", "void", "old"]);
    expect(sections.live).toEqual([]);
    expect(sections.upcoming).toEqual([]);
    expect(isSectionFinished(match("x", { scheduled_at: at(1), status: "cancelled" }))).toBe(false);
  });

  it("puts live matches and those locked five minutes before kickoff in En vivo", () => {
    const sections = partitionCasaMatches([
      match("live", { scheduled_at: at(-1), status: "live", elapsed: 55 }),
      match("locked", { scheduled_at: at(0.05) }),
      match("abandoned", { scheduled_at: at(-2), status: "cancelled", elapsed: 60 }),
    ], NOW);
    expect(sections.live.map((m) => m.id)).toEqual(["abandoned", "live", "locked"]);
    expect(sections.upcoming).toEqual([]);
  });

  it("groups upcoming matches by Colombia day, in order, with Hoy and Mañana", () => {
    const sections = partitionCasaMatches([
      match("sun", { scheduled_at: at(20) }),      // domingo 16:00 Colombia
      match("later", { scheduled_at: at(26) }),    // domingo 22:00 Colombia
      match("tonight", { scheduled_at: at(2) }),   // sábado 22:00 Colombia
      match("tue", { scheduled_at: "2026-09-22T20:00:00Z" }),
    ], NOW);
    expect(sections.upcoming.map((g) => g.label)).toEqual(["Hoy", "Mañana", "mar 22 sep"]);
    expect(sections.upcoming.map((g) => g.matches.map((m) => m.id))).toEqual([["tonight"], ["sun", "later"], ["tue"]]);
  });

  it("keeps postponed fixtures without minutes editable and marks unconfirmed hours", () => {
    const sections = partitionCasaMatches([
      match("pst", { scheduled_at: at(30), status: "cancelled", elapsed: 0 }),
      match("tbd", { scheduled_at: "2026-09-25T00:00:00Z", scheduled_at_confirmed: false }),
    ], NOW);
    expect(sections.live).toEqual([]);
    expect(sections.upcoming.flatMap((g) => g.matches.map((m) => m.id))).toEqual(["pst", "tbd"]);
    expect(sections.upcoming[1].key).toBe("tbd-2026-09-25");
    expect(sections.upcoming[1].label).toMatch(/hora por confirmar$/);
  });

  it("dayLabel is relative to the Colombia calendar", () => {
    expect(dayLabel(at(1), NOW)).toBe("Hoy");
    expect(dayLabel(at(10), NOW)).toBe("Mañana");
    expect(dayLabel(at(80), NOW)).toBe("mié 23 sep");
  });
});
