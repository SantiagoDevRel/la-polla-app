import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), getPolla: vi.fn(), getPicks: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/casa/queries", () => ({ getPollaBySlug: mocks.getPolla, getMyPicks: mocks.getPicks, getMyEntryByNumber: vi.fn() }));
import { GET, PUT } from "@/app/api/casa/pollas/[slug]/picks/route";
import { saveCasaPicks } from "@/lib/casa/picks-save";

const owner = "11111111-1111-4111-8111-111111111111";
const pool = "22222222-2222-4222-8222-222222222222";
const entry = "33333333-3333-4333-8333-333333333333";
const match = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const polla = { id: pool, kind: "partidos" as const, status: "abierta" as const, scoring_mode: "marcador" as const,
  closes_at: "2099-01-01", opens_at: "2000-01-01", publication_mode: "ahora" as const, draw_pending: false };
const context = { params: Promise.resolve({ slug: "fixture" }) };
const picks = [{ matchId: match, homeScore: 2, awayScore: 1 }];
const body = { picks, requestId, entryId: entry, expectedRevision: 0 };
const ack = { ok: true, requestId, revision: 1, guardados: 1, avisos: [], results: [{ targetId: match, status: "saved", values: { homeScore: 2, awayScore: 1 } }] };
const put = (input: unknown = body) => new NextRequest("http://localhost/api/casa/pollas/fixture/picks", { method: "PUT", body: JSON.stringify(input) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } } });
  mocks.getPolla.mockResolvedValue(polla);
  mocks.rpc.mockImplementation(async (name: string) => name === "casa_my_entry_v2"
    ? { data: { id: entry, status: "pagada", proof_path: null }, error: null }
    : name === "casa_pick_save_state_v1" ? { data: { revision: 1, picks: { [match]: ack.results[0].values }, lastResult: ack }, error: null }
      : { data: ack, error: null });
});

describe("pick save API boundaries", () => {
  it("validates the session before any pool/database reads", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await PUT(put(), context)).status).toBe(401);
    expect((await GET(new NextRequest("http://localhost/api/casa/pollas/fixture/picks?state=1"), context)).status).toBe(401);
    expect(mocks.getPolla).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: { message: "Invalid session" } });
    const invalid = await PUT(put(), context);
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getPolla).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires complete versioned identity and rejects repeated targets before writing", async () => {
    expect((await PUT(put({ ...body, entryId: undefined }), context)).status).toBe(400);
    expect((await PUT(put({ ...body, picks: [picks[0], picks[0]] }), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns only the transaction's exact ACK and preserves legacy fields", async () => {
    const response = await PUT(put(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(ack);
    expect(mocks.rpc).toHaveBeenCalledWith("casa_save_picks_v1", expect.objectContaining({
      p_polla_id: pool, p_user_id: owner, p_entry_id: entry, p_request_id: requestId, p_expected_revision: 0,
    }));
  });
  it("never saves into another authenticated account's same-number entry", async () => {
    const response = await PUT(put({ ...body, entryId: "66666666-6666-4666-8666-666666666666" }), context);
    expect(response.status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("allows completed operation replay to reach SQL after pool closure", async () => {
    mocks.getPolla.mockResolvedValue({ ...polla, status: "resuelta" });
    expect((await PUT(put(), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("casa_save_picks_v1", expect.anything());
  });
  it("uses read-only owner/entry state for reconciliation and rejects a changed account", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/casa/pollas/fixture/picks?state=1&entryId=${entry}`), context);
    expect(await response.json()).toMatchObject({ ownerId: owner, entryId: entry, revision: 1 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalledWith("casa_save_picks_v1", expect.anything());
    const changed = await GET(new NextRequest("http://localhost/api/casa/pollas/fixture/picks?state=1&entryId=another"), context);
    expect(changed.status).toBe(403);
  });
  it("rejects malformed database ACKs and makes lock contention retryable", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "casa_my_entry_v2"
      ? { data: { id: entry, status: "pagada" }, error: null } : { data: { ok: true }, error: null });
    expect((await PUT(put(), context)).status).toBe(500);
    mocks.rpc.mockImplementation(async (name: string) => name === "casa_my_entry_v2"
      ? { data: { id: entry, status: "pagada" }, error: null } : { data: null, error: { code: "55P03", message: "internal detail" } });
    const response = await PUT(put(), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ retryable: true });
  });
  it("does not pre-reject a completed versioned operation after an entry is rejected", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "casa_my_entry_v2"
      ? { data: { id: entry, status: "rechazada" }, error: null } : { data: ack, error: null });
    expect(await saveCasaPicks(polla, owner, picks, undefined, undefined, body)).toEqual(ack);
  });
});
