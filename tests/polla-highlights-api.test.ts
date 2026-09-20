import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), key: vi.fn(), videos: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/highlights/provider", () => ({ highlightsApiKey: mocks.key, fetchPollaHighlights: mocks.videos }));
import { GET } from "@/app/api/casa/highlights/route";
import { listHighlightMatches } from "@/lib/highlights/polla-matches";
const dbFetch = vi.fn<typeof fetch>();
const match = { id: "00000000-0000-4000-8000-000000000001", home_team: "Once Caldas", away_team: "Deportivo Cali", tournament: "betplay_2026", scheduled_at: "2026-09-20T23:00:00Z", scheduled_at_confirmed: true, status: "finished" };
const req = (query = "") => new Request(`http://localhost/api/casa/highlights${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "viewer" } }, error: null });
  mocks.key.mockReturnValue("paid-test-key");
  mocks.videos.mockResolvedValue({ videos: [], partial: false });
  mocks.admin.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", { auth: { persistSession: false }, global: { fetch: dbFetch } }));
  dbFetch.mockResolvedValue(new Response(JSON.stringify([{ match, polla: { id: "polla" } }])));
});
describe("polla highlights authorization and scope", () => {
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: "expired" } }, error: {} }])("rejects missing/expired sessions before DB or provider", async auth => {
    mocks.auth.mockResolvedValue(auth);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.videos).not.toHaveBeenCalled();
  });
  it("filters the published Casa catalog, excludes voided/unfinished matches and deduplicates across pools", async () => {
    dbFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ match }, { match }, { match: { ...match, id: "live", status: "live" } }])));
    const matches = await listHighlightMatches("viewer", {}, new Date("2026-09-20T02:00:00Z"));
    expect(matches).toEqual([match]);
    const p = new URL(String(dbFetch.mock.calls[0][0])).searchParams;
    expect(p.get("polla.publication_mode")).toBe("neq.oculta");
    expect(p.get("polla.archived_at")).toBe("is.null");
    expect(p.get("polla.status")).toBe("in.(abierta,cerrada,resuelta)");
    expect(p.get("polla.opens_at")).toBe("lte.2026-09-20T02:00:00.000Z");
    expect(p.get("voided_at")).toBe("is.null");
    expect(p.getAll("match.scheduled_at")).toEqual(["gte.2026-09-19T05:00:00.000Z", "lt.2026-09-20T05:00:00.000Z"]);
    expect(p.get("select")).not.toMatch(/\*|predictions|proof|user_id/);
  });
  it("keeps match lookups scoped to a published pool even for historical matches", async () => {
    await GET(req(`?polla=liga&match=${match.id}`));
    const p = new URL(String(dbFetch.mock.calls[0][0])).searchParams;
    expect(p.get("polla.slug")).toBe("eq.liga"); expect(p.get("match_id")).toBe(`eq.${match.id}`);
    expect(p.has("match.scheduled_at")).toBe(false);
  });
  it("never fetches videos outside the database scope and surfaces DB errors", async () => {
    dbFetch.mockResolvedValueOnce(new Response("[]"));
    expect((await GET(req())).status).toBe(200);
    expect(mocks.videos).toHaveBeenLastCalledWith([], "paid-test-key");
    dbFetch.mockResolvedValueOnce(new Response('{"message":"failure"}', { status: 400 }));
    expect((await GET(req())).status).toBe(503);
  });
  it("disabled production integration has no provider/DB traffic; malformed IDs fail closed", async () => {
    expect((await GET(req("?match=not-an-id"))).status).toBe(400);
    mocks.key.mockReturnValue(null);
    expect(await (await GET(req())).json()).toMatchObject({ enabled: false, videos: [] });
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.videos).not.toHaveBeenCalled();
  });
});
