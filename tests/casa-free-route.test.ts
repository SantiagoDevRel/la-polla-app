import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), pool: vi.fn(), join: vi.fn(), entry: vi.fn(), referral: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/casa/queries", () => ({ getMyEntry: mocks.entry, getPollaBySlug: mocks.pool, joinFreePolla: mocks.join }));
vi.mock("@/lib/casa/referrals", () => ({ linkReferralFromCookie: mocks.referral }));
import { GET, POST } from "@/app/api/casa/pollas/[slug]/unirme/route";
import { CASA_HEADERS } from "@/lib/casa/contract";
const params = { params: Promise.resolve({ slug: "gift" }) };
const request = (headers: HeadersInit = CASA_HEADERS) => new Request("http://localhost/api/casa/pollas/gift/unirme", {
  method: "POST", headers, body: JSON.stringify({ userId: "attacker", amountCop: 1000 }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "session-user" } } });
  mocks.pool.mockResolvedValue({ id: "pool", slug: "gift", status: "abierta" });
  mocks.join.mockResolvedValue({ ok: true, slug: "gift", entry_id: "entry", entry_number: 1, created: true });
  mocks.entry.mockResolvedValue(null);
  mocks.referral.mockResolvedValue({ clearCookie: false });
});
it("requires authentication before reading or enrolling", async () => {
  mocks.user.mockResolvedValue({ data: { user: null } });
  expect((await POST(request(), params)).status).toBe(401);
  expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.join).not.toHaveBeenCalled();
});
it("requires the current contract before reading the pool", async () => {
  expect((await POST(request({}), params)).status).toBe(409);
  expect(mocks.pool).not.toHaveBeenCalled();
});
it("enrolls the authenticated user immediately, without accepting client identity or payment", async () => {
  const response = await POST(request(), params);
  expect(response.status).toBe(200);
  expect(mocks.join).toHaveBeenCalledExactlyOnceWith("pool", "session-user");
  expect(await response.json()).toMatchObject({ ok: true, entry_id: "entry" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("does not enroll a hidden draft", async () => {
  mocks.pool.mockResolvedValue({ id: "pool", status: "borrador" });
  expect((await POST(request(), params)).status).toBe(404);
  expect(mocks.join).not.toHaveBeenCalled();
});
it("preserves server rejection for a paid or closed pool", async () => {
  mocks.join.mockRejectedValue({ message: "NOT_FREE", code: "55000" });
  const response = await POST(request(), params);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "NOT_FREE" });
});
it("reconciliation authenticates before reading and never enrolls", async () => {
  mocks.user.mockResolvedValue({ data: { user: null } });
  expect((await GET(request(), params)).status).toBe(401);
  expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.entry).not.toHaveBeenCalled(); expect(mocks.join).not.toHaveBeenCalled();
});
it("reconciliation confirms only an owned paid entry without writing", async () => {
  mocks.entry.mockResolvedValue({ id: "entry", entry_number: 1, status: "pagada" });
  const response = await GET(request(), params);
  expect(await response.json()).toEqual({ ok: true, owner_id: "session-user", slug: "gift", joined: true, entry: { entry_id: "entry", entry_number: 1, status: "pagada" } });
  expect(mocks.entry).toHaveBeenCalledExactlyOnceWith("pool", "session-user");
  expect(mocks.join).not.toHaveBeenCalled(); expect(mocks.referral).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("a pending reservation is not a completed enrollment", async () => {
  mocks.entry.mockResolvedValue({ id: "entry", status: "pendiente" });
  expect(await (await GET(request(), params)).json()).toMatchObject({ joined: false, entry: null });
});
it("never replaces an invalid SQL enrollment ACK with success", async () => {
  mocks.join.mockResolvedValue({ ok: false, slug: "gift", entry_id: "entry" });
  expect((await POST(request(), params)).status).toBe(503);
});
it("never enrolls another account after login recovery changed its cookies", async () => {
  const response = await POST(request({ ...CASA_HEADERS, "X-Casa-Owner": "original-user" }), params);
  expect(response.status).toBe(412); expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.join).not.toHaveBeenCalled();
});
