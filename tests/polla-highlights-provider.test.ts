import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchPollaHighlights, highlightsApiKey } from "@/lib/highlights/provider";
import type { HighlightMatch } from "@/lib/highlights/matching";
const match: HighlightMatch = { id: "match", home_team: "Once Caldas", away_team: "Deportivo Cali", tournament: "betplay_2026", scheduled_at: "2026-09-13T20:10:00Z", scheduled_at_confirmed: true, status: "finished" };
const event = { idEvent: "2481179", idLeague: "4497", strHomeTeam: "Once Caldas", strAwayTeam: "Deportivo Cali", strTimestamp: "2026-09-13T20:10:00", strStatus: "FT", strVideo: "https://www.youtube.com/watch?v=FJZvibo9d00" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("highlight provider", () => {
  it("requires explicit activation and permits the free key in web production", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SPORTSDB_API_KEY", "123"); vi.stubEnv("SPORTSDB_HIGHLIGHTS_ENABLED", "true");
    expect(highlightsApiKey()).toBe("123");
    vi.stubEnv("SPORTSDB_API_KEY", ""); expect(highlightsApiKey()).toBe("123");
    vi.stubEnv("NODE_ENV", "development"); expect(highlightsApiKey()).toBe("123");
    vi.stubEnv("SPORTSDB_HIGHLIGHTS_ENABLED", "false"); expect(highlightsApiKey()).toBeNull();
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SPORTSDB_HIGHLIGHTS_ENABLED", "true"); vi.stubEnv("SPORTSDB_API_KEY", "paid-test-key");
    expect(highlightsApiKey()).toBe("paid-test-key");
    vi.stubEnv("SPORTSDB_API_KEY", "bad/key"); expect(highlightsApiKey()).toBeNull();
  });
  it("makes no external requests without pool matches", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await fetchPollaHighlights([], "123")).toEqual({ videos: [], partial: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shares provider queries, selects only pool matches, validates metadata and deduplicates videos", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("oembed")
      ? { type: "video", author_name: "Win Sports" }
      : { events: [event, { ...event, idEvent: "elsewhere", strHomeTeam: "Other team" }] }))));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchPollaHighlights([match, { ...match, id: "duplicate" }], "123");
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toMatchObject({ title: "Once Caldas vs. Deportivo Cali", videoId: "FJZvibo9d00", channel: "Win Sports" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].next).toEqual({ revalidate: 600 });
  });
  it("distinguishes unavailable provider from genuine missing/deleted video", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("failure", { status: 503 })); vi.stubGlobal("fetch", fetcher);
    expect(await fetchPollaHighlights([match], "123")).toEqual({ videos: [], partial: true });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ events: [event] })))
      .mockResolvedValueOnce(new Response("deleted", { status: 404 }));
    expect(await fetchPollaHighlights([match], "123")).toEqual({ videos: [], partial: false });
  });
});
