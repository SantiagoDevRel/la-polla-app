import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), referral: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/casa/referrals", () => ({ linkReferralFromCookie: mocks.referral }));
import { GET, PATCH } from "@/app/api/users/me/route";

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  profile_revision: 0,
  display_name: "Ana", whatsapp_number: "+573001234567", avatar_url: "millos", is_admin: false,
  default_payout_method: null, default_payout_account: null, default_payout_account_name: null,
  default_payout_account_type: null, default_payout_set_at: null,
};
function query(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "gt", "update"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)));
  return chain;
}
const patch = (body: unknown) => new NextRequest("https://example.test/api/users/me", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: profile.id } } });
  mocks.referral.mockResolvedValue({ linked: false, clearCookie: false });
  mocks.from.mockImplementation(table => query(table === "users"
    ? { data: profile, error: null } : { data: [], count: 0, error: null }));
});

describe("profile route persistence acknowledgement", () => {
  it("returns the persisted row, scoped to the verified user, with no-store", async () => {
    const saved = { ...profile, profile_revision: 1, display_name: "Sofía" };
    const chain = query({ data: saved, error: null });
    mocks.from.mockReturnValue(chain);
    const response = await PATCH(patch({ display_name: " Sofía ", is_admin: true, profile_revision: 99, expected_user_id: profile.id, expected_revision: 0 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, profile: saved });
    expect(chain.update).toHaveBeenCalledWith({ display_name: "Sofía" });
    expect(chain.eq).toHaveBeenCalledWith("id", profile.id);
    expect(chain.eq).toHaveBeenCalledWith("profile_revision", 0);
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("default_payout_account"));
    expect(chain.select).not.toHaveBeenCalledWith("*");
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.cookies.get("lp_onb")?.value).toBe("1");
  });
  it.each([GET, () => PATCH(patch({ display_name: "Sofía" }))])("rejects unauthenticated requests before DB access", async handler => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await handler();
    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("does not report success for an update affecting no row", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    const response = await PATCH(patch({ display_name: "Sofía" }));
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("success");
  });
  it("rejects a stale page's owner id before accessing the database", async () => {
    const response = await PATCH(patch({ display_name: "Sofía", expected_user_id: "00000000-0000-4000-8000-000000000002" }));
    expect(response.status).toBe(412);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects a stale profile revision without claiming any saved row", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    const response = await PATCH(patch({ display_name: "Sofía", expected_user_id: profile.id, expected_revision: 0 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PROFILE_CHANGED" });
    expect(mocks.referral).not.toHaveBeenCalled();
  });
  it("does not report a missing profile as a successful read", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    expect((await GET()).status).toBe(404);
  });
  it("does not disguise failed profile statistics as zero", async () => {
    mocks.from.mockImplementation(table => query(table === "users"
      ? { data: profile, error: null } : { data: null, error: { name: "DatabaseError" } }));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("stats");
  });
  it("returns persisted normalized payout fields", async () => {
    const chain = query({ data: { ...profile, default_payout_method: "nequi", default_payout_account: "3001234567" }, error: null });
    mocks.from.mockReturnValue(chain);
    const response = await PATCH(patch({ default_payout_method: "nequi", default_payout_account: " 3001234567 ", default_payout_account_name: "Ignored" }));
    expect(response.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      default_payout_method: "nequi", default_payout_account: "3001234567",
      default_payout_account_name: null, default_payout_account_type: null,
    }));
  });
});
