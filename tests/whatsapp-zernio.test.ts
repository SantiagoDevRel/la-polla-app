import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const routes = vi.hoisted(() => ({ routePlayerMessage: vi.fn(), routePlayerCallback: vi.fn() }));
vi.mock("@/lib/telegram-player/handler", () => routes);
import { getZernioBotConfig, zernioPhoneAllowed, serviceWindowOpen } from "@/lib/whatsapp-zernio/config";
import { parseZernioInbound } from "@/lib/whatsapp-zernio/inbound";
import { downloadZernioProof, trustedMediaUrl, MAX_ZERNIO_PROOF_BYTES } from "@/lib/whatsapp-zernio/media";
import { deliverTurn } from "@/lib/whatsapp-zernio/delivery";
import { handleZernioPlayerEvent } from "@/lib/whatsapp-zernio/handler";
import { notifyZernioReview, notifyZernioReferralGift } from "@/lib/whatsapp-zernio/notify";
import { HOME, menuForScreen, renderZernioMenu } from "@/lib/whatsapp-zernio/format";
import { readFileSync } from "node:fs";
import type { PlayerCtx } from "@/lib/telegram-player/context";

const phone = ["57", "3", "0".repeat(9)].join("");
const accountId = "a".repeat(24), conversationId = "b".repeat(24);
const config = { accountId, apiKey: "test-key", allowedPhones: null };
const now = Date.parse("2026-10-31T12:00:00Z");
const url = `https://zernio.com/api/v1/whatsapp/media/123?accountId=${accountId}`;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const event = () => ({ id: "envelope", event: "message.received", account: { accountId }, conversation: { id: conversationId },
  message: { id: "message", platformMessageId: "provider-message", platform: "whatsapp", direction: "incoming", sentAt: new Date(now).toISOString(), sender: { id: phone, phoneNumber: `+${phone}` }, text: "hola" } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Zernio config and verified inbound", () => {
  it("defaults off and has a fail-closed phone allowlist", () => {
    expect(getZernioBotConfig({})).toBeNull();
    const env = { WHATSAPP_ZERNIO_BOT_ENABLED: "true", ZERNIO_WHATSAPP_ACCOUNT_ID: accountId, ZERNIO_API_KEY: "test-key", WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES: phone };
    expect(zernioPhoneAllowed(getZernioBotConfig(env)!, phone)).toBe(true);
    expect(zernioPhoneAllowed(getZernioBotConfig({ ...env, WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES: "invalid" })!, phone)).toBe(false);
    expect(parseZernioInbound(event(), { ...config, allowedPhones: new Set() }, now)).toBeNull();
  });
  it.each(["button_reply", "list_reply"])("parses %s as data, never as identity", interactiveType => {
    const parsed = parseZernioInbound({ ...event(), metadata: { interactiveType, interactiveId: "opaque" } }, config, now)!;
    expect(parsed.selection).toBe("opaque"); expect(parsed.text).toBeNull(); expect(parsed.phone).toBe(phone);
  });
  it.each(["root", "message", "metadata"])("parses the %s quick reply payload", place => {
    const value = event();
    const extra = { quickReplyPayload: "opaque" };
    const payload = place === "root" ? { ...value, interactiveMetadata: extra }
      : place === "message" ? { ...value, message: { ...value.message, interactiveMetadata: extra } } : { ...value, metadata: extra };
    expect(parseZernioInbound(payload, config, now)?.selection).toBe("opaque");
  });
  it.each(["image", "document"])("parses %s without treating the caption as a command", type => {
    const value = event();
    const parsed = parseZernioInbound({ ...value, message: { ...value.message, text: "web", attachments: [{ type, url, mimeType: type === "image" ? "image/png" : "application/pdf" }] } }, config, now)!;
    expect(parsed.attachment?.type).toBe(type); expect(parsed.text).toBeNull();
  });
  it("does not identify BSUID-only senders from text or contact cards", () => {
    const value = event();
    const payload = { ...value, message: { ...value.message, text: phone, sender: { id: phone, businessScopedUserId: phone } }, metadata: { contactsOrigin: "other", contacts: [{ phones: [{ wa_id: phone }] }] } };
    expect(parseZernioInbound(payload, config, now)).toBeNull();
    expect(parseZernioInbound({ ...payload, metadata: { ...payload.metadata, contactsOrigin: "contact_request" } }, config, now)?.phone).toBe(phone);
  });
  it("rejects wrong account, outgoing, standby, stale and future messages", () => {
    const value = event();
    for (const payload of [
      { ...value, account: { accountId: "c".repeat(24) } },
      { ...value, metadata: { standby: true } },
      { ...value, message: { ...value.message, direction: "outgoing" } },
      { ...value, message: { ...value.message, sentAt: new Date(now - 600_000).toISOString() } },
      { ...value, message: { ...value.message, sentAt: new Date(now + 300_001).toISOString() } },
    ]) expect(parseZernioInbound(payload, config, now)).toBeNull();
  });
  it("dedupes the provider message id across webhook envelope changes", () => {
    expect(parseZernioInbound(event(), config, now)?.key).toBe(parseZernioInbound({ ...event(), id: "redelivery" }, config, now)?.key);
  });
});

// Built at runtime so the secret scanner does not flag a fake credential URL.
const withCredentials = (raw: string) => Object.assign(new URL(raw), { username: "fixture", password: "fixture" }).toString();

describe("authenticated proof download", () => {
  it.each(["http://zernio.com/api/v1/whatsapp/media/123", "https://zernio.com.evil.test/api/v1/whatsapp/media/123", "https://127.0.0.1/media", "https://zernio.com/api/other", withCredentials("https://zernio.com/api/v1/whatsapp/media/123"), "https://zernio.com/api/v1/whatsapp/media/123?accountId=wrong", "https://zernio.com/api/v1/whatsapp/media/123?url=http://localhost"])("blocks %s before sending a credential", async unsafe => {
    const fetcher = vi.fn();
    expect(trustedMediaUrl(unsafe, accountId)).toBeNull();
    expect((await downloadZernioProof({ type: "image", url: unsafe }, config, fetcher)).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the authenticated proxy, refuses redirects and detects PNG despite JPEG naming", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(png, { headers: { "Content-Type": "image/jpeg" } }));
    const result = await downloadZernioProof({ type: "document", url, mimeType: "image/jpeg" }, config, fetcher);
    expect(result).toMatchObject({ ok: true, mime: "image/png", bytes: png });
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error", cache: "no-store", headers: { Authorization: "Bearer test-key" } }));
  });
  it.each(["application/pdf", "text/html"])("rejects unsupported declared MIME %s", async mimeType => {
    const fetcher = vi.fn().mockResolvedValue(new Response(png));
    expect(await downloadZernioProof({ type: "document", url, mimeType }, config, fetcher)).toEqual({ ok: false, reason: "unsupported" });
  });
  it("rejects magic-byte spoofing and an HTML response", async () => {
    for (const response of [new Response("<html>bad</html>", { headers: { "Content-Type": "image/jpeg" } }), new Response(png, { headers: { "Content-Type": "text/html" } })]) {
      expect(await downloadZernioProof({ type: "image", url }, config, vi.fn().mockResolvedValue(response))).toEqual({ ok: false, reason: "unsupported" });
    }
  });
  it("rejects PDF magic bytes even when disguised as an image or generic document", async () => {
    for (const mimeType of ["image/jpeg", "application/octet-stream"]) {
      const fetcher = vi.fn().mockResolvedValue(new Response("%PDF-1.7\nfixture", { headers: { "Content-Type": mimeType } }));
      expect(await downloadZernioProof({ type: "document", url, mimeType }, config, fetcher)).toEqual({ ok: false, reason: "unsupported" });
    }
  });
  it("accepts the exact 3 MiB boundary without increasing the staging cap", async () => {
    const bytes = Buffer.alloc(MAX_ZERNIO_PROOF_BYTES); png.copy(bytes);
    expect(await downloadZernioProof({ type: "document", url, mimeType: "image/png" }, config,
      vi.fn().mockResolvedValue(new Response(bytes)))).toMatchObject({ ok: true, mime: "image/png" });
  });
  it("caps declared size and streamed size even without Content-Length", async () => {
    const oversized = Buffer.alloc(MAX_ZERNIO_PROOF_BYTES + 1);
    for (const response of [new Response(png, { headers: { "Content-Length": String(oversized.length) } }), new Response(oversized)]) {
      expect(await downloadZernioProof({ type: "image", url }, config, vi.fn().mockResolvedValue(response))).toEqual({ ok: false, reason: "too_large" });
    }
  });
  it("turns provider failures and redirects into a retryable download error", async () => {
    for (const fetcher of [vi.fn().mockResolvedValue(new Response(null, { status: 503 })), vi.fn().mockRejectedValue(new TypeError("redirect"))])
      expect(await downloadZernioProof({ type: "image", url }, config, fetcher)).toEqual({ ok: false, reason: "download" });
  });
});

function database(claim: { outcome: string; replies?: unknown[] } = { outcome: "new" }, overrides: Record<string, unknown> = {}) {
  const menu = menuForScreen(HOME, undefined, "a".repeat(16)).menu;
  const chat = { phone, user_id: "user", flow: null, flow_data: null, flow_at: null, menu, zernio_conversation_id: conversationId, zernio_last_inbound_at: new Date(now).toISOString(), ...overrides };
  const writes: { table: string; value: unknown }[] = [];
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["eq", "gte", "limit", "select"]) query[method] = vi.fn(() => query);
    query.update = vi.fn(value => { writes.push({ table, value }); return query; });
    query.insert = vi.fn(value => { writes.push({ table, value }); return query; });
    query.maybeSingle = vi.fn(async () => ({ data: table === "users" ? { display_name: "Test Player", avatar_url: "colombia" } : chat, error: null }));
    query.single = vi.fn(async () => ({ data: { id: "0b9a2c4e-1f3d-4a5b-8c7d-6e5f4a3b2c1d" }, error: null }));
    query.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: null });
    return query;
  });
  return { from, writes, chat, rpc: vi.fn(async (name: string) => ({ data: name === "whatsapp_zernio_claim" ? { ...claim, lease: "lease" } : true, error: null })) };
}
const target = { key: "key", phone, conversationId, sentAt: new Date(now).toISOString() };

describe("durable delivery, idempotency and rate limiting", () => {
  it.each(["sent", "limited", "ignored", "failed"])("does not reexecute or send when claim is %s", async outcome => {
    const db = database({ outcome }), build = vi.fn(), send = vi.fn();
    expect(await deliverTurn(db as never, config, target, build, { now: () => now, send })).toBe(outcome === "sent" ? "duplicate" : outcome);
    expect(build).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("serializes concurrent turns and asks the webhook to retry", async () => {
    const db = database({ outcome: "busy" }), build = vi.fn();
    await expect(deliverTurn(db as never, config, target, build)).rejects.toThrow("busy");
    expect(build).not.toHaveBeenCalled();
  });
  it("prepares replies before sending and retries the exact saved content without a business write", async () => {
    const db = database(); const send = vi.fn();
    const menu = menuForScreen(HOME).menu;
    const replies = renderZernioMenu(menu);
    const build = vi.fn(async () => ({ menu, replies }));
    expect(await deliverTurn(db as never, config, target, build, { now: () => now, send })).toBe("sent");
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_zernio_prepare", expect.objectContaining({ p_replies: replies }));
    const replay = database({ outcome: "ready", replies });
    expect(await deliverTurn(replay as never, config, target, build, { now: () => now, send })).toBe("sent");
    expect(build).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });
  it("keeps a prepared response on an uncertain provider failure", async () => {
    const db = database({ outcome: "ready", replies: [{ message: "test" }] });
    await expect(deliverTurn(db as never, config, target, vi.fn(), { now: () => now, send: vi.fn().mockRejectedValue(new Error()) })).rejects.toThrow("pending");
    expect(db.writes).toContainEqual({ table: "whatsapp_zernio_deliveries", value: { lease_until: new Date(0).toISOString() } });
  });
  it.each([0, 24 * 3_600_000, 24 * 3_600_000 + 1])("does not send outside the service window (%i)", async age => {
    const db = database({ outcome: "ready", replies: [{ message: "test" }] }, { zernio_last_inbound_at: age === 0 ? null : new Date(now - age).toISOString() });
    const send = vi.fn();
    expect(await deliverTurn(db as never, config, target, vi.fn(), { now: () => now, send })).toBe("ignored");
    expect(send).not.toHaveBeenCalled();
  });
  it("freezes SQL custody, atomic rate cap and execute grants", () => {
    const sql = readFileSync("supabase/migrations/177_whatsapp_zernio_bot.sql", "utf8");
    expect(sql).toContain("pg_advisory_xact_lock"); expect(sql).toContain("n > 20");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY"); expect(sql).toContain("USING (false) WITH CHECK (false)");
    expect(sql.match(/SECURITY DEFINER SET search_path = public, pg_temp/g)).toHaveLength(2);
    expect(sql.match(/REVOKE EXECUTE ON FUNCTION.+FROM PUBLIC, anon, authenticated/g)).toHaveLength(2);
    expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM) public\.predictions/i);
  });
});

describe("official WhatsApp uses the existing player flow", () => {
  it("resolves a new account only from the verified sender and asks for name/pollito", async () => {
    const db = database(undefined, { user_id: null }); const resolveAccount = vi.fn().mockResolvedValue({ ok: true, authUserId: "new-user" });
    routes.routePlayerMessage.mockImplementation(async (ctx: PlayerCtx) => { await ctx.channel!.show({ text: "Paso 1", buttons: HOME.buttons }); });
    await handleZernioPlayerEvent({ ...target, text: "another number", selection: null, attachment: null }, { db: db as never, config, login: vi.fn(), now: () => now, resolveAccount, send: vi.fn() });
    expect(resolveAccount).toHaveBeenCalledWith(`+${phone}`, "whatsapp-bot", db);
    expect(routes.routePlayerMessage).toHaveBeenCalledWith(expect.objectContaining({ account: { userId: "new-user", phoneE164: `+${phone}` } }), expect.objectContaining({ text: "another number" }), expect.anything());
  });
  it("revalidates opaque callbacks through routePlayerCallback", async () => {
    const db = database();
    await handleZernioPlayerEvent({ ...target, text: null, selection: `${"a".repeat(16)}:0`, attachment: null }, { db: db as never, config, login: vi.fn(), now: () => now, send: vi.fn() });
    expect(routes.routePlayerCallback).toHaveBeenCalledWith(expect.anything(), "ol:0", expect.anything());
  });
  it.each(["name", "answer", "score", "ticket"])("does not treat a %s response as a menu option", async flow => {
    const db = database(undefined, { flow, flow_data: { p: "polla" }, flow_at: new Date(now).toISOString() });
    await handleZernioPlayerEvent({ ...target, text: flow === "score" ? "2-1" : "15", selection: null, attachment: null }, { db: db as never, config, login: vi.fn(), now: () => now, send: vi.fn() });
    expect(routes.routePlayerCallback).not.toHaveBeenCalled();
    expect(routes.routePlayerMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: flow === "score" ? "2-1" : "15" }), expect.anything());
  });
  it("stages magic-checked bytes by phone and passes the reference to the proof flow", async () => {
    const db = database();
    await handleZernioPlayerEvent({ ...target, text: null, selection: null, attachment: { type: "image", url } }, { db: db as never, config, login: vi.fn(), now: () => now, send: vi.fn(), download: vi.fn().mockResolvedValue({ ok: true, bytes: png, mime: "image/png" }) });
    expect(db.writes).toContainEqual({ table: "whatsapp_bot_media", value: { phone, mimetype: "image/png", data_b64: png.toString("base64") } });
    expect(routes.routePlayerMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ photo: expect.objectContaining({ fileId: expect.stringMatching(/^wa:/), mime: "image/png", source: "document" }) }), expect.anything());
  });
  it("keeps the literal login phrase reachable without onboarding", async () => {
    const db = database(undefined, { user_id: null }); const resolveAccount = vi.fn();
    const loginContent = { interactive: { type: "cta_url", body: { text: "Tu enlace personal" },
      action: { name: "cta_url", parameters: { display_text: "Entrar a la web", url: "https://example.test/login" } } } };
    const login = vi.fn(async capture => { await capture(conversationId, "stable", loginContent); return "sent"; });
    const send = vi.fn();
    await handleZernioPlayerEvent({ ...target, text: "dame el link para entrar a la polla", selection: null, attachment: null }, { db: db as never, config, login, now: () => now, resolveAccount, send });
    expect(resolveAccount).not.toHaveBeenCalled(); expect(login).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(config, conversationId, loginContent, "key:0");
  });
});

describe("notices", () => {
  const notice = { userId: "user", pollaId: "00000000-0000-4000-8000-000000000001", pollaName: "Test", kind: "partidos", approved: true, prizeKind: "pozo" as const, prizeObject: null, pozoCop: 0, rejectReason: null, ticketNumber: null };
  function enable() {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true"); vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", accountId); vi.stubEnv("ZERNIO_API_KEY", "test-key");
  }
  it.each([true, false])("sends an in-window review (approved=%s) once, without replacing input menus", async approved => {
    enable();
    const db = database(undefined, { zernio_last_inbound_at: new Date(Date.now() - 1000).toISOString(), flow: "score" });
    const fetcher = vi.fn(async () => new Response('{"success":true}'));
    vi.stubGlobal("fetch", fetcher);
    const review = { ...notice, approved, rejectReason: approved ? null : "Valor incompleto" };
    expect(await notifyZernioReview(db as never, review, "entry:attempt:revision")).toBe(true);
    const claimed = db.rpc.mock.calls.find(call => call[0] === "whatsapp_zernio_claim");
    expect(claimed).toBeTruthy();
    expect(fetcher).toHaveBeenCalledOnce();
    const content = JSON.parse((fetcher.mock.calls[0] as unknown as [unknown, { body: string }])[1].body);
    expect(content.template).toBeUndefined();
    expect(content.message).toContain(approved ? "Pago confirmado" : "Valor incompleto");
    if (!approved) expect(content.message).toContain("no repitas la transferencia");
    expect(content.buttons).toContainEqual(expect.objectContaining({ title: "Menú" }));
    expect(db.writes.some(w => w.table === "whatsapp_bot_chats")).toBe(false);
    const key = (claimed as unknown as [string, { p_key: string }])[1].p_key;
    db.rpc.mockResolvedValue({ data: { outcome: "sent", lease: "lease" }, error: null });
    expect(await notifyZernioReview(db as never, review, "entry:attempt:revision")).toBe(true);
    expect(db.rpc).toHaveBeenLastCalledWith("whatsapp_zernio_claim", expect.objectContaining({ p_key: key, p_inbound_at: null }));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("sends a gift with an in-chat pool action and skips an excluded phone", async () => {
    enable();
    const db = database(undefined, { zernio_last_inbound_at: new Date(Date.now() - 1000).toISOString() });
    const fetcher = vi.fn(async () => new Response('{"success":true}')); vi.stubGlobal("fetch", fetcher);
    expect(await notifyZernioReferralGift(db as never, { userId: "user", invited: 1 }, "gift-event")).toBe(true);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [unknown, { body: string }])[1].body);
    expect(body.buttons).toContainEqual(expect.objectContaining({ title: "Pollas disponibles" }));
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES", "invalid");
    expect(await notifyZernioReview(db as never, notice, "other-event")).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("uses a strict less-than-24-hours window", () => {
    expect(serviceWindowOpen(new Date(now - 24 * 3_600_000 + 1).toISOString(), now)).toBe(true);
    expect(serviceWindowOpen(new Date(now - 24 * 3_600_000).toISOString(), now)).toBe(false);
    expect(serviceWindowOpen(new Date(now + 1).toISOString(), now)).toBe(false);
  });
  it("skips closed-window notices without templates or claims", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_BOT_ENABLED", "true"); vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", accountId); vi.stubEnv("ZERNIO_API_KEY", "test-key");
    const db = database(undefined, { zernio_last_inbound_at: new Date(Date.now() - 24 * 3_600_000).toISOString() });
    expect(await notifyZernioReview(db as never, notice, "review-event")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
