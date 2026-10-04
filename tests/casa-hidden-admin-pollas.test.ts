import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
import { getPrivateCampaign, getPrivateCampaignBySlug, listHiddenAdminPollas } from "@/lib/casa/private-draft-query";

const dbFetch = vi.fn<typeof fetch>();
const actor = { id: "00000000-0000-4000-8000-000000000001", is_admin: true };
const other = "00000000-0000-4000-8000-000000000002";
const draft = {
  version: 1, allowed_admin_ids: [actor.id], tie_break: "earliest_registration",
  image_path: null, sources: [], schedule_confirmed: false,
  slots: [{ slot_id: "final-1", order: 1, stage: "final", stage_label: "Final",
    group: null, matchday: null, game_in_group_matchday: null, leg: 1,
    label: "Final", home_label: "Local por confirmar", away_label: "Visitante por confirmar",
    home_team: null, away_team: null, scheduled_at: null, match_id: null }],
};
const pool = { id: "draft", slug: "oculta", name: "Polla oculta", status: "borrador", publication_mode: "oculta", campaign_draft: null, closes_at: "2099-01-01T00:00:00Z" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createAdminClient.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch },
  }));
});

describe("hidden pollas on the administrator's home screen", () => {
  it.each([null, { ...actor, is_admin: false }])("rejects a missing administrator before reading with the service key", async viewer => {
    expect(await listHiddenAdminPollas(viewer)).toEqual([]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("includes ordinary drafts, hidden non-drafts and every valid campaign without returning private metadata", async () => {
    dbFetch.mockResolvedValueOnce(response([
      pool,
      { ...pool, id: "hidden-open", status: "abierta" },
      { ...pool, id: "draft-public-mode", publication_mode: "inmediata" },
      { ...pool, id: "campaign", campaign_draft: draft },
      { ...pool, id: "restricted", campaign_draft: { ...draft, allowed_admin_ids: [other] } },
      { ...pool, id: "invalid", campaign_draft: {} },
    ]));
    const result = await listHiddenAdminPollas(actor);
    expect(result.map(row => row.id)).toEqual(["draft", "hidden-open", "draft-public-mode", "campaign", "restricted"]);
    expect(result.slice(0, 3).every(row => row.private_draft === false)).toBe(true);
    expect(result[3].private_draft).toBe(true);
    expect(result.every(row => !("campaign_draft" in row))).toBe(true);

    const params = new URL(String(dbFetch.mock.calls[0][0])).searchParams;
    expect(params.get("or")).toBe("(status.eq.borrador,publication_mode.eq.oculta)");
    expect(params.get("archived_at")).toBe("is.null");
    expect(params.get("status")).toBe("in.(borrador,abierta)");
    expect(params.get("closes_at")).toMatch(/^gt\./);
    expect(params.get("select")).not.toContain("*");
    expect(params.has("campaign_draft")).toBe(false);
  });

  it("excludes expired, closed, final and blocked pollas while preserving future drafts", async () => {
    const now = new Date("2026-10-04T13:00:00Z");
    dbFetch.mockResolvedValueOnce(response([
      pool,
      { ...pool, id: "future-campaign", campaign_draft: draft },
      { ...pool, id: "expired", closes_at: "2026-10-04T12:59:59Z" },
      { ...pool, id: "boundary", closes_at: now.toISOString() },
      { ...pool, id: "closed", status: "cerrada" },
      { ...pool, id: "settled", status: "resuelta" },
      { ...pool, id: "void", status: "anulada" },
      { ...pool, id: "draw", draw_pending: true },
      { ...pool, id: "settlement", settled_at: now.toISOString() },
      { ...pool, id: "invalid-date", closes_at: "unknown" },
    ]));
    expect((await listHiddenAdminPollas(actor, now)).map(row => row.id)).toEqual(["draft", "future-campaign"]);
    expect(new URL(String(dbFetch.mock.calls[0][0])).searchParams.get("closes_at")).toBe(`gt.${now.toISOString()}`);
  });

  it("reads beyond the PostgREST page limit without losing hidden pollas", async () => {
    dbFetch.mockResolvedValueOnce(response(Array.from({ length: 500 }, (_, i) => ({
      ...pool, id: `restricted-${i}`, campaign_draft: { ...draft, allowed_admin_ids: [other] },
    })))).mockResolvedValueOnce(response([{ ...pool, id: "last-hidden-polla" }]));
    const result = await listHiddenAdminPollas(actor);
    expect(result).toHaveLength(501);
    expect(result[result.length - 1]?.id).toBe("last-hidden-polla");
    expect(dbFetch).toHaveBeenCalledTimes(2);
    const pages = dbFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(pages.map(page => page.get("offset"))).toEqual(["0", "500"]);
    expect(pages.every(page => page.get("order") === "created_at.desc,id.asc")).toBe(true);
  });

  it("distinguishes an empty result from a database failure", async () => {
    dbFetch.mockResolvedValueOnce(response([]));
    expect(await listHiddenAdminPollas(actor)).toEqual([]);
    dbFetch.mockResolvedValueOnce(response({ message: "Database unavailable" }, 400));
    await expect(listHiddenAdminPollas(actor)).rejects.toMatchObject({ message: "Database unavailable" });
  });

  it("opens a private campaign for an administrator outside its historical allowlist", async () => {
    const id = "00000000-0000-4000-8000-000000000010";
    const row = { ...pool, id, campaign_draft: { ...draft, allowed_admin_ids: [other] } };
    dbFetch.mockResolvedValueOnce(response(row));
    expect((await getPrivateCampaign(id, actor))?.polla.id).toBe(id);
    dbFetch.mockResolvedValueOnce(response({ id })).mockResolvedValueOnce(response(row));
    expect((await getPrivateCampaignBySlug(pool.slug, actor))?.polla.id).toBe(id);
    for (const [url] of dbFetch.mock.calls) {
      expect(new URL(String(url)).searchParams.has("campaign_draft")).toBe(false);
    }
  });

  it.each([null, { ...actor, is_admin: false }])("also rejects non-administrators before private detail reads", async viewer => {
    expect(await getPrivateCampaign("00000000-0000-4000-8000-000000000010", viewer)).toBeNull();
    expect(await getPrivateCampaignBySlug(pool.slug, viewer)).toBeNull();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
