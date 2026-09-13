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
        { status: "pagada", polla },
        { status: "pagada", polla: [{ ...polla, id: "pool-b", slug: "finalizada", status: "resuelta" }] },
      ]));
    const result = await GET();
    const body = await result.json();
    expect(body.pollas).toHaveLength(2);
    expect(body.pollas[0]).toEqual({ ...polla, entry_status: "pagada", tournaments: ["premier_2025"] });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dbFetch).toHaveBeenCalledTimes(2);
    for (const [input] of dbFetch.mock.calls) {
      const params = new URL(String(input)).searchParams;
      expect(params.get("user_id")).toBe(`eq.${userId}`);
      expect(params.get("status")).toBe("in.(pagada,pendiente)");
      expect(params.get("polla.status")).toBe("in.(abierta,cerrada,resuelta)");
      expect(params.get("polla.archived_at")).toBe("is.null");
      expect(params.get("select")).not.toMatch(/proof|amount|account|user_id|\*/);
    }
    expect(new URL(String(dbFetch.mock.calls[1][0])).searchParams.get("offset")).toBe("500");
  });

  it("does not allow an unscoped helper call", async () => {
    await expect(listMyPollas("")).rejects.toThrow("Authenticated user required");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
