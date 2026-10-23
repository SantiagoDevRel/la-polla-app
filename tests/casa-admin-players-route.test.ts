import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticate, rpc, adminClient } = vi.hoisted(() => ({
  authenticate: vi.fn(), rpc: vi.fn(), adminClient: vi.fn(),
}));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: authenticate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClient }));
import { GET, PATCH } from "@/app/api/casa/admin/pollas/[id]/jugadores/route";

const pool = "e948b0e4-9235-4d72-a094-80a90f8b5587";
const actor = "e311b526-17f3-49bc-8b8f-0c32f5cb0675";
const player = "30ed8c74-3499-4569-a99d-106a0aa41e2a";
const context = { params: Promise.resolve({ id: pool }) };
const request = (body: unknown, headers: Record<string, string> = { "X-Casa-Contract": "2" }) => new Request("http://localhost/api/casa/admin/pollas/pool/jugadores", {
  method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  authenticate.mockResolvedValue({ id: actor, is_admin: true });
  adminClient.mockReturnValue({ rpc });
  rpc.mockResolvedValue({ data: { players: [], editable: true }, error: null });
});

describe("admin-only paid player selection", () => {
  it.each([null, { id: player, is_admin: false }])("rejects GET and PATCH before roster/database access for %j", async (user) => {
    authenticate.mockResolvedValue(user);
    const expected = user ? 403 : 401;
    expect((await GET(new Request("http://localhost"), context)).status).toBe(expected);
    expect((await PATCH(request({ userId: player, selected: true, revision: 0 }), context)).status).toBe(expected);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("reads using the authenticated admin identity and disables caching", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("casa_get_admin_players", { p_polla_id: pool, p_actor_id: actor });
  });

  it("requires the current Casa contract before writing", async () => {
    const response = await PATCH(request({ userId: player, selected: true, revision: 0 }, {}), context);
    expect(response.status).toBe(409);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it.each([
    { userId: player, selected: "true", revision: 0 },
    { userId: player, selected: true, revision: -1 },
    { userId: player, selected: true },
    { userId: player, selected: true, revision: 0, actorId: player },
    { userId: "bad", selected: true, revision: 0 },
  ])("rejects malformed or forged mutation payload %j", async (body) => {
    expect((await PATCH(request(body), context)).status).toBe(400);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("rejects malformed pool identifiers without accessing the roster", async () => {
    const bad = { params: Promise.resolve({ id: "bad" }) };
    expect((await GET(new Request("http://localhost"), bad)).status).toBe(400);
    expect((await PATCH(request({ userId: player, selected: true, revision: 0 }), bad)).status).toBe(400);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it.each([true, false])("persists selected=%s only through the atomic paid-entry RPC", async (selected) => {
    const response = await PATCH(request({ userId: player, selected, revision: 3 }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("casa_set_admin_player", {
      p_polla_id: pool, p_user_id: player, p_selected: selected, p_revision: 3, p_actor_id: actor, p_contract: 2,
    });
  });

  it.each(["PLAYER_SELECTION_CHANGED", "MANAGED_ENTRY_CONFLICT", "INVALID_MANAGED_PLAYER", "INSCRIPTIONS_CLOSED", "POLLA_FINAL", "NO_AVAILABLE_TICKETS"])("preserves the SQL guard failure %s", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message } });
    const response = await PATCH(request({ userId: player, selected: true, revision: 0 }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(message);
  });

  it("does not expose database internals on unexpected errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private database details" } });
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
