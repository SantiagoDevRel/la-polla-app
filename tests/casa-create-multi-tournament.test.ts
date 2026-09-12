import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({
  getAuthenticatedUser: mocks.user,
  isCurrentUserAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));

import { POST } from "@/app/api/casa/admin/pollas/route";
import { getPollaMatches } from "@/lib/casa/queries";
import { resolveTournamentSlugs } from "@/lib/casa/tournaments";

const pollaId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const fixtures = [
  { id: "10000000-0000-4000-8000-000000000001", tournament: "laliga_2025", scheduled_at: "2026-09-12T17:00:00.000Z" },
  { id: "10000000-0000-4000-8000-000000000002", tournament: "premier_2025", scheduled_at: "2026-09-12T11:00:00.000Z" },
  { id: "10000000-0000-4000-8000-000000000003", tournament: "laliga_2025", scheduled_at: "2026-09-13T17:00:00.000Z" },
];
const matchIds = fixtures.map((match) => match.id);
const links = matchIds.map((match_id, order_index) => ({ polla_id: pollaId, match_id, order_index }));
const savedPolla = { id: pollaId, slug: "dos-ligas" };
const dbFetch = vi.fn<typeof fetch>();

const payload = {
  name: "Dos ligas",
  kind: "partidos",
  tournament: "laliga_2025",
  scoringMode: "marcador",
  matchIds,
  entryPriceCop: 0,
  closeMode: "auto",
  // Deliberately later than every match: automatic closing must ignore this.
  closesAt: "2026-09-20T20:00:00.000Z",
  publish: true,
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/casa/admin/pollas", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" },
    body: JSON.stringify(body),
  });
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function query(index: number) {
  return new URL(String(dbFetch.mock.calls[index][0])).searchParams;
}

function written(index: number) {
  return JSON.parse(String(dbFetch.mock.calls[index][1]?.body));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T10:00:00.000Z"));
  mocks.user.mockResolvedValue({ id: userId, is_admin: true });
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: dbFetch },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CASA creation across tournaments", () => {
  it.each(["laliga_2025", "premier_2025"])("passes all mixed-tournament fixtures unchanged to the atomic creator: %s", async (tournament) => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, ...savedPolla, publicada: true }));
    const result = await POST(request({ ...payload, tournament }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, ...savedPolla, publicada: true });
    expect(written(0)).toMatchObject({ p_config: { matchIds, tournament, closeMode: "auto", closesAt: payload.closesAt }, p_actor_id: userId, p_contract: 2 });
    expect(new URL(String(dbFetch.mock.calls[0][0])).pathname).toBe("/rest/v1/rpc/casa_create_polla_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });
  it("preserves manual closing and draft intent in the SQL transaction", async () => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, ...savedPolla, publicada: false }));
    expect((await POST(request({ ...payload, closeMode: "manual", publish: false }))).status).toBe(200);
    expect(written(0)).toMatchObject({ p_config: { closeMode: "manual", closesAt: payload.closesAt, publish: false, matchIds } });
  });
  it("propagates an elapsed closing time rejected by SQL", async () => {
    dbFetch.mockResolvedValueOnce(response({ code: "22023", message: "INSCRIPTIONS_CLOSED" }, 400));
    expect((await POST(request(payload))).status).toBe(409);
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });
  it("does not make separate writes after creation fails", async () => {
    dbFetch.mockResolvedValueOnce(response({ code: "23503", message: "Missing fixture" }, 409));
    expect((await POST(request(payload))).status).toBe(500);
    expect(dbFetch).toHaveBeenCalledTimes(1);
    expect(dbFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it.each([null, { id: userId, is_admin: false }])("requires admin before any database access: %j", async (user) => {
    mocks.user.mockResolvedValue(user);
    expect((await POST(request(payload))).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it("reads back all linked fixtures in selection order and resolves both tournament logos", async () => {
    dbFetch.mockResolvedValueOnce(response(links))
      .mockResolvedValueOnce(response([fixtures[1], fixtures[2], fixtures[0]]));

    const matches = await getPollaMatches(pollaId);

    expect(matches).toEqual(fixtures);
    expect(query(0).get("polla_id")).toBe(`eq.${pollaId}`);
    expect(query(1).get("id")).toBe(`in.(${matchIds.join(",")})`);
    expect(query(1).has("tournament")).toBe(false);
    expect(resolveTournamentSlugs({ kind: "partidos", tournament: "champions_2025" }, matches)).toEqual([
      "laliga_2025", "premier_2025",
    ]);
    expect(dbFetch).toHaveBeenCalledTimes(2);
  });
});
