import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), createClient: vi.fn(), getUser: vi.fn(), tournaments: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/casa/tournaments", () => ({ getPollaTournamentSlugs: mocks.tournaments }));
import { listMyPollas } from "@/lib/casa/my-pollas";
import { GET } from "@/app/api/casa/mis-pollas/route";

const dbFetch = vi.fn<typeof fetch>();
const userId = "00000000-0000-4000-8000-000000000001";
const polla = { id: "pool-a", slug: "liga", name: "Liga", kind: "partidos", tournament: null, status: "abierta", closes_at: "2026-10-01T12:00:00Z" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createAdminClient.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch },
  }));
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.tournaments.mockResolvedValue({ "pool-a": ["premier_2025"] });
});

describe("personal casa pollas", () => {
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: userId } }, error: { message: "Expired" } },
  ])("denies invalid sessions before any database access", async auth => {
    mocks.getUser.mockResolvedValue(auth);
    const result = await GET();
    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a true empty list and never reports database failure as zero memberships", async () => {
    dbFetch.mockResolvedValueOnce(response([]));
    const empty = await GET();
    expect(await empty.json()).toEqual({ pollas: [] });
    dbFetch.mockResolvedValueOnce(response({ message: "Database unavailable" }, 400));
    const failed = await GET();
    expect(failed.status).toBe(500);
    expect(await failed.json()).not.toHaveProperty("pollas");
  });

  it("scopes every page to the session user, excludes invalid entries and private pools, and deduplicates raffle tickets", async () => {
    dbFetch.mockResolvedValueOnce(response(Array.from({ length: 500 }, () => ({ status: "pendiente", polla }))))
      .mockResolvedValueOnce(response([
        { status: "pagada", entry_number: 2, polla },
        { status: "pagada", polla: [{ ...polla, id: "pool-b", slug: "finalizada", status: "resuelta" }] },
      ]));
    const result = await GET();
    const body = await result.json();
    expect(body.pollas).toHaveLength(2);
    expect(body.pollas[0]).toEqual({ ...polla, entry_status: "pagada", tournaments: ["premier_2025"],
      entries: [{ number: 2, status: "pagada" }] });
    expect(body.pollas[1].entries).toEqual([]);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    const entryCalls = dbFetch.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith("/casa_entries"));
    expect(entryCalls).toHaveLength(2);
    for (const [input] of entryCalls) {
      const params = new URL(String(input)).searchParams;
      expect(params.get("user_id")).toBe(`eq.${userId}`);
      expect(params.get("status")).toBe("in.(pagada,pendiente)");
      expect(params.get("polla.status")).toBe("in.(abierta,cerrada,resuelta)");
      expect(params.get("polla.archived_at")).toBe("is.null");
      expect(params.get("select")).not.toMatch(/proof|amount|account|user_id|\*/);
    }
    expect(new URL(String(entryCalls[1][0])).searchParams.get("offset")).toBe("500");
  });

  it("counts per cupo the still-editable matches without a prediction (migration 131)", async () => {
    const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
    dbFetch.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/casa_entries")) return response([
        { id: "e1", status: "pagada", entry_number: 1, polla },
        { id: "e2", status: "pendiente", entry_number: 2, polla },
      ]);
      if (path.endsWith("/casa_polla_matches")) return response([
        { polla_id: "pool-a", match_id: "m1", voided_at: null },
        { polla_id: "pool-a", match_id: "m2", voided_at: null },
        { polla_id: "pool-a", match_id: "m3", voided_at: null },
      ]);
      if (path.endsWith("/casa_picks")) return response([{ entry_id: "e1", match_id: "m1" }, { entry_id: "e1", match_id: "m2" }]);
      if (path.endsWith("/matches")) return response([
        { id: "m1", status: "scheduled", elapsed: null, scheduled_at: future, final_verified_at: null },
        { id: "m2", status: "scheduled", elapsed: null, scheduled_at: future, final_verified_at: null },
        { id: "m3", status: "finished", elapsed: 90, scheduled_at: "2020-01-01T00:00:00Z", final_verified_at: "2020-01-01T02:00:00Z" },
      ]);
      return response([]);
    });
    const [item] = await listMyPollas(userId);
    expect(item.entries).toEqual([{ number: 1, status: "pagada", pending: 0 }, { number: 2, status: "pendiente", pending: 2 }]);
  });

  it("does not allow an unscoped helper call", async () => {
    await expect(listMyPollas("")).rejects.toThrow("Authenticated user required");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
