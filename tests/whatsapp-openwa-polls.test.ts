import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { matchMenu } from "@/lib/whatsapp-player/format";
import { parseOpenWaMenu, renderOpenWaMenu, renderOpenWaScreen } from "@/lib/whatsapp-player/poll-menu";
import { claimPollVote } from "@/lib/whatsapp-player/poll-votes";
import { chatKeyOf, createRelay, verifyOpenWaSignature } from "../ops/whatsapp-openwa/relay.mjs";
import { verifyRelaySignature } from "@/lib/whatsapp-player/signature";

const PHONE = "12025550101";
const BOT = "12025550102";
const CHAT = `${PHONE}@c.us`;
const LID = "90000000001@lid";
const NOW = 1_798_200_000_123;
const SECRET = "openwa-poll-unit-test-relay-0123456789";
const CONFIG = { relaySecret: SECRET, allowedPhones: null };
const screen = (count = 2) => renderOpenWaScreen({ text: "Long instructions", compactText: "Elige una polla.",
  buttons: [Array.from({ length: count }, (_, i) => ({ text: `Polla ${i}`, callback_data: `p:${i}` }))] }, "num");
const vote = (data: Record<string, unknown> = {}) => ({ event: "poll.vote", data: {
  pollMessageId: "poll-a", chatId: CHAT, voterId: LID, selectedOptions: ["Polla 0"],
  timestamp: Math.floor(NOW / 1000), timestampMs: NOW, selfChecked: true, fromMe: false, ...data,
} });

describe("OpenWA single answer menus", () => {
  it("uses compact source copy, button labels, Menú and numbered fallback", () => {
    const result = screen();
    expect(result.text).toContain("Elige una polla.");
    expect(result.text).not.toContain("Long instructions");
    expect(result.poll).toMatchObject({ name: "Elige una polla.", options: ["Polla 0", "Polla 1", "Menú"], allowMultipleAnswers: false });
    expect(matchMenu(result.menu, "1", { labels: true })).toBe("p:0");
    expect(matchMenu(result.menu, "Polla 1", { labels: true })).toBe("p:1");
    expect(matchMenu(result.menu, "menú", { labels: true })).toBe("m");
    expect(parseOpenWaMenu(result.menu)).toEqual(result.menu);
  });

  it.each([0, 1, 10, 11, 12, 21, 60])( "renders %i choices without exceeding WhatsApp limits or losing any page", count => {
    let result = screen(count);
    const visited = new Set<string>();
    for (;;) {
      expect(result.poll.options.length).toBeGreaterThanOrEqual(2);
      expect(result.poll.options.length).toBeLessThanOrEqual(12);
      expect(result.poll.options).toContain("Menú");
      expect(result.poll.allowMultipleAnswers).toBe(false);
      result.menu.options.filter(o => o.data.startsWith("p:")).forEach(o => visited.add(o.data));
      const next = result.menu.options.find(o => o.data.startsWith("wapage:") && o.label === "Más");
      if (!next) break;
      const previousNonce = result.menu.nonce;
      result = renderOpenWaMenu({ ...result.menu, page: Number(next.data.split(":")[1]) });
      expect(result.menu.nonce).not.toBe(previousNonce);
      expect(result.poll.options).toContain("Anterior");
      expect(matchMenu(result.menu, "Anterior", { labels: true })).toMatch(/^wapage:/);
    }
    expect(visited.size).toBe(count);
  });

  it("keeps long, duplicate and emoji labels unique and bounded with intact graphemes", () => {
    const result = renderOpenWaScreen({ text: "a".repeat(6000), buttons: [[
      { text: "🏆 " + "é".repeat(150), callback_data: "a" },
      { text: "🏆 " + "é".repeat(150), callback_data: "b" },
      { text: "Menú", callback_data: "other" },
    ]] }, "num");
    expect(result.poll.name.length).toBeLessThanOrEqual(255);
    expect(result.text.length).toBeLessThanOrEqual(4096);
    expect(new Set(result.poll.options).size).toBe(result.poll.options.length);
    expect(result.poll.options.every(o => o.length <= 100 && !o.includes("🏆"))).toBe(true);
    expect(result.menu.options.at(-1)).toMatchObject({ label: "Menú", data: "m" });
  });

  it("keeps letters and goal digits while a free number is expected", () => {
    const result = renderOpenWaScreen({ text: "Escribe el marcador.", buttons: [[
      { text: "0", callback_data: "h:0" }, { text: "1", callback_data: "h:1" }, { text: "Cancelar", callback_data: "cx" },
    ]] }, "abc");
    expect(result.poll.options).toEqual(["0", "1", "Cancelar", "Menú"]);
    expect(matchMenu(result.menu, "C", { labels: false })).toBe("cx");
    expect(matchMenu(result.menu, "0", { labels: false })).toBe("h:0");
    expect(matchMenu(result.menu, "15", { labels: false })).toBeNull();
    expect(matchMenu(result.menu, "2-1", { labels: false })).toBeNull();
  });

  it("keeps Más and Anterior navigation labels when content has the same titles", () => {
    const source = Array.from({ length: 30 }, (_, i) => ({ label: i === 9 ? "Anterior" : "Más", data: `p:${i}` }));
    const result = renderOpenWaMenu({ body: "Elige.", source, page: 1, mode: "num" });
    expect(result.menu.options.find(o => o.label === "Más")?.data).toBe("wapage:2");
    expect(result.menu.options.find(o => o.label === "Anterior")?.data).toBe("wapage:0");
  });

  it("includes HTTPS links, rejects unsafe links, and strips the Telegram message marker", () => {
    const result = renderOpenWaScreen({ text: "Abre el enlace.", buttons: [[
      { text: "Ver", url: "https://example.org/polla" }, { text: "Unsafe", url: "javascript:alert(1)" },
      { text: "Elegir", callback_data: "!p:1" },
    ]] }, "num");
    expect(result.text).toContain("https://example.org/polla");
    expect(result.text).not.toContain("javascript:");
    expect(result.menu.options[0].data).not.toContain("!");
  });
});

function voteDb(opts: { unknown?: boolean; stale?: boolean; lookupError?: boolean } = {}) {
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.unknown ? null : { phone: PHONE }, error: opts.lookupError ? { code: "down" } : null }) };
  const rpc = vi.fn().mockResolvedValue({ data: opts.stale ? [] : [{ phone: PHONE, chat_id: CHAT, callback: "p:0", menu_nonce: "a".repeat(32) }], error: null });
  return { from: vi.fn(() => chain), rpc, chain };
}
describe("poll vote identity and claims", () => {
  it("maps @lid votes exclusively through pollMessageId, never using the voter as an account", async () => {
    const db = voteDb();
    expect(await claimPollVote(vote(), db as never, CONFIG, NOW)).toMatchObject({ phone: PHONE, chatId: CHAT, callback: "p:0" });
    expect(db.chain.eq).toHaveBeenCalledWith("poll_message_id", "poll-a");
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_bot_claim_poll_vote", {
      p_poll_message_id: "poll-a", p_chat_id: CHAT, p_option: "Polla 0", p_vote_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain(LID);
  });
  it.each([{ fromMe: true }, { selfChecked: false }, { selectedOptions: [] }, { selectedOptions: ["A", "B"] },
    { chatId: "group@g.us" }, { timestamp: Math.floor(NOW / 1000) - 1801 }])("ignores unsafe votes before DB access: %j", async data => {
    const db = voteDb();
    expect(await claimPollVote(vote(data), db as never, CONFIG, NOW)).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
  it("ignores unknown polls and allowlisted recipients only, regardless of voter identity", async () => {
    const db = voteDb({ unknown: true });
    expect(await claimPollVote(vote(), db as never, CONFIG, NOW)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
    const allowed = voteDb();
    expect(await claimPollVote(vote(), allowed as never, { ...CONFIG, allowedPhones: new Set([BOT]) }, NOW)).toBeNull();
    expect(allowed.rpc).not.toHaveBeenCalled();
  });
  it("returns nothing when SQL rejects an unknown option, old menu or already consumed poll", async () => {
    const db = voteDb({ stale: true });
    expect(await claimPollVote(vote(), db as never, CONFIG, NOW)).toBeNull();
  });
  it("deduplicates by poll + option + timestampMs and delegates first-vote exclusion to SQL", async () => {
    const db = voteDb();
    db.rpc.mockResolvedValueOnce({ data: [{ phone: PHONE, chat_id: CHAT, callback: "p:0", menu_nonce: "a".repeat(32) }], error: null })
      .mockResolvedValue({ data: [], error: null });
    const first = await claimPollVote(vote(), db as never, CONFIG, NOW);
    expect(first).not.toBeNull();
    expect(await claimPollVote(vote(), db as never, CONFIG, NOW)).toBeNull();
    expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1]);
    expect(await claimPollVote(vote({ selectedOptions: ["Polla 1"], timestampMs: NOW + 1 }), db as never, CONFIG, NOW)).toBeNull();
    expect(db.rpc.mock.calls[2][1].p_vote_key).not.toBe(db.rpc.mock.calls[0][1].p_vote_key);
  });
  it("fails closed on DB lookup/claim errors without routing a callback", async () => {
    await expect(claimPollVote(vote(), voteDb({ lookupError: true }) as never, CONFIG, NOW)).rejects.toThrow("poll lookup");
    const db = voteDb();
    db.rpc.mockResolvedValue({ data: null, error: { code: "down" } });
    await expect(claimPollVote(vote(), db as never, CONFIG, NOW)).rejects.toThrow("poll claim");
  });
});

const cfg = { openwaUrl: "http://openwa:2785", appUrl: "https://app.test", apiKey: "test", sessionId: "test-session",
  webhookSecret: "test-webhook-secret", relaySecret: SECRET, outboxIntervalMs: 30_000, port: 0 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe("relay polls", () => {
  it("verifies the poll.vote webhook's raw OpenWA signature and rejects tampering", () => {
    const raw = JSON.stringify(vote());
    const signature = `sha256=${createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex")}`;
    expect(verifyOpenWaSignature(cfg.webhookSecret, signature, raw)).toBe(true);
    expect(verifyOpenWaSignature(cfg.webhookSecret, signature, raw.replace("Polla 0", "Polla 1"))).toBe(false);
  });
  it("serializes votes and messages by the same private chat", () => {
    expect(chatKeyOf(JSON.stringify(vote()))).toBe(CHAT);
    expect(chatKeyOf(JSON.stringify({ event: "message.received", data: { chatId: CHAT, from: LID } }))).toBe(CHAT);
    expect(chatKeyOf(JSON.stringify(vote({ chatId: "group@g.us" })))).toBeNull();
  });
  it("sends exact native payloads and signs the real WhatsApp poll id acknowledgement", async () => {
    const rendered = screen();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/api/whatsapp/openwa")) return json({ replies: [{ to: CHAT, text: rendered.text, poll: rendered.poll }] });
      if (url.endsWith("send-poll")) return json({ messageId: "native-wa-id", timestamp: Math.floor(NOW / 1000) }, 201);
      if (url.endsWith("poll-sent")) return json({ ok: true });
      return json({ messageId: "text-id" }, 201);
    });
    await createRelay(cfg, { fetch: fetchMock, sleep: async () => {} }).forward(JSON.stringify({ event: "message.received", data: { id: "incoming" } }));
    const poll = calls.find(c => c.url.endsWith("send-poll"))!;
    expect(poll.url).toBe("http://openwa:2785/api/sessions/test-session/messages/send-poll");
    expect(JSON.parse(String(poll.init.body))).toEqual({ chatId: CHAT, name: rendered.poll.name, options: rendered.poll.options, allowMultipleAnswers: false });
    const ack = calls.find(c => c.url.endsWith("poll-sent"))!;
    expect(JSON.parse(String(ack.init.body))).toEqual({ pollMessageId: "native-wa-id", chatId: CHAT, nonce: rendered.menu.nonce });
    const headers = ack.init.headers as Record<string, string>;
    expect(verifyRelaySignature(SECRET, headers["x-lapolla-timestamp"], headers["x-lapolla-signature"], String(ack.init.body), Date.now())).toBe(true);
  });
  it("forwards a signed @lid vote only after excluding the session's own phone", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/test-session")) return json({ phone: BOT });
      if (url.endsWith(`/contacts/${encodeURIComponent(LID)}/phone`)) return json({ contactId: LID, phone: PHONE });
      const raw = String(init?.body);
      const headers = init?.headers as Record<string, string>;
      expect(verifyRelaySignature(SECRET, headers["x-lapolla-timestamp"], headers["x-lapolla-signature"], raw, Date.now())).toBe(true);
      expect(JSON.parse(raw)).toMatchObject({ event: "poll.vote", data: { voterId: LID, selfChecked: true, fromMe: false } });
      return json({ replies: [] });
    });
    await createRelay(cfg, { fetch: fetchMock, sleep: async () => {} }).forward(JSON.stringify(vote()));
    expect(fetchMock.mock.calls.some(c => c[0] === "https://app.test/api/whatsapp/openwa")).toBe(true);
  });

  it("registers the actual @lid chat when OpenWA resolves an outgoing c.us recipient", async () => {
    const rendered = screen();
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/whatsapp/openwa")) return json({ replies: [{ to: CHAT, text: rendered.text, poll: rendered.poll }] });
      if (url.endsWith("poll-sent")) {
        expect(JSON.parse(String(init.body)).chatId).toBe(LID);
        return json({ ok: true });
      }
      return json({ messageId: `true_${LID}_nativePoll` }, 201);
    });
    await createRelay(cfg, { fetch: fetchMock, sleep: async () => {} }).forward(JSON.stringify({ event: "message.received", data: { id: "in" } }));
    expect(fetchMock.mock.calls.some(c => c[0].endsWith("poll-sent"))).toBe(true);
  });
  it.each([`${BOT}@c.us`, LID])("never forwards the bot's own vote from %s", async voterId => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/test-session") ? json({ phone: BOT }) : json({ phone: BOT }));
    await createRelay(cfg, { fetch: fetchMock, sleep: async () => {} }).forward(JSON.stringify(vote({ voterId })));
    expect(fetchMock.mock.calls.every(c => c[0].startsWith(cfg.openwaUrl))).toBe(true);
  });
  it("does not route a vote when the bot identity or @lid self-check cannot resolve", async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/test-session") ? json({ phone: BOT }) : json({ phone: null }));
    await createRelay(cfg, { fetch: fetchMock, sleep: async () => {} }).forward(JSON.stringify(vote()));
    expect(fetchMock.mock.calls.every(c => c[0].startsWith(cfg.openwaUrl))).toBe(true);
  });
  it("retries poll-sent acknowledgements without resending a poll", async () => {
    let attempts = 0;
    const rendered = screen();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/whatsapp/openwa")) return json({ replies: [{ to: CHAT, text: rendered.text, poll: rendered.poll }] });
      if (url.endsWith("poll-sent")) return ++attempts === 1 ? json({}, 503) : json({ ok: true });
      return json({ messageId: "wa-poll" }, 201);
    });
    await createRelay(cfg, { fetch: fetchMock, sleep: async () => {} }).forward(JSON.stringify({ data: { id: "in" } }));
    expect(fetchMock.mock.calls.filter(c => c[0].endsWith("send-poll"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(c => c[0].endsWith("poll-sent"))).toHaveLength(2);
  });
});
