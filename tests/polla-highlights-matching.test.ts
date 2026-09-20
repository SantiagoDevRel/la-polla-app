import { describe, expect, it } from "vitest";
import { colombiaTodayWindow, highlightQueryDays, matchHighlightEvent, youtubeVideoId, type HighlightMatch, type SportsVideoEvent } from "@/lib/highlights/matching";

const match: HighlightMatch = { id: "match-a", home_team: "Once Caldas", away_team: "Deportivo Cali", tournament: "betplay_2026", scheduled_at: "2026-09-13T23:10:00Z", scheduled_at_confirmed: true, status: "finished" };
const event: SportsVideoEvent = { idEvent: "2481179", idLeague: "4497", strHomeTeam: "Once Caldas", strAwayTeam: "Deportivo Cali", strTimestamp: "2026-09-13T23:10:00", strStatus: "FT", strVideo: "https://www.youtube.com/watch?v=FJZvibo9d00" };

describe("polla highlight identity", () => {
  it("matches a real provider event and does not depend on the server time zone", () => {
    expect(matchHighlightEvent(match, [event])).toEqual(event);
    expect(matchHighlightEvent({ ...match, home_team: "Once Caldas FC" }, [event])).toEqual(event);
  });
  it("rejects a different opponent, reversed sides, tournament, day, ambiguous event or unfinished match", () => {
    for (const patch of [{ strAwayTeam: "Deportivo Pasto" }, { strHomeTeam: "Deportivo Cali", strAwayTeam: "Once Caldas" }, { idLeague: "4724" }, { strTimestamp: "2026-09-12T23:10:00" }, { strStatus: "NS" }]) {
      expect(matchHighlightEvent(match, [{ ...event, ...patch }])).toBeNull();
    }
    expect(matchHighlightEvent(match, [event, { ...event, idEvent: "other" }])).toBeNull();
    expect(matchHighlightEvent(match, [event, event])).toEqual(event);
    expect(matchHighlightEvent({ ...match, status: "live" }, [event])).toBeNull();
    expect(matchHighlightEvent({ ...match, scheduled_at_confirmed: false }, [event])).toBeNull();
  });
  it("uses the Colombian day across UTC midnight and queries adjacent provider days", () => {
    expect(colombiaTodayWindow(new Date("2026-09-20T02:00:00Z"))).toEqual({ day: "2026-09-19", start: "2026-09-19T05:00:00.000Z", end: "2026-09-20T05:00:00.000Z" });
    expect(highlightQueryDays(match)).toEqual(["2026-09-13", "2026-09-14"]);
  });
  it("accepts YouTube links only and rejects URL injection", () => {
    expect(youtubeVideoId(event.strVideo)).toBe("FJZvibo9d00");
    expect(youtubeVideoId("https://youtu.be/FJZvibo9d00?t=3")).toBe("FJZvibo9d00");
    for (const url of ["javascript:alert(1)", "https://youtube.com.evil.test/watch?v=FJZvibo9d00", "https://user@youtube.com/watch?v=FJZvibo9d00", "https://youtube.com/watch?v=bad", "http://youtube.com/watch?v=FJZvibo9d00", "https://evil.test/embed/FJZvibo9d00"]) expect(youtubeVideoId(url)).toBeNull();
  });
});
