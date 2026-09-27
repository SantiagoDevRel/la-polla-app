import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ wa: vi.fn(), sms: vi.fn(), register: vi.fn(), result: vi.fn() }));
vi.mock("@/lib/auth/whatsapp-otp", () => ({ sendWhatsAppOtp: mocks.wa }));
vi.mock("@/lib/sms/labsmobile", () => ({ sendSms: mocks.sms }));
vi.mock("@/lib/sms/entregas", () => ({
  registrarEnvio: mocks.register, registrarFalloEnvio: vi.fn(), registrarResultadoDespacho: mocks.result,
}));
import { POST } from "@/app/api/auth/sms-hook/route";

const key = Buffer.from("test-hook-key-never-production-000");
function request({ signature = true, age = 0, phone = "573001234567", otp = "123456" } = {}) {
  const raw = JSON.stringify({ user: { phone }, sms: { otp } });
  const ts = Math.floor(Date.now() / 1000) - age;
  const sig = createHmac("sha256", key).update(`hook-1.${ts}.${raw}`).digest("base64");
  return new Request("https://example.test/api/auth/sms-hook", {
    method: "POST", body: raw,
    headers: { "webhook-id": "hook-1", "webhook-timestamp": String(ts), "webhook-signature": signature ? `v1,${sig}` : "v1,invalid" },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SEND_SMS_HOOK_SECRET", `v1,whsec_${key.toString("base64")}`);
  vi.stubEnv("WHATSAPP_OTP_ENABLED", "true");
  mocks.wa.mockResolvedValue({ ok: true });
  mocks.sms.mockResolvedValue({ ok: true });
  mocks.register.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("signed Supabase OTP hook", () => {
  it.each([{ signature: false }, { age: 301 }])("rejects forged/expired requests without sending %j", async options => {
    expect((await POST(request(options))).status).toBe(401);
    expect(mocks.wa).not.toHaveBeenCalled();
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it("fails closed without the hook secret", async () => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", "");
    expect((await POST(request())).status).toBe(500);
    expect(mocks.wa).not.toHaveBeenCalled();
  });
  it("delivers exactly six Supabase digits via WhatsApp, never SMS or SMS delivery rows", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.wa).toHaveBeenCalledWith("573001234567", "123456", "hook-1");
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it.each([{ otp: "12345" }, { phone: "442079460000" }])("rejects invalid OTP/country %j before delivery", async options => {
    expect((await POST(request(options))).status).toBe(400);
    expect(mocks.wa).not.toHaveBeenCalled();
  });
  it("returns failure without an automatic paid fallback", async () => {
    mocks.wa.mockResolvedValue({ ok: false, reason: "template" });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it("preserves the existing SMS path while rollout is off", async () => {
    vi.stubEnv("WHATSAPP_OTP_ENABLED", "false");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.wa).not.toHaveBeenCalled();
    expect(mocks.sms).toHaveBeenCalledWith("573001234567", "Tu código es 123456 para La Polla Colombiana", expect.any(Object));
    expect(mocks.result).toHaveBeenCalledWith(expect.any(String), "accepted");
  });
});
