import { afterEach, expect, it, vi } from "vitest";
import { campaignPayload, dispatchCampaign, quoteCampaign } from "./provider";
const input = { message: "Mensaje", phones: ["+573001234567"], subid: "sc123456789012345678", scheduledAt: "2026-09-28T17:00:00.000Z" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() { vi.stubEnv("LABSMOBILE_USERNAME", "test"); vi.stubEnv("LABSMOBILE_TOKEN", "test"); vi.stubEnv("SMS_ACK_SECRET", "test"); vi.stubEnv("LABSMOBILE_DRY_RUN", "0"); }
it("sends exact reviewed message and UTC schedule, with concatenation and no shortening", () => {
  expect(campaignPayload(input, "test")).toMatchObject({ message: "Mensaje", scheduled: "2026-09-28 17:00:00", long: 1, shortlink: 0, recipient: [{ msisdn: "573001234567" }] });
});
it("never retries an ambiguous POST", async () => {
  setup(); const fetch = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch", fetch);
  expect((await dispatchCampaign(input)).state).toBe("unknown"); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([[200, { code: "0" }, "scheduled"], [400, { code: "35" }, "rejected"], [503, { code: "35" }, "unknown"]])("distinguishes provider outcomes %s", async (status, body, expected) => {
  setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
  expect((await dispatchCampaign(input)).state).toBe(expected);
});
it("does not quote unknown or malformed tariffs as zero", async () => {
  setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ credits: 100 })).mockResolvedValueOnce(Response.json({ CO: { credits: null } })));
  await expect(quoteCampaign(["CO"])).rejects.toThrow("tarifa");
});
