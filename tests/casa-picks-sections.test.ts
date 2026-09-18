import { describe, expect, it } from "vitest";
import { dayLabel, groupCasaMatchesByDay, isSectionFinished } from "@/lib/casa/picks-sections";

// 2026-09-19 (sábado) a las 20:00 en Colombia = 01:00 UTC del domingo 20.
const NOW = Date.parse("2026-09-20T01:00:00Z");
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3_600_000).toISOString();

const match = (id: string, extra: Partial<Parameters<typeof groupCasaMatchesByDay>[0][number]> & { scheduled_at: string }) => ({
  id, status: "scheduled", final_verified_at: null, voided_at: null, ...extra,
});

const ids = <T extends { id: string }>(groups: Array<{ matches: T[] }>) => groups.flatMap((g) => g.matches.map((m) => m.id));

describe("groupCasaMatchesByDay (2026-09-18: siempre en orden de empezada)", () => {
  it("orders every match by kickoff, whatever its state", () => {
    const grupos = groupCasaMatchesByDay([
      match("proximo", { scheduled_at: at(3) }),
      match("terminado", { scheduled_at: at(-3), status: "finished", final_verified_at: at(-1) }),
      match("envivo", { scheduled_at: at(-1), status: "live", elapsed: 55 }),
      match("anulado", { scheduled_at: at(-2), voided_at: at(-1) }),
    ], NOW);
    expect(ids(grupos)).toEqual(["terminado", "anulado", "envivo", "proximo"]);
  });

  it("does NOT move a match when it starts — the list a player saw yesterday is the list today", () => {
    const partidos = [
      match("a", { scheduled_at: at(1) }),
      match("b", { scheduled_at: at(2) }),
      match("c", { scheduled_at: at(3) }),
    ];
    const antes = ids(groupCasaMatchesByDay(partidos, NOW));
    // Mismo fin de semana, con «b» ya jugado y «c» en curso: el orden no cambia.
    const despues = ids(groupCasaMatchesByDay([
      partidos[0],
      { ...partidos[1], status: "finished", final_verified_at: at(2.5) },
      { ...partidos[2], status: "live", elapsed: 20 },
    ], NOW + 3.5 * 3_600_000));
    expect(despues).toEqual(antes);
  });

  it("breaks ties at the same kickoff with the order the house set", () => {
    const grupos = groupCasaMatchesByDay([
      match("city", { scheduled_at: at(5) }),
      match("bournemouth", { scheduled_at: at(5) }),
    ], NOW);
    expect(ids(grupos)).toEqual(["city", "bournemouth"]);
  });

  it("groups by Colombia day, in order, with Hoy and Mañana", () => {
    const grupos = groupCasaMatchesByDay([
      match("sun", { scheduled_at: at(20) }),      // domingo 16:00 Colombia
      match("later", { scheduled_at: at(26) }),    // domingo 22:00 Colombia
      match("tonight", { scheduled_at: at(2) }),   // sábado 22:00 Colombia
      match("tue", { scheduled_at: "2026-09-22T20:00:00Z" }),
    ], NOW);
    expect(grupos.map((g) => g.label)).toEqual(["Hoy", "Mañana", "mar 22 sep"]);
    expect(grupos.map((g) => g.matches.map((m) => m.id))).toEqual([["tonight"], ["sun", "later"], ["tue"]]);
  });

  it("marks unconfirmed hours without shifting the provider date", () => {
    const grupos = groupCasaMatchesByDay([
      match("pst", { scheduled_at: at(30), status: "cancelled", elapsed: 0 }),
      match("tbd", { scheduled_at: "2026-09-25T00:00:00Z", scheduled_at_confirmed: false }),
    ], NOW);
    expect(ids(grupos)).toEqual(["pst", "tbd"]);
    expect(grupos[1].key).toBe("tbd-2026-09-25");
    expect(grupos[1].label).toMatch(/hora por confirmar$/);
  });

  it("isSectionFinished only counts verified, voided or provider-finished", () => {
    expect(isSectionFinished(match("ft", { scheduled_at: at(-3), status: "finished" }))).toBe(true);
    expect(isSectionFinished(match("void", { scheduled_at: at(-3), voided_at: at(-2) }))).toBe(true);
    expect(isSectionFinished(match("x", { scheduled_at: at(1), status: "cancelled" }))).toBe(false);
  });

  it("dayLabel is relative to the Colombia calendar", () => {
    expect(dayLabel(at(1), NOW)).toBe("Hoy");
    expect(dayLabel(at(10), NOW)).toBe("Mañana");
    expect(dayLabel(at(80), NOW)).toBe("mié 23 sep");
  });
});
