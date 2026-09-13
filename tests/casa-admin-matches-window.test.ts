import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), user: vi.fn(), db: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ isCurrentUserAdmin: mocks.admin, getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
vi.mock("@/lib/matches/refresh-schedule", () => ({ refreshTournamentSchedule: mocks.refresh }));

import { GET } from "@/app/api/casa/admin/matches/route";
import { POST } from "@/app/api/casa/admin/pollas/route";
import { PATCH } from "@/app/api/casa/admin/pollas/[id]/route";

const now = new Date("2026-09-13T15:00:00.000Z");
const day = 86_400_000;
const adminId = "00000000-0000-4000-8000-000000000001";
const pollaId = "00000000-0000-4000-8000-000000000002";
const matchIds = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const dbFetch = vi.fn<typeof fetch>();

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const call = (index: number) => new URL(String(dbFetch.mock.calls[index][0]));
const calendar = (query: string) => GET(new NextRequest(`http://localhost/api/casa/admin/matches?${query}`));
const createRequest = (body: unknown) => new NextRequest("http://localhost/api/casa/admin/pollas", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" }, body: JSON.stringify(body),
});
const patchRequest = (body: unknown) => new NextRequest(`http://localhost/api/casa/admin/pollas/${pollaId}`, {
  method: "PATCH", headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ id: pollaId }) };

const partidos = {
  name: "Fecha 5", kind: "partidos", tournament: "premier_2025", scoringMode: "1x2", matchIds,
  entryPriceCop: 0, closeMode: "auto", closesAt: "2026-09-20T17:00:00.000Z", publish: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.admin.mockResolvedValue(true);
  mocks.user.mockResolvedValue({ id: adminId, is_admin: true });
  mocks.refresh.mockResolvedValue(true);
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch },
  }));
});
afterEach(() => vi.useRealTimers());

describe("admin calendar window", () => {
  it("keeps the 10-day default, explicit columns and the 1000-row limit", async () => {
    dbFetch.mockResolvedValueOnce(response([{ id: matchIds[0] }]));
    const res = await calendar("tournament=premier_2025");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ dias: 10, todo: false, nextMatch: null, truncated: false, scheduleRefreshed: true });
    const q = call(0).searchParams;
    expect(call(0).pathname).toBe("/rest/v1/matches");
    expect(q.get("select")).toBe("id,home_team,away_team,home_team_flag,away_team_flag,scheduled_at,scheduled_at_confirmed,match_day");
    expect(q.get("tournament")).toBe("eq.premier_2025");
    expect(q.getAll("scheduled_at")).toEqual([`gt.${now.toISOString()}`, `lt.${new Date(now.getTime() + 10 * day).toISOString()}`]);
    expect(q.get("limit")).toBe("1000");
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith("premier_2025");
  });

  it.each([
    ["dias=30", 30], ["dias=240", 240], ["dias=900", 240], ["dias=0", 1], ["dias=abc", 10], ["dias=45.7", 45],
  ])("clamps %s to %i days", async (query, expected) => {
    dbFetch.mockResolvedValueOnce(response([{ id: matchIds[0] }]));
    const res = await calendar(`tournament=premier_2025&${query}`);
    expect((await res.json()).dias).toBe(expected);
    expect(call(0).searchParams.getAll("scheduled_at")[1]).toBe(`lt.${new Date(now.getTime() + expected * day).toISOString()}`);
  });

  it("todo=1 reads every upcoming fixture without an upper bound and skips the next-match lookup", async () => {
    dbFetch.mockResolvedValueOnce(response([]));
    const res = await calendar("tournament=premier_2025&todo=1&dias=5");
    expect(await res.json()).toMatchObject({ matches: [], dias: null, todo: true, nextMatch: null });
    expect(call(0).searchParams.getAll("scheduled_at")).toEqual([`gt.${now.toISOString()}`]);
    expect(call(0).searchParams.get("limit")).toBe("1000");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("flags a result that reached the row limit", async () => {
    dbFetch.mockResolvedValueOnce(response(Array.from({ length: 1000 }, (_, i) => ({ id: String(i) }))));
    expect((await (await calendar("tournament=premier_2025&todo=1")).json()).truncated).toBe(true);
  });

  it("still reports the next stored match after an empty bounded window", async () => {
    const next = { scheduled_at: "2026-10-13T19:00:00+00:00", scheduled_at_confirmed: false };
    dbFetch.mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(next));
    const res = await calendar("tournament=premier_2025&dias=30");
    expect((await res.json()).nextMatch).toEqual(next);
    expect(call(1).searchParams.get("scheduled_at")).toBe(`gte.${new Date(now.getTime() + 30 * day).toISOString()}`);
    expect(call(1).searchParams.get("status")).toBe("eq.scheduled");
  });

  it("requires admin before refreshing or reading", async () => {
    mocks.admin.mockResolvedValue(false);
    expect((await calendar("tournament=premier_2025&todo=1")).status).toBe(403);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("rejects a tournament the house cannot create", async () => {
    expect((await calendar("tournament=nope&todo=1")).status).toBe(400);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(dbFetch).not.toHaveBeenCalled();
  });
});

// (2026-09-13, migración 118) Los partidos con hora por confirmar ya no bloquean
// el cierre automático: el cierre sigue al calendario en SQL. Crear y publicar
// van directo al RPC, sin leer horarios desde la ruta.
describe("automatic closing with provisional kickoffs on creation", () => {
  it("creates with automatic closing even when a selected match has no confirmed time, straight to the RPC", async () => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, id: pollaId, slug: "fecha-5", publicada: true }));
    const res = await POST(createRequest(partidos));
    expect(res.status).toBe(200);
    expect(call(0).pathname).toBe("/rest/v1/rpc/casa_create_polla_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
    expect(dbFetch.mock.calls.some(([url]) => String(url).includes("/rest/v1/matches"))).toBe(false);
  });

  it("keeps manual closing on the same single RPC call", async () => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, id: pollaId, slug: "fecha-5", publicada: true }));
    expect((await POST(createRequest({ ...partidos, closeMode: "manual" }))).status).toBe(200);
    expect(call(0).pathname).toBe("/rest/v1/rpc/casa_create_polla_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("does not echo database errors", async () => {
    dbFetch.mockResolvedValueOnce(response({ message: "boom", code: "XX000" }, 500));
    const res = await POST(createRequest(partidos));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });

  it("requires admin before touching the database", async () => {
    mocks.user.mockResolvedValue({ id: adminId, is_admin: false });
    expect((await POST(createRequest(partidos))).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("publication no longer reads kickoffs", () => {
  it.each([
    [{ action: "publicar" }, "casa_change_status_v2"],
    [{ action: "publicacion", mode: "ahora" }, "casa_set_publication_v2"],
    [{ action: "publicacion", mode: "oculta" }, "casa_set_publication_v2"],
  ])("goes straight to the RPC: %j", async (body, rpc) => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, slug: "fecha-5" }));
    expect((await PATCH(patchRequest(body), params)).status).toBe(200);
    expect(call(0).pathname).toBe(`/rest/v1/rpc/${rpc}`);
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });
});
