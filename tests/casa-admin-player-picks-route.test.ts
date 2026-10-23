import { beforeEach, describe, expect, it, vi } from "vitest";
const { authenticate, rpc, adminClient } = vi.hoisted(() => ({ authenticate: vi.fn(), rpc: vi.fn(), adminClient: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: authenticate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClient }));
import { GET, PUT } from "@/app/api/casa/admin/pollas/[id]/jugadores/[userId]/picks/route";
const pool = "e948b0e4-9235-4d72-a094-80a90f8b5587";
const player = "30ed8c74-3499-4569-a99d-106a0aa41e2a";
const actor = "e311b526-17f3-49bc-8b8f-0c32f5cb0675";
const entry = "20000000-0000-4000-8000-000000000001";
const target = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: pool, userId: player }) };
const input = { entryId: entry, requestId, expectedRevision: 0, picks: [{ matchId: target, homeScore: 2, awayScore: 1 }] };
const request = (body: unknown = input, contract = "2") => new Request("http://localhost/picks", {
  method: "PUT", headers: { "Content-Type": "application/json", "X-Casa-Contract": contract }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks(); authenticate.mockResolvedValue({ id: actor, is_admin: true });
  adminClient.mockReturnValue({ rpc });
  rpc.mockResolvedValue({ data: { entryId: entry, ownerId: player, revision: 0, picks: {}, lastResult: null }, error: null });
});
describe("administrator-managed player predictions", () => {
  it.each([null, { id: actor, is_admin: false }])("blocks all reads and writes before DB access for %j", async user => {
    authenticate.mockResolvedValue(user);
    expect((await GET(new Request("http://localhost"), context)).status).toBe(user ? 403 : 401);
    expect((await PUT(request(), context)).status).toBe(user ? 403 : 401);
    expect(adminClient).not.toHaveBeenCalled();
  });
  it("reads the selected player's state using the real authenticated administrator", async () => {
    const r = await GET(new Request(`http://localhost?entryId=${entry}`), context);
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("casa_admin_player_pick_state", { p_polla_id: pool, p_user_id: player, p_actor_id: actor });
    expect((await r.json()).ownerId).toBe(player);
  });
  it("refuses a readback for a changed entry", async () => {
    expect((await GET(new Request(`http://localhost?entryId=${target}`), context)).status).toBe(409);
  });
  it("requires the current contract and complete versioned operations", async () => {
    expect((await PUT(request(input, "1"), context)).status).toBe(409);
    expect((await PUT(request({ picks: input.picks }), context)).status).toBe(400);
    expect(adminClient).not.toHaveBeenCalled();
  });
  it("rejects malformed player/pool paths before data access", async () => {
    const bad = { params: Promise.resolve({ id: pool, userId: "bad" }) };
    expect((await GET(new Request("http://localhost"), bad)).status).toBe(400);
    expect((await PUT(request(), bad)).status).toBe(400);
    expect(adminClient).not.toHaveBeenCalled();
  });
  it("saves through the audited SQL wrapper, ignoring forged actor/owner body fields", async () => {
    rpc.mockResolvedValue({ data: { ok: true, requestId, revision: 1, guardados: 1, avisos: [], results: [{ targetId: target, status: "saved", values: { homeScore: 2, awayScore: 1 } }] }, error: null });
    const r = await PUT(request({ ...input, actorId: player, userId: actor }), context);
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("casa_admin_save_player_picks", {
      p_polla_id: pool, p_user_id: player, p_actor_id: actor, p_entry_id: entry, p_request_id: requestId,
      p_expected_revision: 0, p_picks: input.picks, p_contract: 2,
    });
  });
  it("returns revision conflicts and bounded lock waits without claiming success", async () => {
    rpc.mockResolvedValue({ data: { ok: false, conflict: true }, error: null });
    expect((await PUT(request(), context)).status).toBe(409);
    rpc.mockResolvedValue({ data: null, error: { code: "55P03" } });
    expect((await PUT(request(), context)).status).toBe(503);
  });
  it.each(["INVALID_MANAGED_PLAYER", "MANAGED_ENTRY_REQUIRED", "MANAGED_ENTRY_CONFLICT", "POLLA_NOT_PUBLISHED"])("retains the server scope rejection %s", async message => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message } });
    const r = await PUT(request(), context);
    expect(r.status).toBe(409); expect((await r.json()).code).toBe(message);
  });
  it("sanitizes SQL internals and rejects mismatched confirmations", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private database internals" } });
    const r = await GET(new Request("http://localhost"), context);
    expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain("private database internals");
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect((await PUT(request(), context)).status).toBe(500);
  });
});
