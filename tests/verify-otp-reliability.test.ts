import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), verify: vi.fn(), signOut: vi.fn(), limit: vi.fn(), admin: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/supabase/auth-ip", () => ({ createAuthRouteClient: mocks.auth, getClientIp: () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkAndRecordAttempt: mocks.limit }));
vi.mock("@/lib/auth/login-event", () => ({ recordLoginEvent: mocks.event }));
import { POST } from "@/app/api/auth/verify-otp/route";

function request(body: unknown, extra: Record<string, string> = {}) {
  return new NextRequest("https://example.test/api/auth/verify-otp", { method: "POST", body: JSON.stringify(body),
    headers: { host: "example.test", origin: "https://example.test", "content-type": "application/json", ...extra } });
}
function database(profile: unknown) {
  const query = { update: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }) };
  query.update.mockReturnValue(query); query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const db = { from: vi.fn(() => query), query }; mocks.admin.mockReturnValue(db); return db;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({ blocked: false });
  mocks.auth.mockResolvedValue({ verifyOtp: mocks.verify, signOut: mocks.signOut });
  mocks.verify.mockResolvedValue({ data: { user: { id: "owner", created_at: "2020-01-01T00:00:00Z" } }, error: null });
});

describe("OTP registration and session recovery", () => {
  it("keeps an existing browser session when a code is invalid or expired", async () => {
    mocks.verify.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired" } });
    const res = await POST(request({ phone: "+573001234567", token: "000000" }));
    expect(res.status).toBe(401);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect((await res.json()).error).toMatch(/vencido/);
  });
  it.each([null, { display_name: "573001234567", avatar_url: "pollito" }, { display_name: "Ana", avatar_url: null }])("routes incomplete registration to onboarding even after a delayed SMS: %j", async profile => {
    const db = database(profile);
    const res = await POST(request({ phone: "+57 (300) 123-4567", token: "123456" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, newUser: true });
    expect(mocks.verify).toHaveBeenCalledWith({ phone: "+573001234567", token: "123456", type: "sms" });
    expect(db.query.eq).toHaveBeenCalledWith("id", "owner");
    expect(db.query.select).toHaveBeenCalledWith("display_name, avatar_url");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not restart onboarding for an existing complete account", async () => {
    database({ display_name: "Ana", avatar_url: "pollito" });
    expect(await (await POST(request({ phone: "+573001234567", token: "123456" }))).json()).toMatchObject({ newUser: false });
  });
  it("never skips onboarding on an uncertain profile lookup", async () => {
    const db = database(null);
    db.query.maybeSingle.mockResolvedValue({ data: { display_name: "Ana", avatar_url: "pollito" }, error: { message: "Read failed" } });
    expect(await (await POST(request({ phone: "+573001234567", token: "123456" }))).json()).toMatchObject({ newUser: true });
  });
  it("distinguishes a provider outage from an invalid code", async () => {
    mocks.verify.mockResolvedValue({ data: { user: null }, error: { status: 503, message: "Service unavailable" } });
    expect((await POST(request({ phone: "+573001234567", token: "123456" }))).status).toBe(503);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it.each([{ phone: "not-a-phone", token: "123456" }, { phone: "+573001234567", token: "12345" }])("rejects malformed identity before rate limits/session changes: %j", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("rejects cross-origin login before changing any session", async () => {
    expect((await POST(request({ phone: "+573001234567", token: "123456" }, { origin: "https://evil.test" }))).status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("returns a retryable block without trying the provider", async () => {
    mocks.limit.mockResolvedValue({ blocked: true });
    expect((await POST(request({ phone: "+573001234567", token: "123456" }))).status).toBe(429);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
