import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ admin: vi.fn(), preference: vi.fn(), confirm: vi.fn(), login: vi.fn(), player: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/whatsapp/marketing-preferences", () => ({ setMarketingPreference: m.preference }));
vi.mock("@/lib/auth/whatsapp-login", () => ({ replyWithWhatsAppLogin: m.login }));
vi.mock("@/lib/whatsapp-zernio/handler", () => ({ handleZernioPlayerEvent: m.player }));
vi.mock("@/lib/whatsapp/zernio-preferences", async original => ({ ...await original<object>(), confirmPreference: m.confirm }));
import { POST } from "@/app/api/whatsapp/zernio/route";

const phone = ["57", "3", "0".repeat(9)].join("");
const accountId = "a".repeat(24), conversationId = "b".repeat(24), secret = "test-webhook-secret";
const event = () => ({ id: "event", event: "message.received", account: { accountId }, conversation: { id: conversationId },
  message: { platform: "whatsapp", direction: "incoming", text: "hola", sentAt: new Date().toISOString(), sender: { id: phone, phoneNumber: `+${phone}` } } });
function request(payload: unknown, signature?: string) {
  const raw = JSON.stringify(payload);
  return new NextRequest("https://example.test/api/whatsapp/zernio", { method: "POST", body: raw,
    headers: { "x-zernio-signature": signature ?? createHmac("sha256", secret).update(raw).digest("hex") } });
}
beforeEach(() => {
  vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", ""); vi.stubEnv("WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES", "");
  vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", accountId); vi.stubEnv("ZERNIO_API_KEY", "test-key"); vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);
  m.login.mockResolvedValue("sent"); m.player.mockResolvedValue("sent"); m.admin.mockReturnValue({});
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("signed Zernio webhook routing", () => {
  it("rejects an invalid HMAC before any login, bot, preference or DB call", async () => {
    expect((await POST(request(event(), "0".repeat(64)))).status).toBe(401);
    for (const fn of Object.values(m)) expect(fn).not.toHaveBeenCalled();
  });
  it("rejects signed malformed JSON before touching the DB", async () => {
    const raw = "{";
    expect((await POST(new NextRequest("https://example.test/api/whatsapp/zernio", { method: "POST", body: raw,
      headers: { "x-zernio-signature": createHmac("sha256", secret).update(raw).digest("hex") } }))).status).toBe(400);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it.each(["sent", "ignored", "limited", "contact_requested"])("flag off preserves the exact existing %s response and login input", async login => {
    m.login.mockResolvedValue(login);
    const payload = event(); const response = await POST(request(payload));
    expect(await response.text()).toBe(JSON.stringify({ ok: true, ignored: login === "ignored", limited: login === "limited", contactRequested: login === "contact_requested" }));
    expect(m.login).toHaveBeenCalledExactlyOnceWith(payload);
    expect(m.player).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("routes an enabled verified sender to the bot and returns no-store", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true");
    const response = await POST(request(event()));
    expect(await response.json()).toEqual({ ok: true, outcome: "sent" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.player).toHaveBeenCalledWith(expect.objectContaining({ phone }), expect.objectContaining({ login: expect.any(Function) }));
    expect(m.login).not.toHaveBeenCalled();
  });
  it("keeps login unchanged for a number outside the bot allowlist", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true"); vi.stubEnv("WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES", ["57", "3", "1".repeat(9)].join(""));
    await POST(request(event()));
    expect(m.player).not.toHaveBeenCalled(); expect(m.login).toHaveBeenCalledOnce();
  });
  it("leaves BSUID-only contact requests to the existing login flow, never the bot", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true"); m.login.mockResolvedValue("contact_requested");
    const value = event();
    const response = await POST(request({ ...value, message: { ...value.message, text: phone, sender: { id: phone, businessScopedUserId: phone } } }));
    expect((await response.json()).contactRequested).toBe(true);
    expect(m.player).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it.each(["ALTA", "BAJA"])("%s retains priority with the bot enabled", async text => {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true");
    m.preference.mockResolvedValue({ current: false, replySent: true });
    const value = event(); await POST(request({ ...value, message: { ...value.message, text } }));
    expect(m.preference).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phone }));
    expect(m.player).not.toHaveBeenCalled(); expect(m.login).not.toHaveBeenCalled();
  });
  it("returns 503 for busy or unavailable bot state so Zernio retries", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true"); m.player.mockRejectedValue(new Error("busy"));
    const response = await POST(request(event()));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.login).not.toHaveBeenCalled();
  });
});
