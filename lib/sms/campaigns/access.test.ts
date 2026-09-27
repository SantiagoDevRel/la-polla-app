import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("./server", () => ({ campaignCatalog: vi.fn(), campaignHistory: vi.fn(), campaignSchema: {}, previewCampaign: vi.fn(), sendCampaign: vi.fn() }));
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { isSmsOwner } from "./access";
import { GET, POST } from "@/app/api/admin/sms-campaigns/route";
import { campaignCatalog, previewCampaign, sendCampaign } from "./server";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("fails closed with missing config and requires account identity AND admin", () => {
  vi.stubEnv("SMS_CAMPAIGN_OWNER_ID", "");
  expect(isSmsOwner({ id: "owner", is_admin: true })).toBe(false);
  expect(isSmsOwner(null, "owner")).toBe(false);
  expect(isSmsOwner({ id: "owner", is_admin: false }, "owner")).toBe(false);
  expect(isSmsOwner({ id: "other-admin", is_admin: true }, "owner")).toBe(false);
  expect(isSmsOwner({ id: "owner", is_admin: true }, "owner")).toBe(true);
});
it.each([null, { id: "other-admin", is_admin: true }, { id: "owner", is_admin: false }])("denies catalog and every mutation before business data/provider calls: %j", async user => {
  vi.stubEnv("SMS_CAMPAIGN_OWNER_ID", "owner");
  vi.mocked(getAuthenticatedUser).mockResolvedValue(user as Awaited<ReturnType<typeof getAuthenticatedUser>>);
  expect((await GET(new Request("https://lapollacolombiana.com/api/admin/sms-campaigns"))).status).toBe(403);
  for (const action of ["preview", "send", "suppress"]) {
    const response = await POST(new Request("https://lapollacolombiana.com/api/admin/sms-campaigns", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://lapollacolombiana.com" }, body: JSON.stringify({ action, ownerId: "owner", is_admin: true, confirmed: true }) }));
    expect(response.status).toBe(403);
  }
  expect(campaignCatalog).not.toHaveBeenCalled(); expect(previewCampaign).not.toHaveBeenCalled(); expect(sendCampaign).not.toHaveBeenCalled();
});
it("rejects cross-origin owner requests", async () => {
  vi.stubEnv("SMS_CAMPAIGN_OWNER_ID", "owner");
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "owner", is_admin: true } as Awaited<ReturnType<typeof getAuthenticatedUser>>);
  expect((await POST(new Request("https://lapollacolombiana.com/api/admin/sms-campaigns", { method: "POST", headers: { origin: "https://evil.example" } }))).status).toBe(403);
});
