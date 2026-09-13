import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.user, isCurrentUserAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));

import { POST } from "@/app/api/casa/admin/pollas/route";
import { GET as preview } from "@/app/api/casa/admin/prize-preview/route";
import { getPollaBySlug, listPublicPollas } from "@/lib/casa/queries";
import { isPollaPublished, type CasaPolla } from "@/lib/casa/types";

const adminId = "00000000-0000-4000-8000-000000000001";
const poolId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-13T15:00:00.000Z");
const dbFetch = vi.fn<typeof fetch>();
const config = {
  name: "Premio fijo", kind: "manual", prizeKind: "pozo", potMode: "fijo", fixedPrizeCop: 1000000,
  // Migration 109: a fixed prize is a guaranteed minimum and accepts any house cut.
  entryPriceCop: 10000, houseCutPct: 50, closesAt: "2026-09-14T17:00:00.000Z", closeMode: "manual",
  publicationMode: "programada", publishesAt: "2026-09-14T12:00:00.000Z",
  payoutMethod: "nequi", payoutAccount: "local-fixture",
  questions: [{ prompt: "Pregunta de prueba", points: 3, inputKind: "opciones", options: ["A", "B"] }],
};
const request = (body: unknown) => new NextRequest("http://localhost/api/casa/admin/pollas", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" }, body: JSON.stringify(body),
});
const previewRequest = (query = "price=10000&cut=50&tickets=200&kind=pozo&mode=fijo&fixed=1000000") =>
  new Request(`http://localhost/api/casa/admin/prize-preview?${query}`);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const written = () => JSON.parse(String(dbFetch.mock.calls[0][1]?.body));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.user.mockResolvedValue({ id: adminId, is_admin: true });
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch },
  }));
});
afterEach(() => vi.useRealTimers());

describe("fixed-prize creation and preview API", () => {
  it("passes the fixed amount and publication instant unchanged into one atomic SQL writer", async () => {
    const result = { ok: true, id: poolId, slug: "premio-fijo", programada: true, publicada: false };
    dbFetch.mockResolvedValueOnce(response(result));
    const res = await POST(request({ ...config, actorId: "forged" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual(result);
    expect(written()).toMatchObject({ p_config: config, p_actor_id: adminId, p_contract: 2 });
    expect(written().p_config).not.toHaveProperty("actorId");
    expect(new URL(String(dbFetch.mock.calls[0][0])).pathname).toBe("/rest/v1/rpc/casa_create_polla_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it.each([0, 50, 100])("accepts a fixed prize with a %i%% house cut and sends it unchanged to SQL", async (houseCutPct) => {
    dbFetch.mockResolvedValueOnce(response({ ok: true, id: poolId, slug: "premio-fijo" }));
    expect((await POST(request({ ...config, houseCutPct }))).status).toBe(200);
    expect(written().p_config).toMatchObject({ potMode: "fijo", fixedPrizeCop: 1000000, houseCutPct });
  });

  it.each([
    { fixedPrizeCop: undefined }, { fixedPrizeCop: 0 }, { fixedPrizeCop: 1000000001 },
    { houseCutPct: 101 }, { houseCutPct: -1 }, { prizeKind: "objeto", prizeObject: "Camiseta" }, { publishesAt: undefined },
  ])("rejects an incomplete or conflicting fixed/publication config before DB: %j", async (patch) => {
    expect((await POST(request({ ...config, ...patch }))).status).toBe(400);
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it.each(["INVALID_PUBLICATION_DATE", "INVALID_FIXED_PRIZE"])("returns SQL's final rejection without retrying or writing children: %s", async (message) => {
    dbFetch.mockResolvedValueOnce(response({ code: "22023", message }, 400));
    const res = await POST(request(config));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(message);
    if (message === "INVALID_FIXED_PRIZE") expect(body.error).toBe("Elige un premio fijo mayor a cero.");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  // Owner examples (entry 10.000, guaranteed 1.000.000). The numbers are SQL's
  // (scripts/casa-publication-prize-check.sql asserts them); the API relays them.
  it.each([
    { cut: 50, tickets: 200, result: { fixed_prize: 1000000, entries_to_cover: 100, entry_prize: 5000, entry_house: 5000,
      ten_prize: 1000000, ten_balance: -900000, all_prize: 1500000, all_balance: 500000 } },
    { cut: 0, tickets: 150, result: { fixed_prize: 1000000, entries_to_cover: 100, entry_prize: 10000, entry_house: 0,
      ten_prize: 1000000, ten_balance: -900000, all_prize: 1500000, all_balance: 0 } },
    { cut: 100, tickets: 150, result: { fixed_prize: 1000000, entries_to_cover: 100, entry_prize: 0, entry_house: 10000,
      ten_prize: 1000000, ten_balance: -900000, all_prize: 1000000, all_balance: 500000 } },
  ])("relays SQL's guaranteed-minimum preview with a $cut% house cut", async ({ cut, tickets, result }) => {
    dbFetch.mockResolvedValueOnce(response(result));
    const res = await preview(previewRequest(`price=10000&cut=${cut}&tickets=${tickets}&kind=pozo&mode=fijo&fixed=1000000`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(written()).toEqual({ p_price: 10000, p_cut: cut, p_fixed: 1000000, p_tickets: tickets });
    expect(new URL(String(dbFetch.mock.calls[0][0])).pathname).toBe("/rest/v1/rpc/casa_fixed_prize_threshold_preview_v2");
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it("relays a free entry: no entries cover the prize and the house covers it all", async () => {
    const result = { fixed_prize: 1000000, entries_to_cover: null, entry_prize: 0, entry_house: 0,
      ten_prize: 1000000, ten_balance: -1000000, all_prize: 1000000, all_balance: -1000000 };
    dbFetch.mockResolvedValueOnce(response(result));
    const res = await preview(previewRequest("price=0&cut=50&tickets=100&kind=pozo&mode=fijo&fixed=1000000"));
    expect(await res.json()).toEqual(result);
  });

  it.each([
    "price=10000&cut=0&tickets=1000&kind=objeto&mode=fijo&fixed=1000000",
    "price=10000&cut=0&tickets=1000&kind=pozo&mode=fijo",
    "price=10000&cut=101&tickets=1000&kind=pozo&mode=fijo&fixed=1000000",
  ])("rejects an inconsistent fixed preview: %s", async (query) => {
    expect((await preview(previewRequest(query))).status).toBe(400);
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it.each(["pozo", "objeto"])("keeps the existing proportional/object preview RPC: %s", async (kind) => {
    dbFetch.mockResolvedValueOnce(response({ entry_prize: kind === "pozo" ? 7000 : 0 }));
    expect((await preview(previewRequest(`price=10000&cut=30&tickets=100&kind=${kind}`))).status).toBe(200);
    expect(written()).toEqual({ p_price: 10000, p_cut: 30, p_tickets: 100, p_object: kind === "objeto" });
    expect(new URL(String(dbFetch.mock.calls[0][0])).pathname).toBe("/rest/v1/rpc/casa_prize_preview_v2");
  });

  it.each([null, { id: adminId, is_admin: false }])("requires admin before creation or preview DB work: %j", async (user) => {
    mocks.user.mockResolvedValue(user);
    expect((await POST(request(config))).status).toBe(403);
    expect((await preview(previewRequest())).status).toBe(user ? 403 : 401);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("publication reads", () => {
  it.each([
    { status: "borrador", publication_mode: "oculta", opens_at: "2026-09-12T15:00:00Z" },
    { status: "abierta", publication_mode: "oculta", opens_at: "2026-09-12T15:00:00Z" },
    { status: "abierta", publication_mode: "programada", opens_at: "2026-09-13T15:00:00.001Z" },
  ] as const)("hides an unpublished row even if the privileged DB client returns it: %j", async (row) => {
    dbFetch.mockResolvedValueOnce(response({ ...row, id: poolId, slug: "oculta", prize_kind: "pozo" }));
    expect(await getPollaBySlug("oculta")).toBeNull();
    expect(isPollaPublished(row, now)).toBe(false);
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["2026-09-13T14:59:59.999Z", "2026-09-13T15:00:00.000Z"])("shows a scheduled pool as soon as its instant arrives: %s", async (opens_at) => {
    const row = { id: poolId, slug: "programada", status: "abierta", publication_mode: "programada", opens_at, prize_kind: "pozo" } as CasaPolla;
    dbFetch.mockResolvedValueOnce(response(row));
    expect(await getPollaBySlug("programada")).toMatchObject(row);
    expect(isPollaPublished(row, now)).toBe(true);
  });

  it("filters the listing at the database before returning privileged rows", async () => {
    dbFetch.mockImplementation(async (input) => {
      const query = new URL(String(input)).searchParams;
      // This is the public read contract; omitting either condition would leak
      // future or intentionally hidden rows from the service-role query.
      expect(query.get("publication_mode")).toBe("neq.oculta");
      expect(query.get("opens_at")).toBe(`lte.${now.toISOString()}`);
      expect(query.getAll("status")).toEqual(expect.arrayContaining(["neq.borrador", "neq.anulada"]));
      return response([]);
    });
    expect(await listPublicPollas()).toEqual([]);
    expect(dbFetch).toHaveBeenCalledTimes(1);
  });
});
