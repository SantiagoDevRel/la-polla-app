import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppOtp } from "@/lib/auth/whatsapp-otp";
import { phoneOtpChannel } from "@/lib/auth/phone-otp-channel";

const fetchMock = vi.fn();
const approved = { templates: [{ name: "lp_login_otp", language: "es", status: "APPROVED", category: "AUTHENTICATION" }] };
beforeEach(() => {
  vi.stubEnv("WHATSAPP_OTP_ENABLED", "true");
  vi.stubEnv("ZERNIO_API_KEY", "test-only");
  vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", "a".repeat(24));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("WhatsApp OTP delivery", () => {
  it("keeps SMS when disabled and never contacts WhatsApp", async () => {
    vi.stubEnv("WHATSAPP_OTP_ENABLED", "false");
    expect(phoneOtpChannel()).toBe("sms");
    expect(await sendWhatsAppOtp("573001234567", "123456", "hook-1")).toEqual({ ok: false, reason: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["", "12345", "1234567", "ab3456"])("rejects malformed code %s before spending", async code => {
    expect(await sendWhatsAppOtp("573001234567", code, "hook-1")).toEqual({ ok: false, reason: "input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["MARKETING", "UTILITY"])("refuses recategorized %s template", async category => {
    fetchMock.mockResolvedValueOnce(Response.json({ templates: [{ ...approved.templates[0], category }] }));
    expect(await sendWhatsAppOtp("573001234567", "123456", "hook-1")).toEqual({ ok: false, reason: "template" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("refuses pending templates", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ templates: [{ ...approved.templates[0], status: "PENDING" }] }));
    expect((await sendWhatsAppOtp("573001234567", "123456", "hook-1")).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("delivers exactly the Supabase code in body and copy button, with replay-safe idempotency", async () => {
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce(Response.json(approved));
      fetchMock.mockResolvedValueOnce(Response.json({ success: true, data: { messageId: "wamid.test" } }));
      expect(await sendWhatsAppOtp("573001234567", "123456", "same-hook")).toEqual({ ok: true });
    }
    const first = fetchMock.mock.calls[1][1];
    expect(JSON.parse(first.body)).toEqual({ accountId: "a".repeat(24), participantId: "573001234567", templateName: "lp_login_otp", templateLanguage: "es", templateParams: ["123456", "123456"] });
    expect(first.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[3][1].headers["Idempotency-Key"]);
    expect(first.headers["Idempotency-Key"]).not.toContain("123456");
  });
  it("does not retry or fall back to SMS on timeout", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(approved));
    fetchMock.mockRejectedValueOnce(new Error("timeout with sensitive provider text"));
    expect(await sendWhatsAppOtp("573001234567", "123456", "hook-1")).toEqual({ ok: false, reason: "provider" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
