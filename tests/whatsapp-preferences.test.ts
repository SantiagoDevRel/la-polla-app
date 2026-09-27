import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), user: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
import { POST } from "@/app/api/whatsapp/zernio/route";
import { GET, PATCH } from "@/app/api/users/me/whatsapp-preference/route";
import { marketingAllowed } from "@/lib/whatsapp/marketing-preferences";
import { parsePreferenceEvent } from "@/lib/whatsapp/zernio-preferences";
import { loadRecipients, sendAviso } from "@/lib/whatsapp/avisos";

const account = "6ab80b47743099844c791515";
const phone = "573001234567";
function payload(text = "BAJA") { return { id: "evt-1", event: "message.received", account: { accountId: account },
  conversation: { id: "6ab96d4d6d91a1875c750944" }, message: { platform: "whatsapp", direction: "incoming", text,
    sentAt: new Date().toISOString(), sender: { id: phone, phoneNumber: `+${phone}` } } }; }
function webhook(body: unknown, valid = true) {
  const raw = JSON.stringify(body);
  return new NextRequest("https://example.test/api/whatsapp/zernio", { method: "POST", body: raw,
    headers: { "x-zernio-signature": valid ? createHmac("sha256", "secret").update(raw).digest("hex") : "0".repeat(64) } });
}
function dbWith(row: unknown, error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "update", "order", "range", "in"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  query.then = vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve({ data: row, error }).then(resolve));
  return { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: { enabled: false, current: true, replySent: false }, error: null }), query };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("ZERNIO_WEBHOOK_SECRET", "secret"); vi.stubEnv("ZERNIO_API_KEY", "test-key"); vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", account);
  mocks.user.mockResolvedValue({ data: { user: { id: "user-1", phone } } });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("signed preference webhook", () => {
  it("rejects invalid signatures before touching DB", async () => {
    expect((await POST(webhook(payload(), false))).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["hola", "2-1", "quiero entrar a la polla"])("does not dispatch bot commands: %s", async text => {
    expect((await POST(webhook(payload(text)))).status).toBe(200); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("ignores other accounts and outgoing echoes", async () => {
    const p = payload(); p.account.accountId = "a".repeat(24);
    await POST(webhook(p)); p.account.accountId = account; p.message.direction = "outgoing"; await POST(webhook(p));
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("persists BAJA before confirming and marks its reply", async () => {
    const db = dbWith(null); mocks.admin.mockReturnValue(db);
    expect((await POST(webhook(payload()))).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("wa_set_marketing_preference", expect.objectContaining({ p_phone: phone, p_enabled: false, p_source: "whatsapp", p_event_id: "evt-1" }));
    expect(mocks.fetch.mock.invocationCallOrder[0]).toBeGreaterThan(db.rpc.mock.invocationCallOrder[0]);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).message).toContain("Tu cuenta sigue activa");
    expect(db.query.update).toHaveBeenCalledWith({ reply_sent: true });
  });
  it("does not confirm if persistence failed", async () => {
    const db = dbWith(null); db.rpc.mockResolvedValue({ error: {} }); mocks.admin.mockReturnValue(db);
    expect((await POST(webhook(payload()))).status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([{ current: true, replySent: true }, { current: false, replySent: false }])("does not reply to duplicate/obsolete events: %j", async flags => {
    const db = dbWith(null); db.rpc.mockResolvedValue({ data: { enabled: false, ...flags } }); mocks.admin.mockReturnValue(db);
    expect((await POST(webhook(payload()))).status).toBe(200); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("saves delayed BAJA without replying outside the 24h window", async () => {
    const db = dbWith(null); mocks.admin.mockReturnValue(db); const p = payload(); p.message.sentAt = new Date(Date.now() - 26 * 3600000).toISOString();
    expect((await POST(webhook(p))).status).toBe(200); expect(db.rpc).toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("asks provider to retry confirmation errors without undoing BAJA", async () => {
    const db = dbWith(null); mocks.admin.mockReturnValue(db); mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await POST(webhook(payload()))).status).toBe(503); expect(db.rpc).toHaveBeenCalled(); expect(db.query.update).not.toHaveBeenCalled();
  });
  it("ALTA explicitly enables notifications", () => { expect(parsePreferenceEvent(payload("ALTA"), account)?.enabled).toBe(true); });
  it("does not guess a phone from a business-scoped ID", () => {
    const p = payload(); const sender = { id: phone, phoneNumber: null, businessScopedUserId: phone };
    expect(() => parsePreferenceEvent({ ...p, message: { ...p.message, sender } }, account)).toThrow("Missing phone");
  });
});

describe("profile authorization and marketing gate", () => {
  it("requires auth for reading and writing", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect((await PATCH(new NextRequest("https://example.test/api", { method: "PATCH" }))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("uses the verified session phone, never a client-supplied phone", async () => {
    const db = dbWith(null); mocks.admin.mockReturnValue(db);
    const request = (body: object) => new NextRequest("https://example.test/api", { method: "PATCH", headers: { origin: "https://example.test" }, body: JSON.stringify(body) });
    expect((await PATCH(request({ enabled: true, phone: "573009999999" }))).status).toBe(400);
    expect((await PATCH(request({ enabled: true }))).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("wa_set_marketing_preference", expect.objectContaining({ p_phone: phone, p_enabled: true, p_source: "profile" }));
  });
  it("rejects cross-origin updates", async () => {
    expect((await PATCH(new NextRequest("https://example.test/api", { method: "PATCH", headers: { origin: "https://evil.test" }, body: '{"enabled":false}' }))).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([null, { enabled: false }, { enabled: true }])("defaults missing consent to off: %j", async row => {
    expect(await marketingAllowed(dbWith(row) as never, phone)).toBe(row?.enabled === true);
  });
  it("fails closed if consent cannot be read, before any outgoing request", async () => {
    await expect(sendAviso(dbWith(null, { message: "DB unavailable" }) as never, { recipient: { phone, userId: "u", firstName: "S" }, template: "lp_polla_nueva", bodyParams: [], pollaSlug: "p", variables: {} })).rejects.toThrow("consent");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("only selects explicit opt-ins for the audience", async () => {
    const db = dbWith([]); expect((await loadRecipients(db as never, [])).size).toBe(0);
    expect(db.query.eq).toHaveBeenCalledWith("enabled", true);
  });
});
