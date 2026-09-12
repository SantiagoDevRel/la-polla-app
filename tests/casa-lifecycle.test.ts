import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), notifyReview: vi.fn() }));
vi.mock("@/lib/casa/review-notify", () => ({ notifyCasaReview: mocks.notifyReview }));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
vi.mock("@/lib/telegram/notify", () => ({ signedProofUrl: vi.fn() }));
import { PATCH } from "@/app/api/casa/admin/pollas/[id]/route";
import { POST } from "@/app/api/casa/admin/entries/route";
const id = "00000000-0000-4000-8000-000000000001";
const adminId = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const fetchDb = vi.fn<typeof fetch>();
const params = { params: Promise.resolve({ id }) };
const request = (body: unknown, contract = true) => new NextRequest("http://localhost/api/casa/admin/test", {
  method: "POST", headers: { "Content-Type": "application/json", ...(contract ? { "X-Casa-Contract": "2" } : {}) }, body: JSON.stringify(body),
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: adminId, is_admin: true });
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDb },
  }));
});
describe("Casa v2 API boundary (lifecycle invariants execute in the local SQL suite)", () => {
  it.each([null, { id: adminId, is_admin: false }])("requires admin before any operation: %j", async (user) => {
    mocks.user.mockResolvedValue(user);
    expect((await PATCH(request({ action: "eliminar" }), params)).status).toBe(user ? 403 : 401);
    expect((await POST(request({ attemptId, decision: "aprobar" }))).status).toBe(user ? 403 : 401);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("rejects old clients before database writes", async () => {
    expect((await PATCH(request({ action: "repartir" }, false), params)).status).toBe(409);
    expect((await POST(request({ attemptId, decision: "aprobar" }, false))).status).toBe(409);
    expect(fetchDb).not.toHaveBeenCalled();
  });
  it.each(["DRAW_PENDING", "POLLA_FINAL", "PENDING_PROOFS", "UNVERIFIED_MATCHES", "UNRESOLVED_QUESTIONS", "NO_PAID_ENTRIES", "UNSOLD_TICKET", "OPERATIONS_PAUSED"])("surfaces SQL conflict %s without a second writer", async (message) => {
    fetchDb.mockResolvedValueOnce(response({ code: "55000", message }, 409));
    const result = await PATCH(request({ action: "repartir" }), params);
    expect(result.status).toBe(409); expect((await result.json()).code).toBe(message);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store"); expect(fetchDb).toHaveBeenCalledTimes(1);
  });
  it.each(["money_awarded", "object_awarded", "object_draw_pending", "house_retained_zero_points"])("preserves the discriminated result %s", async (outcome) => {
    const reparto = { contract: 2, outcome, prize_cop: 0, winners: 0, each_cop: 0, top_points: 0 };
    fetchDb.mockResolvedValueOnce(response(reparto));
    expect(await (await PATCH(request({ action: "repartir", actorId: "forged" }), params)).json()).toEqual({ ok: true, reparto });
    expect(JSON.parse(String(fetchDb.mock.calls[0][1]?.body))).toEqual({ p_polla_id: id, p_actor_id: adminId, p_contract: 2 });
  });
  it("archives through the SQL lock and preserves the RPC idempotent result", async () => {
    fetchDb.mockResolvedValueOnce(response({ slug: "polla", archived: true }));
    expect(await (await PATCH(request({ action: "eliminar" }), params)).json()).toEqual({ ok: true, slug: "polla", archived: true });
    expect(new URL(String(fetchDb.mock.calls[0][0])).pathname).toBe("/rest/v1/rpc/casa_archive_polla_v2");
  });
  it("reviews the displayed attempt, taking the administrator from the session", async () => {
    fetchDb.mockResolvedValueOnce(response({ changed: true, status: "pagada", entry_id: attemptId, polla_id: id }));
    expect((await POST(request({ attemptId, decision: "aprobar", actorId: "forged" }))).status).toBe(200);
    expect(JSON.parse(String(fetchDb.mock.calls[0][1]?.body))).toEqual({ p_attempt_id: attemptId, p_decision: "pagada", p_reason: null, p_contract: 2, p_actor_id: adminId });
    expect(mocks.notifyReview).toHaveBeenCalledExactlyOnceWith(attemptId, id, true);
  });
  it("does not resend a player notice on an idempotent review retry", async () => {
    fetchDb.mockResolvedValueOnce(response({ changed: false, status: "pagada", entry_id: attemptId, polla_id: id }));
    expect((await POST(request({ attemptId, decision: "aprobar" }))).status).toBe(200);
    expect(mocks.notifyReview).not.toHaveBeenCalled();
  });
  it("rejects entry-only legacy review payloads", async () => {
    expect((await POST(request({ entryId: attemptId, decision: "aprobar" }))).status).toBe(400);
    expect(fetchDb).not.toHaveBeenCalled();
  });
  it("does not report success when scoring fails inside the question transaction", async () => {
    fetchDb.mockResolvedValueOnce(response({ code: "XX000", message: "private scoring failure" }, 500));
    const result = await PATCH(request({ action: "responder", questionId: id, optionId: attemptId }), params);
    expect(result.status).toBe(500); expect(JSON.stringify(await result.json())).not.toContain("private scoring failure");
  });
});
