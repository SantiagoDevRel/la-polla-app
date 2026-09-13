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
const PROVISIONAL = "Hay partidos con hora por confirmar. Elige cierre manual o quítalos.";

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

describe("provisional kickoff guard on creation", () => {
  it("rejects automatic closing when a selected match has no confirmed time, before the RPC", async () => {
    dbFetch.mockResolvedValueOnce(response([
      { id: matchIds[0], scheduled_at_confirmed: true }, { id: matchIds[1], scheduled_at_confirmed: false },
    ]));
    const res = await POST(createRequest(partidos));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: PROVISIONAL, code: "PROVISIONAL_KICKOFF" });
    expect(call(0).pathname).toBe("/rest/v1/matches");
    expect(call(0).searchParams.get("select")).toBe("id,scheduled_at_confirmed");
    expect(call(0).searchParams.get("id")).toBe(`in.(${matchIds.join(",")})`);
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a hidden draft with automatic closing too", async () => {
    dbFetch.mockResolvedValueOnce(response([{ id: matchIds[0], scheduled_at_confirmed: false }]));
    expect((await POST(createRequest({ ...partidos, publish: false }))).status).toBe(400);
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("creates with automatic closing when every time is confirmed", async () => {
    dbFetch.mockResolvedValueOnce(response(matchIds.map((id) => ({ id, scheduled_at_confirmed: true }))))
      .mockResolvedValueOnce(response({ ok: true, id: pollaId, slug: "fecha-5", publicada: true }));
    const res = await POST(createRequest(partidos));
    expect(res.status).toBe(200);
    expect(call(1).pathname).toBe("/rest/v1/rpc/casa_create_polla_v2");
    expect(dbFetch).toHaveBeenCalledTimes(2);
  });

  it("allows provisional matches with manual closing without an extra read", async () => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, id: pollaId, slug: "fecha-5", publicada: true }));
    expect((await POST(createRequest({ ...partidos, closeMode: "manual" }))).status).toBe(200);
    expect(call(0).pathname).toBe("/rest/v1/rpc/casa_create_polla_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("does not create when the kickoff check cannot be read", async () => {
    dbFetch.mockResolvedValueOnce(response({ message: "boom" }, 500));
    const res = await POST(createRequest(partidos));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("requires admin before the kickoff check", async () => {
    mocks.user.mockResolvedValue({ id: adminId, is_admin: false });
    expect((await POST(createRequest(partidos))).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("provisional kickoff guard on publication", () => {
  const draft = { kind: "partidos", close_mode: "auto", status: "borrador", opens_at: null };

  it.each([{ action: "publicar" }, { action: "publicacion", mode: "ahora" }])("blocks publishing an automatic-close draft with a provisional match: %j", async (body) => {
    dbFetch.mockResolvedValueOnce(response(draft))
      .mockResolvedValueOnce(response(matchIds.map((match_id) => ({ match_id }))))
      .mockResolvedValueOnce(response([{ id: matchIds[0], scheduled_at_confirmed: true }, { id: matchIds[1], scheduled_at_confirmed: false }]));
    const res = await PATCH(patchRequest(body), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PROVISIONAL);
    expect(call(2).searchParams.get("id")).toBe(`in.(${matchIds.join(",")})`);
    expect(dbFetch.mock.calls.some(([url]) => String(url).includes("/rpc/"))).toBe(false);
  });

  it.each([{ action: "publicar" }, { action: "publicacion", mode: "ahora" }])("blocks publishing a scheduled (not yet visible) automatic-close pool with a provisional match: %j", async (body) => {
    const scheduled = { ...draft, status: "abierta", opens_at: new Date(now.getTime() + day).toISOString() };
    dbFetch.mockResolvedValueOnce(response(scheduled))
      .mockResolvedValueOnce(response(matchIds.map((match_id) => ({ match_id }))))
      .mockResolvedValueOnce(response([{ id: matchIds[0], scheduled_at_confirmed: false }]));
    const res = await PATCH(patchRequest(body), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: PROVISIONAL, code: "PROVISIONAL_KICKOFF" });
    expect(call(1).pathname).toBe("/rest/v1/casa_polla_matches");
    expect(dbFetch).toHaveBeenCalledTimes(3);
    expect(dbFetch.mock.calls.some(([url]) => String(url).includes("/rpc/"))).toBe(false);
  });

  it("leaves an already visible pool to the RPC without reading its matches", async () => {
    const visible = { ...draft, status: "abierta", opens_at: new Date(now.getTime() - day).toISOString() };
    dbFetch.mockResolvedValueOnce(response(visible))
      .mockResolvedValueOnce(response({ ok: true, slug: "fecha-5", publication_mode: "ahora" }));
    expect((await PATCH(patchRequest({ action: "publicacion", mode: "ahora" }), params)).status).toBe(200);
    expect(call(1).pathname).toBe("/rest/v1/rpc/casa_set_publication_v2");
    expect(dbFetch).toHaveBeenCalledTimes(2);
  });

  it("publishes an automatic-close draft whose times are confirmed", async () => {
    dbFetch.mockResolvedValueOnce(response(draft))
      .mockResolvedValueOnce(response(matchIds.map((match_id) => ({ match_id }))))
      .mockResolvedValueOnce(response(matchIds.map((id) => ({ id, scheduled_at_confirmed: true }))))
      .mockResolvedValueOnce(response({ slug: "fecha-5", status: "abierta" }));
    expect((await PATCH(patchRequest({ action: "publicar" }), params)).status).toBe(200);
    expect(call(3).pathname).toBe("/rest/v1/rpc/casa_change_status_v2");
  });

  it("publishes a manual-close draft without reading its matches", async () => {
    dbFetch.mockResolvedValueOnce(response({ ...draft, close_mode: "manual" }))
      .mockResolvedValueOnce(response({ slug: "fecha-5", status: "abierta" }));
    expect((await PATCH(patchRequest({ action: "publicar" }), params)).status).toBe(200);
    expect(call(1).pathname).toBe("/rest/v1/rpc/casa_change_status_v2");
    expect(dbFetch).toHaveBeenCalledTimes(2);
  });

  it("does not check when hiding a pool", async () => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, slug: "fecha-5", publication_mode: "oculta" }));
    expect((await PATCH(patchRequest({ action: "publicacion", mode: "oculta" }), params)).status).toBe(200);
    expect(call(0).pathname).toBe("/rest/v1/rpc/casa_set_publication_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });
});
