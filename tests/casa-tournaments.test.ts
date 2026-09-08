import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getPollaTournamentSlugs, resolveTournamentSlugs } from "@/lib/casa/tournaments";

const dbFetch = vi.fn<typeof fetch>();
const polla = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "partidos" as const,
  tournament: "premier_2025",
  status: "abierta" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createAdminClient.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: dbFetch },
  }));
});

describe("competition identity for public casa pollas", () => {
  it("shows every linked tournament once, without adding a stale legacy tournament", () => {
    expect(resolveTournamentSlugs(polla, [
      { tournament: "laliga_2025" },
      { tournament: "ligue1_2025" },
      { tournament: "laliga_2025" },
    ])).toEqual(["laliga_2025", "ligue1_2025"]);
    expect(resolveTournamentSlugs(polla, [])).toEqual(["premier_2025"]);
    expect(resolveTournamentSlugs({ ...polla, tournament: null }, [])).toEqual([]);
    expect(resolveTournamentSlugs({ ...polla, kind: "rifa" }, [{ tournament: "laliga_2025" }])).toEqual([]);
  });

  it("reads the tournament beyond the first page, using only public metadata and the requested polla IDs", async () => {
    const firstPage = Array.from({ length: 500 }, () => ({
      polla_id: polla.id, match: { tournament: "laliga_2025" },
    }));
    dbFetch.mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { polla_id: polla.id, match: { tournament: "ligue1_2025" } },
      ]), { status: 200 }));

    expect(await getPollaTournamentSlugs([polla])).toEqual({ [polla.id]: ["laliga_2025", "ligue1_2025"] });
    expect(dbFetch).toHaveBeenCalledTimes(2);
    const first = new URL(String(dbFetch.mock.calls[0][0]));
    const second = new URL(String(dbFetch.mock.calls[1][0]));
    expect(first.searchParams.get("select")).toBe("polla_id,match:matches(tournament)");
    expect(first.searchParams.get("polla_id")).toBe(`in.(${polla.id})`);
    expect(first.searchParams.get("order")).toBe("polla_id.asc,order_index.asc,match_id.asc");
    expect(first.searchParams.get("limit")).toBe("500");
    expect(second.searchParams.get("offset")).toBe("500");
  });

  it("does not query or expose draft/cancelled pollas, nor manufacture logos for raffles", async () => {
    expect(await getPollaTournamentSlugs([
      { ...polla, status: "borrador" },
      { ...polla, id: "cancelled", status: "anulada" },
      { ...polla, id: "raffle", kind: "rifa" },
    ])).toEqual({ raffle: [] });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not hide a failed metadata read behind a potentially wrong fallback logo", async () => {
    dbFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Query failed" }), { status: 400 }));
    await expect(getPollaTournamentSlugs([polla])).rejects.toMatchObject({ message: "Query failed" });
  });
});
