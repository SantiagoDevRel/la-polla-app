import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), pot: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
vi.mock("@/lib/casa/queries", () => ({ getPot: mocks.pot }));
vi.mock("@/lib/telegram/notify", () => ({ signedProofUrl: vi.fn() }));
import { PATCH } from "@/app/api/casa/admin/pollas/[id]/route";
import { POST } from "@/app/api/casa/admin/entries/route";

const id = "00000000-0000-4000-8000-000000000001";
const adminId = "00000000-0000-4000-8000-000000000002";
const entryId = "00000000-0000-4000-8000-000000000003";
const fetchDb = vi.fn<typeof fetch>();
const params = { params: Promise.resolve({ id }) };
const request = (body: unknown) => new NextRequest("http://localhost/api/casa/admin/test", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const pendingCount = (count: number) => new Response(null, { headers: { "Content-Range": `0-0/${count}` } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: adminId, is_admin: true });
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDb },
  }));
  mocks.pot.mockResolvedValue({ prize_cop: 7000 });
});

describe("CASA archive and lifecycle API", () => {
  it.each([null, { id: adminId, is_admin: false }])("requires admin before database access: %j", async (user) => {
    mocks.user.mockResolvedValue(user);
    expect((await PATCH(request({ action: "eliminar", confirmName: "Prueba" }), params)).status).toBe(user ? 403 : 401);
    expect((await POST(request({ entryId, decision: "aprobar" }))).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("allows the other administrator to confirm without typing a pool name", async () => {
    const otherAdminId = "00000000-0000-4000-8000-000000000004";
    mocks.user.mockResolvedValue({ id: otherAdminId, is_admin: true });
    fetchDb.mockResolvedValueOnce(response({ id, name: "Polla de prueba", archived_at: null }))
      .mockResolvedValueOnce(response({ id, slug: "prueba", archived_at: "2026-09-09T00:00:00Z" }));
    expect((await PATCH(request({ action: "eliminar" }), params)).status).toBe(200);
    expect(JSON.parse(String(fetchDb.mock.calls[1][1]?.body)).archived_by).toBe(otherAdminId);
    expect(fetchDb).toHaveBeenCalledTimes(2);
  });

  it("archives without deleting or rewriting status, entries or payouts", async () => {
    fetchDb.mockResolvedValueOnce(response({ id, name: "Prueba", archived_at: null }))
      .mockResolvedValueOnce(response({ id, slug: "prueba", archived_at: "2026-09-08T00:00:00Z" }));
    const result = await PATCH(request({ action: "eliminar", confirmName: "Prueba" }), params);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, slug: "prueba", archived: true });
    const [url, init] = fetchDb.mock.calls[1];
    expect(init?.method).toBe("PATCH");
    expect(new URL(String(url)).pathname).toBe("/rest/v1/casa_pollas");
    expect(new URL(String(url)).searchParams.get("archived_at")).toBe("is.null");
    expect(JSON.parse(String(init?.body))).toEqual({ archived_at: expect.any(String), archived_by: adminId });
    expect(fetchDb).toHaveBeenCalledTimes(2);
  });

  it("rejects a repeated archive without mutations", async () => {
    fetchDb.mockResolvedValueOnce(response({ id, name: "Prueba", archived_at: "2026-09-08T00:00:00Z" }));
    expect((await PATCH(request({ action: "eliminar", confirmName: "Prueba" }), params)).status).toBe(409);
    expect(fetchDb).toHaveBeenCalledTimes(1);
  });

  it("cannot settle while a payment proof is pending", async () => {
    fetchDb.mockResolvedValueOnce(response({ id, slug: "prueba", status: "cerrada", kind: "rifa", drawn_number: 1 }))
      .mockResolvedValueOnce(pendingCount(1));
    const result = await PATCH(request({ action: "repartir" }), params);
    expect(result.status).toBe(409);
    expect((await result.json()).error).toContain("comprobantes pendientes");
    expect(fetchDb).toHaveBeenCalledTimes(2);
    const query = new URL(String(fetchDb.mock.calls[1][0])).searchParams;
    expect(query.get("polla_id")).toBe(`eq.${id}`);
    expect(query.get("proof_path")).toBe("not.is.null");
    expect(query.get("status")).toBe("eq.pendiente");
  });

  it("surfaces atomic settlement conflicts as 409", async () => {
    fetchDb.mockResolvedValueOnce(response({ id, slug: "prueba", status: "cerrada", kind: "rifa", drawn_number: 1 }))
      .mockResolvedValueOnce(pendingCount(0))
      .mockResolvedValueOnce(response({ code: "55000", message: "Revisa todos los comprobantes pendientes antes de repartir el pozo." }, 409));
    expect((await PATCH(request({ action: "repartir" }), params)).status).toBe(409);
    expect(new URL(String(fetchDb.mock.calls[2][0])).pathname).toBe("/rest/v1/rpc/casa_settle_polla");
  });

  it.each([
    { status: "resuelta", archived_at: null },
    { status: "anulada", archived_at: null },
    { status: "cerrada", archived_at: "2026-09-08T00:00:00Z" },
  ])("does not approve payments after terminal state: %j", async (polla) => {
    fetchDb.mockResolvedValueOnce(response({ id: entryId, polla_id: id, status: "pendiente" }))
      .mockResolvedValueOnce(response({ id, ...polla }));
    expect((await POST(request({ entryId, decision: "aprobar" }))).status).toBe(409);
    expect(fetchDb).toHaveBeenCalledTimes(2);
    expect(fetchDb.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("handles an archive between payment preflight and update", async () => {
    fetchDb.mockResolvedValueOnce(response({ id: entryId, polla_id: id, status: "pendiente" }))
      .mockResolvedValueOnce(response({ id, status: "cerrada", archived_at: null }))
      .mockResolvedValueOnce(response({ code: "55000", message: "Esta polla ya se eliminó." }, 409));
    expect((await POST(request({ entryId, decision: "aprobar" }))).status).toBe(409);
    expect(mocks.pot).not.toHaveBeenCalled();
  });

  it("still approves pending payments in closed pools before settlement", async () => {
    fetchDb.mockResolvedValueOnce(response({ id: entryId, polla_id: id, status: "pendiente" }))
      .mockResolvedValueOnce(response({ id, status: "cerrada", archived_at: null }))
      .mockResolvedValueOnce(response({ id: entryId, polla_id: id }));
    const result = await POST(request({ entryId, decision: "aprobar" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, pozoCop: 7000 });
    const update = JSON.parse(String(fetchDb.mock.calls[2][1]?.body));
    expect(update).toMatchObject({ status: "pagada", reviewed_by: adminId });
  });
});
