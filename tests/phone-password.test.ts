import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), user: vi.fn(), session: vi.fn(), event: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/auth/phone-session", () => ({ startSessionForVerifiedPhone: mocks.session, applyOnboardingCookie: mocks.cookie }));
vi.mock("@/lib/auth/login-event", () => ({ recordLoginEvent: mocks.event }));
import { hashPhonePassword, validPhonePassword, verifyPhonePassword, phonePasswordRequestSalt } from "@/lib/auth/phone-password";
import { POST as login } from "@/app/api/auth/login-password/route";
import { POST as setPassword } from "@/app/api/auth/password/route";
import { GET as passwordStatus } from "@/app/api/auth/password/status/route";

function request(body: unknown, headers: Record<string, string> = {}) {
  const protocol = { expected_user_id: "00000000-0000-4000-8000-000000000010", request_id: "00000000-0000-4000-8000-000000000011", expected_revision: 0 };
  return new NextRequest("https://example.test/api/auth/login-password", { method: "POST", body: JSON.stringify({ ...protocol, ...body as object }),
    headers: { host: "example.test", origin: "https://example.test", "content-type": "application/json", "x-real-ip": "203.0.113.1", ...headers } });
}
function database(credential: unknown, allowed: unknown = true) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: credential, error: null }), upsert: vi.fn().mockResolvedValue({ error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  return { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: allowed, error: null }), query,
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { phone: "573001234567", phone_confirmed_at: new Date().toISOString() } }, error: null }) } } };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PHONE_PASSWORD_ENABLED", "true"); vi.stubEnv("AUTH_PIN_PEPPER", "test-private-pepper-at-least-32-characters");
  mocks.user.mockResolvedValue({ data: { user: { id: "00000000-0000-4000-8000-000000000010", phone: "573001234567", phone_confirmed_at: new Date().toISOString() } }, error: null });
  mocks.session.mockResolvedValue({ ok: true, userId: "00000000-0000-4000-8000-000000000010", needsOnboarding: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("private six-digit password", () => {
  it("requires authentication before reading password status", async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await passwordStatus();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("reports only existence for the verified owner and their current phone", async () => {
    const db = database(null); mocks.admin.mockReturnValue(db);
    expect(await (await passwordStatus()).json()).toEqual({ enabled: true, userId: "00000000-0000-4000-8000-000000000010", hasPassword: false, revision: 0 });
    db.query.maybeSingle.mockResolvedValue({ data: { phone_number: "573001234567", credential_revision: 7 }, error: null });
    expect(await (await passwordStatus()).json()).toEqual({ enabled: true, userId: "00000000-0000-4000-8000-000000000010", hasPassword: true, revision: 7 });
    expect(db.query.select).toHaveBeenCalledWith("phone_number, credential_revision");
    expect(db.query.eq).toHaveBeenCalledWith("user_id", "00000000-0000-4000-8000-000000000010");
    expect(db.query.eq).not.toHaveBeenCalledWith("phone_number", expect.anything());
  });
  it("keeps disabled status and unverified phones away from the credential table", async () => {
    vi.stubEnv("PHONE_PASSWORD_ENABLED", "false");
    expect(await (await passwordStatus()).json()).toEqual({ enabled: false });
    vi.stubEnv("PHONE_PASSWORD_ENABLED", "true");
    mocks.user.mockResolvedValueOnce({ data: { user: { id: "00000000-0000-4000-8000-000000000010", phone: "573001234567" } }, error: null });
    expect(await (await passwordStatus()).json()).toEqual({ enabled: true, userId: "00000000-0000-4000-8000-000000000010", hasPassword: false, revision: 0 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("does not mistake a failed status lookup for a missing password", async () => {
    const db = database(null); mocks.admin.mockReturnValue(db);
    db.query.maybeSingle.mockResolvedValue({ data: null, error: { message: "Database unavailable" } });
    const response = await passwordStatus();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("hasPassword");
  });
  it("preserves leading zeroes and rejects other formats", () => {
    expect(validPhonePassword("012345")).toBe(true);
    for (const value of [123456, "12345", "1234567", "abcdef", "123 45"]) expect(validPhonePassword(value)).toBe(false);
  });
  it("uses random salts, pepper and constant-time verification without storing the password", async () => {
    const a = await hashPhonePassword("012345"), b = await hashPhonePassword("012345");
    expect(a.salt).not.toBe(b.salt); expect(a.password_hash).not.toBe(b.password_hash);
    expect(a.password_hash).toHaveLength(128);
    expect(await verifyPhonePassword("012345", a)).toBe(true);
    expect(await verifyPhonePassword("012346", a)).toBe(false);
    expect(await verifyPhonePassword("012345", null)).toBe(false);
    vi.stubEnv("AUTH_PIN_PEPPER", "another-test-private-pepper-32-characters");
    expect(await verifyPhonePassword("012345", a)).toBe(false);
  });
  it("rejects cross-origin requests and disabled rollout before DB", async () => {
    expect((await login(request({ phone: "+573001234567", password: "012345" }, { origin: "https://evil.test" }))).status).toBe(403);
    vi.stubEnv("PHONE_PASSWORD_ENABLED", "false");
    expect((await login(request({}))).status).toBe(503); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("reserves before lookup and fails closed on database errors or exhausted limits", async () => {
    const db = database(null, false); mocks.admin.mockReturnValue(db);
    expect((await login(request({ phone: "+573001234567", password: "012345" }))).status).toBe(429);
    expect(db.from).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
    db.rpc.mockResolvedValue({ data: true, error: {} });
    expect((await login(request({ phone: "+573001234567", password: "012345" }))).status).toBe(503);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("keeps unknown and incorrect credentials indistinguishable and never mints a session", async () => {
    const db = database(null); mocks.admin.mockReturnValue(db);
    const unknown = await login(request({ phone: "+573001234567", password: "012345" }));
    db.query.maybeSingle.mockResolvedValue({ data: { user_id: "00000000-0000-4000-8000-000000000010", ...await hashPhonePassword("999999") }, error: null });
    const wrong = await login(request({ phone: "+573001234567", password: "012345" }));
    expect(unknown.status).toBe(401); expect(await wrong.json()).toEqual(await unknown.json()); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("only permits the credential owner session and sanitizes returnTo", async () => {
    const db = database({ user_id: "00000000-0000-4000-8000-000000000010", ...await hashPhonePassword("012345") }); mocks.admin.mockReturnValue(db);
    const response = await login(request({ phone: "+573001234567", password: "012345", returnTo: "https://evil.test" }));
    expect(response.status).toBe(200); expect((await response.json()).redirectTo).toBe("/inicio");
    const options = mocks.session.mock.calls[0][2];
    expect(await options.authorize({ authUserId: "00000000-0000-4000-8000-000000000010", created: false })).toBe(true);
    expect(await options.authorize({ authUserId: "other", created: false })).toBe(false);
    expect(await options.authorize({ authUserId: "00000000-0000-4000-8000-000000000010", created: true })).toBe(false);
    db.query.maybeSingle.mockResolvedValue({ data: { password_hash: "changed-by-sms-reset" }, error: null });
    expect(await options.authorize({ authUserId: "00000000-0000-4000-8000-000000000010", created: false })).toBe(false);
    expect(options.clientIp).toBe("203.0.113.1");
    expect(db.rpc.mock.calls[0][1].p_ip_key).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ method: "password" }));
  });
  it("invalidates a saved credential when its auth owner no longer owns the phone", async () => {
    const db = database({ user_id: "00000000-0000-4000-8000-000000000010", ...await hashPhonePassword("012345") }); mocks.admin.mockReturnValue(db);
    db.auth.admin.getUserById.mockResolvedValue({ data: { user: { phone: "573009999999", phone_confirmed_at: new Date().toISOString() } }, error: null });
    expect((await login(request({ phone: "+573001234567", password: "012345" }))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("requires a verified authenticated user before saving and ignores caller identity", async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await setPassword(request({ password: "012345", confirmation: "012345" }))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    const db = database(null); mocks.admin.mockReturnValue(db);
    db.rpc.mockResolvedValue({ data: { ok: true, user_id: "00000000-0000-4000-8000-000000000010", request_id: "00000000-0000-4000-8000-000000000011", revision: 1 }, error: null });
    const response = await setPassword(request({ password: "012345", confirmation: "012345", phone: "573009999999", user_id: "other" }));
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("phone_password_save_v1", expect.objectContaining({ p_user_id: "00000000-0000-4000-8000-000000000010", p_phone_number: "573001234567", p_expected_revision: 0 }));
    expect(db.rpc.mock.calls[0][1]).not.toHaveProperty("password");
  });
  it("rejects unverified phones or mismatched confirmation, and supports resetting after SMS", async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: { id: "00000000-0000-4000-8000-000000000010", phone: "573001234567" } }, error: null });
    expect((await setPassword(request({ password: "012345", confirmation: "012345" }))).status).toBe(403);
    expect((await setPassword(request({ password: "012345", confirmation: "999999" }))).status).toBe(400);
    const db = database(null); mocks.admin.mockReturnValue(db);
    db.rpc.mockResolvedValue({ data: { ok: true, user_id: "00000000-0000-4000-8000-000000000010", request_id: "00000000-0000-4000-8000-000000000011", revision: 1 }, error: null });
    expect((await setPassword(request({ password: "987654", confirmation: "987654" }))).status).toBe(200);
    const payload = db.rpc.mock.calls[0][1];
    expect(await verifyPhonePassword("987654", { salt: payload.p_salt, password_hash: payload.p_password_hash })).toBe(true);
  });
  it("derives a stable request salt while separating requests, owners and changed PINs", async () => {
    const salt = phonePasswordRequestSalt("owner", "request");
    expect(salt).toBe(phonePasswordRequestSalt("owner", "request"));
    expect(salt).not.toBe(phonePasswordRequestSalt("other", "request"));
    expect(salt).not.toBe(phonePasswordRequestSalt("owner", "other"));
    expect(await hashPhonePassword("012345", salt)).toEqual(await hashPhonePassword("012345", salt));
    expect((await hashPhonePassword("012346", salt)).password_hash).not.toBe((await hashPhonePassword("012345", salt)).password_hash);
  });
  it("rejects old unversioned tabs with an actionable refresh instead of overwriting", async () => {
    const response = await setPassword(request({ password: "012345", confirmation: "012345", request_id: undefined }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PASSWORD_REFRESH_REQUIRED");
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects a changed session owner before hashing or writing", async () => {
    const response = await setPassword(request({ password: "012345", confirmation: "012345", expected_user_id: "00000000-0000-4000-8000-000000000099" }));
    expect(response.status).toBe(412); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("reports stale writes and never accepts malformed database acknowledgements", async () => {
    const db = database(null); mocks.admin.mockReturnValue(db);
    db.rpc.mockResolvedValue({ data: { ok: false, conflict: true, revision: 2 }, error: null });
    const response = await setPassword(request({ password: "012345", confirmation: "012345" }));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("PASSWORD_CHANGED");
    db.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect((await setPassword(request({ password: "012345", confirmation: "012345" }))).status).toBe(503);
  });
  it("preserves the credential revision when the verified phone changes", async () => {
    const db = database({ phone_number: "573009999999", credential_revision: 3 }); mocks.admin.mockReturnValue(db);
    expect(await (await passwordStatus()).json()).toMatchObject({ hasPassword: false, revision: 3 });
  });
});
