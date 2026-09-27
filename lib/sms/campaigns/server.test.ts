import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/casa/queries", () => ({ getPollaById: vi.fn(), getPots: vi.fn(), listPublicPollas: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./provider", () => ({ dispatchCampaign: vi.fn(), quoteCampaign: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { campaignUsers, resolveAudience, sendCampaign } from "./server";
import { dispatchCampaign } from "./provider";

beforeEach(() => vi.resetAllMocks());
it("reads every page past the Supabase 1000 row limit with a stable ordering", async () => {
  const range = vi.fn((start: number) => Promise.resolve({ data: Array.from({ length: start === 0 ? 1000 : 1 }, (_, i) => ({ id: `${start + i}`, display_name: "Test", whatsapp_number: "573001234567" })), error: null }));
  const order = vi.fn(() => ({ range }));
  vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ select: () => ({ order }) }) } as unknown as ReturnType<typeof createAdminClient>);
  expect((await campaignUsers()).users).toHaveLength(1001);
  expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  expect(order).toHaveBeenCalledWith("id");
});
it("fails closed if exclusions cannot be read", async () => {
  const builder: Record<string, unknown> = {};
  for (const key of ["select", "order", "range", "in", "eq"]) builder[key] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { message: "DB unavailable" } }));
  vi.mocked(createAdminClient).mockReturnValue({ from: () => builder } as unknown as ReturnType<typeof createAdminClient>);
  await expect(resolveAudience({ countries: ["CO"], selectedIds: null, excludedPollaIds: ["pool"], exceptionIds: [] })).rejects.toThrow();
  expect(dispatchCampaign).not.toHaveBeenCalled();
});
it.each(["dispatching", "scheduled", "accepted", "unknown", "rejected"])("never retries a campaign in %s state", async state => {
  const builder: Record<string, unknown> = {};
  for (const key of ["select", "eq"]) builder[key] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: { state }, error: null });
  vi.mocked(createAdminClient).mockReturnValue({ from: () => builder } as unknown as ReturnType<typeof createAdminClient>);
  await expect(sendCampaign("owner", "campaign")).rejects.toThrow("ya se procesó");
  expect(dispatchCampaign).not.toHaveBeenCalled();
});
