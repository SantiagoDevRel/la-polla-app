import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn(), exchange: vi.fn(), linked: vi.fn(), link: vi.fn(), status: vi.fn(), session: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
vi.mock("@/lib/auth/telegram-login/oidc", async (original) => ({
  ...(await original<typeof import("@/lib/auth/telegram-login/oidc")>()), exchangeTelegramCode: mocks.exchange,
}));
vi.mock("@/lib/auth/telegram-login/requests", async (original) => ({
  ...(await original<typeof import("@/lib/auth/telegram-login/requests")>()), linkedAccountFor: mocks.linked, createLoginRequest: mocks.create,
}));
vi.mock("@/lib/auth/telegram-login/identity", async (original) => ({
  ...(await original<typeof import("@/lib/auth/telegram-login/identity")>()), linkTelegramAccountForContact: mocks.link, telegramIdentityStatus: mocks.status,
}));
vi.mock("@/lib/auth/telegram-login/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/telegram-login/session")>()), startTelegramSession: mocks.session,
}));

import { POST } from "@/app/api/auth/telegram/oidc/start/route";
import { GET } from "@/app/api/auth/telegram/oidc/callback/route";
import { newOidcAttempt, OIDC_COOKIE, sealOidcAttempt } from "@/lib/auth/telegram-login/oidc";

const origin = "https://lapollacolombiana.com";
const config = { clientId: "123456789", clientSecret: "test-oidc-secret-not-a-real-credential" };
const grant = { userId: "test-user", telegramUserId: 23456789, phoneE164: "+573001234567" };
let attempt = newOidcAttempt(origin, "/casa");
let cookie = "";

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_OIDC_CLIENT_ID", config.clientId);
  vi.stubEnv("TELEGRAM_OIDC_CLIENT_SECRET", config.clientSecret);
  vi.stubEnv("TELEGRAM_LOGIN_BOT_TOKEN", "123456789:" + "a".repeat(35));
  vi.stubEnv("TELEGRAM_LOGIN_WEBHOOK_SECRET", "b".repeat(40));
  vi.stubEnv("NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME", "LaPollaLoginBot");
  vi.stubEnv("TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS", "false");
  attempt = newOidcAttempt(origin, "/casa"); cookie = await sealOidcAttempt(attempt, config);
  mocks.db.mockReturnValue({});
  mocks.exchange.mockResolvedValue({ telegramUserId: grant.telegramUserId, phoneE164: grant.phoneE164 });
  mocks.linked.mockResolvedValue({ kind: "linked", userId: grant.userId, phoneE164: grant.phoneE164 });
  mocks.status.mockResolvedValue("new");
  mocks.link.mockResolvedValue({ status: "ok", grant });
  mocks.session.mockResolvedValue({ ok: true, userId: grant.userId, needsOnboarding: false });
  mocks.create.mockResolvedValue({ status: "ok", expiresAt: new Date(Date.now() + 300000).toISOString() });
});
afterEach(() => vi.unstubAllEnvs());

function start(headers: Record<string, string> = {}, body = "{}") {
  return POST(new NextRequest(`${origin}/api/auth/telegram/oidc/start`, {
    method: "POST", headers: { origin, host: "lapollacolombiana.com", "content-type": "application/json", ...headers }, body,
  }));
}
function callback(query = `code=one-time-code&state=${attempt.state}`, withCookie = true) {
  return GET(new NextRequest(`${origin}/api/auth/telegram/oidc/callback?${query}`, {
    headers: withCookie ? { cookie: `${OIDC_COOKIE}=${cookie}` } : {},
  }));
}
function reason(response: Response) { return new URL(response.headers.get("location")!).searchParams.get("telegram"); }

describe("OIDC initiation", () => {
  it("sets an encrypted HttpOnly Lax cookie and returns the provider URL", async () => {
    const response = await start({}, JSON.stringify({ returnTo: "/casa" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly.*SameSite=lax/i);
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).authorizeUrl).toMatch(/^https:\/\/oauth.telegram.org\/auth\?/);
  });
  it("rejects cross-origin requests before any DB call", async () => {
    expect((await start({ origin: "https://evil.test" })).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("enforces the existing atomic rate limit", async () => {
    mocks.create.mockResolvedValue({ status: "rate_limited" });
    const response = await start();
    expect(response.status).toBe(429); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["null", "bad-json", '"string"', "x".repeat(2001)])("rejects malformed input before DB: %.15s", async body => {
    expect((await start({}, body)).status).toBe(400); expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("OIDC callback", () => {
  it("keeps the existing linked account even without another phone permission", async () => {
    mocks.exchange.mockResolvedValue({ telegramUserId: grant.telegramUserId, phoneE164: null });
    const response = await callback();
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe(`${origin}/casa`);
    expect(mocks.session).toHaveBeenCalledWith(expect.anything(), {}, grant, "telegram-oidc");
    expect(mocks.link).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("creates a permitted new account and sends it through onboarding", async () => {
    mocks.linked.mockResolvedValue({ kind: "none" });
    mocks.session.mockResolvedValue({ ok: true, userId: grant.userId, needsOnboarding: true });
    const response = await callback();
    expect(response.headers.get("location")).toBe(`${origin}/onboarding`);
    expect(mocks.link).toHaveBeenCalled();
  });
  it.each(["missing-cookie", "wrong-state", "duplicate-state", "duplicate-code", "cancelled"])("rejects %s before token exchange and DB", async mode => {
    let query = `code=code&state=${attempt.state}`;
    if (mode === "wrong-state") query = "code=code&state=wrong";
    if (mode === "duplicate-state") query += `&state=${attempt.state}`;
    if (mode === "duplicate-code") query += "&code=another";
    if (mode === "cancelled") query += "&error=access_denied";
    const response = await callback(query, mode !== "missing-cookie");
    expect(reason(response)).toBeTruthy(); expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("rejects a consumed or invalid provider code before DB and session", async () => {
    mocks.exchange.mockRejectedValue(new Error("replayed-code"));
    expect(reason(await callback())).toBe("failed"); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(["unlinked", "linked_other"])("preserves account policy for %s phones", async status => {
    mocks.linked.mockResolvedValue({ kind: "none" }); mocks.status.mockResolvedValue(status);
    expect(reason(await callback())).toBe("sms_only"); expect(mocks.link).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("fails closed on ambiguous links", async () => {
    mocks.linked.mockResolvedValue({ kind: "ambiguous" });
    expect(reason(await callback())).toBe("sms_only"); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("requires verified phone before creating a new account", async () => {
    mocks.linked.mockResolvedValue({ kind: "none" }); mocks.exchange.mockResolvedValue({ telegramUserId: grant.telegramUserId, phoneE164: null });
    expect(reason(await callback())).toBe("phone_required"); expect(mocks.link).not.toHaveBeenCalled();
  });
  it("preserves an explicitly enabled first-link policy", async () => {
    vi.stubEnv("TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS", "true");
    mocks.linked.mockResolvedValue({ kind: "none" }); mocks.status.mockResolvedValue("unlinked");
    expect(reason(await callback())).toBeNull(); expect(mocks.link).toHaveBeenCalled();
  });
  it("rejects a lost authorization race before session creation", async () => {
    mocks.linked.mockResolvedValue({ kind: "none" }); mocks.link.mockResolvedValue({ status: "denied" });
    expect(reason(await callback())).toBe("sms_only"); expect(mocks.session).not.toHaveBeenCalled();
  });
});
