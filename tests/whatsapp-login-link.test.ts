import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ admin: vi.fn(), fetch: vi.fn(), session: vi.fn(), cookie: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/auth/phone-session", () => ({ startSessionForVerifiedPhone: m.session, applyOnboardingCookie: m.cookie }));
vi.mock("@/lib/auth/login-event", () => ({ recordLoginEvent: m.event }));
import { replyWithWhatsAppLogin, whatsappTokenHash, getWhatsAppLoginHref, peekWhatsAppLogin } from "@/lib/auth/whatsapp-login";
import { GET, HEAD, POST } from "@/app/api/auth/wa-magic/route";
import { POST as webhook } from "@/app/api/whatsapp/zernio/route";
import { isLoginLinkPath } from "@/lib/auth/telegram-login/link-path";

const account = "6ab80b47743099844c791515", phone = "573001234567", token = "a".repeat(64);
function incoming(text: string | null = "Hola") {
  return { id: "event-1", event: "message.received", account: { accountId: account },
    conversation: { id: "6ab96d4d6d91a1875c750944" }, message: { platform: "whatsapp", direction: "incoming", text,
      sentAt: new Date().toISOString(), sender: { id: phone, phoneNumber: `+${phone}` } } };
}
function database() {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "update", "is", "gt"]) q[name] = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue({ data: { phone_number: phone, expires_at: new Date(Date.now() + 600_000).toISOString(), consumed_at: null }, error: null });
  return { from: vi.fn(() => q), rpc: vi.fn().mockResolvedValue({ data: "issued", error: null }), q };
}
function post(headers: Record<string, string> = {}, body = `t=${token}`) {
  return new NextRequest("https://lapollacolombiana.com/api/auth/wa-magic", {
    method: "POST", body, headers: { host: "lapollacolombiana.com", origin: "https://lapollacolombiana.com",
      "content-type": "application/x-www-form-urlencoded", ...headers },
  });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch);
  vi.stubEnv("ZERNIO_API_KEY", "test"); vi.stubEnv("ZERNIO_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", account); vi.stubEnv("WHATSAPP_LOGIN_NUMBER", "18564831652");
  vi.stubEnv("WHATSAPP_LOGIN_ENABLED", "false"); vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", phone);
  m.admin.mockReturnValue(database()); m.fetch.mockResolvedValue(new Response('{"success":true}'));
  m.session.mockResolvedValue({ ok: true, userId: "test", needsOnboarding: false });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("signed incoming WhatsApp login", () => {
  it("keeps test rollout out of public login", () => {
    expect(getWhatsAppLoginHref()).toBeNull(); vi.stubEnv("WHATSAPP_LOGIN_ENABLED", "true");
    expect(getWhatsAppLoginHref()).toBe("https://wa.me/18564831652?text=Hola");
  });
  it("fails closed with feature or credentials absent", async () => {
    vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", ""); await replyWithWhatsAppLogin(incoming());
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("responds to text and media with a personal CTA, stores only its hash", async () => {
    const db = database(); m.admin.mockReturnValue(db);
    expect(await replyWithWhatsAppLogin(incoming(null))).toBe("sent");
    const body = JSON.parse(m.fetch.mock.calls[0][1].body);
    const t = new URL(body.interactive.action.parameters.url).searchParams.get("t")!;
    expect(t).toMatch(/^[a-f0-9]{64}$/); expect(body.interactive.type).toBe("cta_url");
    expect(db.rpc).toHaveBeenCalledWith("wa_issue_login_link", expect.objectContaining({ p_phone: phone, p_token_hash: whatsappTokenHash(t) }));
    expect(db.rpc.mock.calls[0][1].p_token_hash).not.toContain(t);
  });
  it.each(["scope", "outgoing", "stale", "future", "bsuid", "other-phone", "standby"])("ignores %s before DB", async kind => {
    const p = incoming();
    if (kind === "scope") p.account.accountId = "b".repeat(24);
    if (kind === "outgoing") p.message.direction = "outgoing";
    if (kind === "stale") p.message.sentAt = new Date(Date.now() - 600_001).toISOString();
    if (kind === "future") p.message.sentAt = new Date(Date.now() + 360_000).toISOString();
    if (kind === "other-phone") p.message.sender.phoneNumber = "+573009999999";
    const payload = kind === "bsuid" ? { ...p, message: { ...p.message, sender: { id: phone, phoneNumber: null, businessScopedUserId: phone } } }
      : kind === "standby" ? { ...p, message: { ...p.message, metadata: { standby: true } } } : p;
    expect(await replyWithWhatsAppLogin(payload)).toBe("ignored"); expect(m.admin).not.toHaveBeenCalled();
  });
  it("retries use the same token and idempotency key without extending expiry", async () => {
    const db = database(); m.admin.mockReturnValue(db); const p = incoming();
    await replyWithWhatsAppLogin(p); db.rpc.mockResolvedValue({ data: "retry", error: null });
    m.fetch.mockResolvedValue(new Response('{"success":true}')); await replyWithWhatsAppLogin(p);
    expect(m.fetch.mock.calls[0][1].body).toBe(m.fetch.mock.calls[1][1].body);
    expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1]);
    expect(m.fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(m.fetch.mock.calls[1][1].headers["Idempotency-Key"]);
  });
  it.each(["limited", "ignored"])("does not send when reservation is %s", async result => {
    const db = database(); db.rpc.mockResolvedValue({ data: result, error: null }); m.admin.mockReturnValue(db);
    expect(await replyWithWhatsAppLogin(incoming())).toBe(result); expect(m.fetch).not.toHaveBeenCalled();
  });
  it("DB outage fails closed", async () => {
    const db = database(); db.rpc.mockResolvedValue({ error: {} }); m.admin.mockReturnValue(db);
    await expect(replyWithWhatsAppLogin(incoming())).rejects.toThrow(); expect(m.fetch).not.toHaveBeenCalled();
  });
  it("invalid HMAC is rejected before login reservation", async () => {
    const raw = JSON.stringify(incoming());
    expect((await webhook(new NextRequest("https://lapollacolombiana.com/api/whatsapp/zernio", {
      method: "POST", body: raw, headers: { "x-zernio-signature": "0".repeat(64) },
    }))).status).toBe(401); expect(m.admin).not.toHaveBeenCalled();
  });
  it("provider failure requests retry, no session started", async () => {
    m.fetch.mockResolvedValue(new Response(null, { status: 503 })); const raw = JSON.stringify(incoming());
    expect((await webhook(new NextRequest("https://lapollacolombiana.com/api/whatsapp/zernio", {
      method: "POST", body: raw, headers: { "x-zernio-signature": createHmac("sha256", "test-secret").update(raw).digest("hex") },
    }))).status).toBe(503); expect(m.session).not.toHaveBeenCalled();
  });
});

describe("one-use login confirmation", () => {
  it("does not put the welcome or splash in front of the WhatsApp confirmation", () => {
    expect(isLoginLinkPath("/login/whatsapp")).toBe(true);
    expect(isLoginLinkPath("/login/whatsappx")).toBe(false);
  });
  it("GET and HEAD never query, consume or open a session", async () => {
    const res = await GET(new NextRequest(`https://lapollacolombiana.com/api/auth/wa-magic?token=${token}`));
    expect(res.status).toBe(303); expect(res.headers.get("location")).toContain("/login/whatsapp?t=");
    expect((await HEAD()).status).toBe(405); expect(m.admin).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
  it("preview reads without consuming", async () => {
    const db = database(); m.admin.mockReturnValue(db); await peekWhatsAppLogin(token);
    expect(db.q.update).not.toHaveBeenCalled(); expect(db.q.eq).toHaveBeenCalledWith("token", whatsappTokenHash(token));
  });
  it.each<Record<string, string>>([{ origin: "https://evil.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }])("rejects cross-origin forms", async headers => {
    expect((await POST(post(headers))).status).toBe(403); expect(m.admin).not.toHaveBeenCalled();
  });
  it("claims atomically then logs in as signed sender, not a supplied phone", async () => {
    const db = database(); m.admin.mockReturnValue(db);
    const res = await POST(post({}, `t=${token}&phone=573009999999`));
    expect(res.status).toBe(303); expect(res.headers.get("location")).toBe("https://lapollacolombiana.com/inicio");
    expect(m.session).toHaveBeenCalledWith(phone, "wa-link", expect.any(Object));
    expect(db.q.is).toHaveBeenCalledWith("consumed_at", null); expect(db.q.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(res.headers.get("cache-control")).toContain("no-store"); expect(m.cookie).toHaveBeenCalled();
  });
  it.each(["expired", "consumed", "race", "disabled"])("cannot sign in with %s link", async kind => {
    const db = database(); m.admin.mockReturnValue(db);
    if (kind === "expired") db.q.maybeSingle.mockResolvedValue({ data: { phone_number: phone, expires_at: new Date(0).toISOString() } });
    if (kind === "consumed") db.q.maybeSingle.mockResolvedValue({ data: { phone_number: phone, expires_at: new Date(Date.now() + 10000).toISOString(), consumed_at: new Date().toISOString() } });
    if (kind === "race") db.q.maybeSingle.mockResolvedValueOnce({ data: { phone_number: phone, expires_at: new Date(Date.now() + 10000).toISOString() } }).mockResolvedValueOnce({ data: null });
    if (kind === "disabled") vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", "");
    expect((await POST(post())).headers.get("location")).toContain("estado=expired"); expect(m.session).not.toHaveBeenCalled();
  });
});
