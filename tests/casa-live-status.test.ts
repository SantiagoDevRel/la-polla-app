import { describe, expect, it } from "vitest";
import { hasPick, liveMinuteLabel, pickLabel, pickOnTrack, result1x2Of, shortTeam } from "@/lib/casa/live-status";

describe("live-status (2026-09-16: «Tu marcador» contra el parcial)", () => {
  it("reads L/E/V from any score and null without one", () => {
    expect(result1x2Of(2, 1)).toBe("L");
    expect(result1x2Of(0, 3)).toBe("V");
    expect(result1x2Of(1, 1)).toBe("E");
    expect(result1x2Of(null, 1)).toBeNull();
  });

  it("only an exact score is on track in marcador mode; a partial hit is not", () => {
    const pick = { pick1x2: null, homeScore: 2, awayScore: 1 };
    expect(pickOnTrack("marcador", pick, { home: 2, away: 1 })).toBe(true);
    expect(pickOnTrack("marcador", pick, { home: 2, away: 0 })).toBe(false);
    expect(pickOnTrack("marcador", pick, { home: 1, away: 0 })).toBe(false);
    expect(pickOnTrack("marcador", pick, { home: null, away: null })).toBeNull();
    expect(pickOnTrack("marcador", null, { home: 2, away: 1 })).toBeNull();
    expect(pickOnTrack("marcador", { pick1x2: null, homeScore: 2, awayScore: null }, { home: 2, away: 1 })).toBeNull();
  });

  it("1x2 mode compares the result, not the goals", () => {
    expect(pickOnTrack("1x2", { pick1x2: "L", homeScore: null, awayScore: null }, { home: 3, away: 0 })).toBe(true);
    expect(pickOnTrack("1x2", { pick1x2: "E", homeScore: null, awayScore: null }, { home: 0, away: 0 })).toBe(true);
    expect(pickOnTrack("1x2", { pick1x2: "V", homeScore: null, awayScore: null }, { home: 1, away: 1 })).toBe(false);
  });

  it("labels a pick the way the person reads it", () => {
    expect(pickLabel("marcador", { pick1x2: null, homeScore: 2, awayScore: 1 }, "Junior FC", "Millonarios FC")).toBe("2-1");
    expect(pickLabel("1x2", { pick1x2: "L", homeScore: null, awayScore: null }, "Junior FC", "Millonarios FC")).toBe("Junior");
    expect(pickLabel("1x2", { pick1x2: "V", homeScore: null, awayScore: null }, "Junior FC", "Manchester United")).toBe("Manchester United");
    expect(pickLabel("1x2", { pick1x2: "E", homeScore: null, awayScore: null }, "A", "B")).toBe("Empate");
    expect(pickLabel("marcador", { pick1x2: null, homeScore: 2, awayScore: null }, "A", "B")).toBeNull();
    expect(hasPick("1x2", { pick1x2: null, homeScore: 2, awayScore: 1 })).toBe(false);
  });

  it("keeps United and Club when shortening names", () => {
    expect(shortTeam("Manchester United")).toBe("Manchester United");
    expect(shortTeam("FC Barcelona")).toBe("Barcelona");
    expect(shortTeam("Atlético Nacional SA")).toBe("Atlético Nacional SA");
  });

  it("prefers the provider minute, then special statuses, and never invents one", () => {
    expect(liveMinuteLabel({ scheduled_at: new Date(Date.now() - 20 * 60_000).toISOString(), elapsed: 34 })).toBe("34'");
    expect(liveMinuteLabel({ scheduled_at: new Date().toISOString(), elapsed: 46, live_status_detail: "STATUS_HALFTIME" })).toBe("Descanso");
    expect(liveMinuteLabel({ scheduled_at: new Date().toISOString(), elapsed: 95 })).toBe("90+'");
    expect(liveMinuteLabel({ scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(), elapsed: null })).toBe("");
  });
});
