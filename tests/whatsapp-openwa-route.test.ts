// tests/whatsapp-openwa-route.test.ts — Rutas del relay de OpenWA: apagadas
// responden 404 sin leer nada; la firma se valida antes de parsear o tocar la base.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/whatsapp-player/handler", () => ({ handleWhatsAppEvent: mocks.handle }));

import { POST } from "@/app/api/whatsapp/openwa/route";
import { POST as OUTBOX } from "@/app/api/whatsapp/openwa/outbox/route";
import { POST as POLL_SENT } from "@/app/api/whatsapp/openwa/poll-sent/route";
import { signRelayBody } from "@/lib/whatsapp-player/signature";

const SECRET = "route-test-relay-secret-0123456789abcdef";
const now = () => Math.floor(Date.now() / 1000);
function signed(url: string, body: string, secret = SECRET, ts = now()) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lapolla-timestamp": String(ts), "x-lapolla-signature": signRelayBody(secret, ts, body) },
    body,
  });
}
const EVENT = JSON.stringify({ event: "message.received", data: { id: "m1" } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.handle.mockResolvedValue({ outcome: "handled", replies: [{ to: "573001234567@c.us", text: "hola" }] });
});
afterEach(() => vi.unstubAllEnvs());

function enable() {
  vi.stubEnv("WHATSAPP_OPENWA_BOT_ENABLED", "true");
  vi.stubEnv("WHATSAPP_OPENWA_RELAY_SECRET", SECRET);
}

it("is 404 while the bot is off, even with a valid signature", async () => {
  vi.stubEnv("WHATSAPP_OPENWA_RELAY_SECRET", SECRET);
  expect((await POST(signed("http://x/api/whatsapp/openwa", EVENT) as never)).status).toBe(404);
  expect((await OUTBOX(signed("http://x/api/whatsapp/openwa/outbox", JSON.stringify({ action: "claim" })) as never)).status).toBe(404);
  expect((await POLL_SENT(signed("http://x/api/whatsapp/openwa/poll-sent", "{}") as never)).status).toBe(404);
  expect(mocks.admin).not.toHaveBeenCalled();
});

it("rejects a wrong secret, an old timestamp or a body changed after signing", async () => {
  enable();
  expect((await POST(signed("http://x/api/whatsapp/openwa", EVENT, "another-secret-0123456789abcdef0123") as never)).status).toBe(401);
  expect((await POST(signed("http://x/api/whatsapp/openwa", EVENT, SECRET, now() - 600) as never)).status).toBe(401);
  const tampered = signed("http://x/api/whatsapp/openwa", EVENT);
  const forged = new Request(tampered.url, { method: "POST", headers: tampered.headers, body: EVENT.replace("m1", "m2") });
  expect((await POST(forged as never)).status).toBe(401);
  expect(mocks.handle).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled();
});

it("passes a signed event to the handler and returns its replies, never cached", async () => {
  enable();
  const res = await POST(signed("http://x/api/whatsapp/openwa", EVENT) as never);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ outcome: "handled", replies: [{ to: "573001234567@c.us", text: "hola" }] });
  expect(mocks.handle).toHaveBeenCalledWith(JSON.parse(EVENT), expect.objectContaining({ config: { relaySecret: SECRET, allowedPhones: null } }));
});

it("refuses bodies over the limit before verifying anything", async () => {
  enable();
  const big = "x".repeat(4_400_001);
  expect((await POST(signed("http://x/api/whatsapp/openwa", big) as never)).status).toBe(413);
  expect(mocks.handle).not.toHaveBeenCalled();
});

it("a handler crash is a 503 for the relay to retry, without details", async () => {
  enable();
  mocks.handle.mockRejectedValue(new Error("db down 573001234567"));
  const res = await POST(signed("http://x/api/whatsapp/openwa", EVENT) as never);
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain("573");
});

it("outbox: claims through SQL and answers WhatsApp chat ids; acks only valid ids", async () => {
  enable();
  mocks.rpc.mockResolvedValueOnce({ data: [{ id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", phone: "573001234567", body: "Pago confirmado" }], error: null });
  const claim = await OUTBOX(signed("http://x/api/whatsapp/openwa/outbox", JSON.stringify({ action: "claim", limit: 5 })) as never);
  expect(await claim.json()).toEqual({ messages: [{ id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", to: "573001234567@c.us", text: "Pago confirmado" }] });
  expect(mocks.rpc).toHaveBeenCalledWith("whatsapp_bot_claim_openwa_outbox", { p_limit: 5 });

  mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
  const ack = await OUTBOX(signed("http://x/api/whatsapp/openwa/outbox", JSON.stringify({ action: "ack", id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", ok: true })) as never);
  expect(await ack.json()).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith("whatsapp_bot_ack_outbox", { p_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", p_ok: true, p_error: null });

  const bad = await OUTBOX(signed("http://x/api/whatsapp/openwa/outbox", JSON.stringify({ action: "ack", id: "1; drop", ok: true })) as never);
  expect(bad.status).toBe(400);
  expect((await OUTBOX(signed("http://x/api/whatsapp/openwa/outbox", JSON.stringify({ action: "send", to: "x" })) as never)).status).toBe(400);
});

it("poll-sent authenticates before parsing, limits input and registers only the signed menu nonce", async () => {
  enable();
  const url = "http://x/api/whatsapp/openwa/poll-sent";
  expect((await POLL_SENT(signed(url, "not-json", "wrong") as never)).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
  expect((await POLL_SENT(signed(url, "not-json") as never)).status).toBe(400);
  expect((await POLL_SENT(signed(url, "x".repeat(4097)) as never)).status).toBe(413);
  expect((await POLL_SENT(signed(url, JSON.stringify({ pollMessageId: "a", chatId: "group@g.us", nonce: "a".repeat(32) })) as never)).status).toBe(400);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  const body = { pollMessageId: "wa-message-id", chatId: "12025550101@c.us", nonce: "a".repeat(32) };
  const res = await POLL_SENT(signed(url, JSON.stringify(body)) as never);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith("whatsapp_bot_register_poll", {
    p_poll_message_id: body.pollMessageId, p_chat_id: body.chatId, p_nonce: body.nonce,
  });
});

it("poll-sent ignores a stale menu and returns a retryable error on database failure", async () => {
  enable();
  const body = JSON.stringify({ pollMessageId: "wa-message-id", chatId: "90000000001@lid", nonce: "a".repeat(32) });
  mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
  expect(await (await POLL_SENT(signed("http://x/api/whatsapp/openwa/poll-sent", body) as never)).json()).toEqual({ ok: false });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "down" } });
  expect((await POLL_SENT(signed("http://x/api/whatsapp/openwa/poll-sent", body) as never)).status).toBe(503);
});
