import { afterEach, describe, expect, it } from "vitest";
import {
  groupMatchesByWeek,
  matchCountLabel,
  matchDayKey,
  matchesTeamQuery,
  mondayKey,
  selectedCountLabel,
  teamQueryStatus,
  weekDetail,
  weekRange,
  weekRelation,
  weekTitle,
  type MatchWeek,
} from "../lib/casa/match-weeks";

const originalTimeZone = process.env.TZ;
afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

interface Row {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
  scheduled_at_confirmed?: boolean;
}

const row = (id: string, scheduled_at: string, scheduled_at_confirmed = true): Row => ({
  id,
  home_team: `Local ${id}`,
  away_team: `Visitante ${id}`,
  scheduled_at,
  scheduled_at_confirmed,
});

const outline = (weeks: MatchWeek<Row>[]) =>
  weeks.map((week) => ({
    key: week.key,
    startKey: week.startKey,
    endKey: week.endKey,
    relation: week.relation,
    days: week.days.map((day) => [day.key, day.list.map((match) => match.id)]),
  }));

// 13-sep-2026 es domingo en Colombia.
const septemberRows = [
  row("sun", "2026-09-13T23:00:00Z"), // domingo 13, 6:00 p. m.
  row("prov", "2026-09-14T00:00:00Z", false), // solo fecha: lunes 14
  row("late", "2026-09-14T23:00:00Z"), // lunes 14, 6:00 p. m.
  row("early", "2026-09-14T17:00:00Z"), // lunes 14, 12:00 m.
  row("night", "2026-09-15T01:00:00Z"), // lunes 14, 8:00 p. m.
  row("sunday-late", "2026-09-21T04:59:00Z"), // domingo 20, 11:59 p. m.
  row("prov-monday", "2026-09-21T00:00:00Z", false), // solo fecha: lunes 21
  row("monday", "2026-09-21T05:00:00Z"), // lunes 21, 12:00 a. m.
];

describe.each(["UTC", "America/Bogota", "Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo"])(
  "match weeks from a device in %s",
  (timeZone) => {
    it("starts weeks on Monday and ends them on Sunday", () => {
      process.env.TZ = timeZone;
      expect(mondayKey("2026-09-14")).toBe("2026-09-14");
      expect(mondayKey("2026-09-16")).toBe("2026-09-14");
      expect(mondayKey("2026-09-20")).toBe("2026-09-14");
      expect(mondayKey("2026-09-21")).toBe("2026-09-21");
      expect(mondayKey("2026-09-13")).toBe("2026-09-07");
    });

    it("keeps one week across the year boundary", () => {
      process.env.TZ = timeZone;
      for (const day of ["2026-12-28", "2026-12-31", "2027-01-01", "2027-01-03"]) {
        expect(mondayKey(day)).toBe("2026-12-28");
      }
      expect(mondayKey("2027-01-04")).toBe("2027-01-04");
    });

    it("keys confirmed kickoffs by Colombia's date and provisional ones by their UTC date", () => {
      process.env.TZ = timeZone;
      expect(matchDayKey({ scheduled_at: "2026-09-21T00:00:00Z" })).toBe("2026-09-20");
      expect(matchDayKey({ scheduled_at: "2026-09-21T00:00:00Z", scheduled_at_confirmed: true })).toBe("2026-09-20");
      expect(matchDayKey({ scheduled_at: "2026-09-21T00:00:00Z", scheduled_at_confirmed: false })).toBe("2026-09-21");
      expect(matchDayKey({ scheduled_at: "2026-09-21T04:59:00+00:00" })).toBe("2026-09-20");
      expect(matchDayKey({ scheduled_at: "2026-09-21T05:00:00+00:00" })).toBe("2026-09-21");
    });

    it("groups by week on a Sunday: this week ends today and next week starts tomorrow", () => {
      process.env.TZ = timeZone;
      const input = [...septemberRows].reverse();
      const before = input.map((match) => match.id);
      expect(outline(groupMatchesByWeek(input, matchDayKey, "2026-09-13"))).toEqual([
        { key: "2026-09-07", startKey: "2026-09-07", endKey: "2026-09-13", relation: "current", days: [["2026-09-13", ["sun"]]] },
        {
          key: "2026-09-14",
          startKey: "2026-09-14",
          endKey: "2026-09-20",
          relation: "next",
          days: [["2026-09-14", ["early", "late", "night", "prov"]], ["2026-09-20", ["sunday-late"]]],
        },
        { key: "2026-09-21", startKey: "2026-09-21", endKey: "2026-09-27", relation: "other", days: [["2026-09-21", ["monday", "prov-monday"]]] },
      ]);
      expect(input.map((match) => match.id)).toEqual(before);
    });

    it("moves the labels forward on Monday", () => {
      process.env.TZ = timeZone;
      const weeks = groupMatchesByWeek(septemberRows, matchDayKey, "2026-09-14");
      expect(weeks.map((week) => [week.key, week.relation])).toEqual([
        ["2026-09-07", "other"],
        ["2026-09-14", "current"],
        ["2026-09-21", "next"],
      ]);
      expect(weeks.map(weekTitle)).toEqual([
        "Semana del 7 al 13 de septiembre",
        "Esta semana",
        "Próxima semana",
      ]);
      expect(weekRelation("2026-08-31", "2026-09-14")).toBe("other");
    });

    it("groups and labels a week that crosses into the next year", () => {
      process.env.TZ = timeZone;
      const weeks = groupMatchesByWeek(
        [
          row("dec-28", "2026-12-28T15:00:00Z"),
          row("jan-3", "2027-01-03T20:00:00Z"),
          row("jan-3-night", "2027-01-04T01:00:00Z"), // domingo 3, 8:00 p. m.
          row("jan-4", "2027-01-04T15:00:00Z"),
        ],
        matchDayKey,
        "2026-12-30",
      );
      expect(outline(weeks)).toEqual([
        {
          key: "2026-12-28",
          startKey: "2026-12-28",
          endKey: "2027-01-03",
          relation: "current",
          days: [["2026-12-28", ["dec-28"]], ["2027-01-03", ["jan-3", "jan-3-night"]]],
        },
        { key: "2027-01-04", startKey: "2027-01-04", endKey: "2027-01-10", relation: "next", days: [["2027-01-04", ["jan-4"]]] },
      ]);
      expect(weekRange(weeks[0])).toBe("28 de diciembre de 2026 al 3 de enero de 2027");
      expect(weekTitle({ ...weeks[0], relation: "other" })).toBe("Semana del 28 de diciembre de 2026 al 3 de enero de 2027");
      expect(weekRange(weeks[1])).toBe("4 al 10 de enero");
    });

    it("builds titles and ranges with Colombia's calendar", () => {
      process.env.TZ = timeZone;
      const current = { startKey: "2026-09-07", endKey: "2026-09-13", relation: "current" } as const;
      const next = { startKey: "2026-09-14", endKey: "2026-09-20", relation: "next" } as const;
      const crossMonth = { startKey: "2026-09-28", endKey: "2026-10-04", relation: "other" } as const;
      const sameMonth = { startKey: "2026-10-05", endKey: "2026-10-11", relation: "other" } as const;
      expect(weekTitle(current)).toBe("Esta semana");
      expect(weekTitle(next)).toBe("Próxima semana");
      expect(weekRange(next)).toBe("14 al 20 de septiembre");
      expect(weekTitle(crossMonth)).toBe("Semana del 28 de septiembre al 4 de octubre");
      expect(weekTitle(sameMonth)).toBe("Semana del 5 al 11 de octubre");
    });

    it("writes the summary line in singular and plural", () => {
      process.env.TZ = timeZone;
      const current = { startKey: "2026-09-07", endKey: "2026-09-13", relation: "current" } as const;
      const next = { startKey: "2026-09-14", endKey: "2026-09-20", relation: "next" } as const;
      const other = { startKey: "2026-09-28", endKey: "2026-10-04", relation: "other" } as const;
      expect(weekDetail(current, 5, 0)).toBe("7 al 13 de septiembre · 5 partidos");
      expect(weekDetail(next, 1, 1)).toBe("14 al 20 de septiembre · 1 partido · 1 elegido");
      expect(weekDetail(other, 12, 3)).toBe("12 partidos · 3 elegidos");
      expect(weekDetail(other, 2, 0)).toBe("2 partidos");
    });
  },
);

describe("count labels", () => {
  it("uses singular only for one", () => {
    expect(matchCountLabel(0)).toBe("0 partidos");
    expect(matchCountLabel(1)).toBe("1 partido");
    expect(matchCountLabel(2)).toBe("2 partidos");
    expect(selectedCountLabel(1)).toBe("1 elegido");
    expect(selectedCountLabel(4)).toBe("4 elegidos");
  });

  it("announces search results with the typed team", () => {
    expect(teamQueryStatus(3, "Nacional")).toBe("3 partidos de «Nacional»");
    expect(teamQueryStatus(1, " Nacional ")).toBe("1 partido de «Nacional»");
  });
});

describe("team search", () => {
  const match = { home_team: "Atlético Nacional", away_team: "Junior" };

  it("finds the home or away team ignoring accents, case and surrounding spaces", () => {
    expect(matchesTeamQuery(match, "Nacional")).toBe(true);
    expect(matchesTeamQuery(match, "ATLETICO")).toBe(true);
    expect(matchesTeamQuery(match, "  junior ")).toBe(true);
    expect(matchesTeamQuery({ home_team: "Atletico Nacional", away_team: "Junior" }, "atlético")).toBe(true);
    expect(matchesTeamQuery({ home_team: "Haiti", away_team: "Curaçao" }, "curacao")).toBe(true);
    expect(matchesTeamQuery({ home_team: "Haiti", away_team: "Curacao" }, "CURAÇAO")).toBe(true);
  });

  it("leaves out matches without that team", () => {
    expect(matchesTeamQuery(match, "Millonarios")).toBe(false);
    expect(matchesTeamQuery(match, "Nacional Medellín")).toBe(false);
  });

  it("treats a blank search as no filter", () => {
    expect(matchesTeamQuery(match, "")).toBe(true);
    expect(matchesTeamQuery(match, "   ")).toBe(true);
  });
});
