// tests/whatsapp-player.test.ts — Bot de jugadores por WhatsApp (OpenWA):
// lib/whatsapp-player y el relay del DGX (ops/whatsapp-openwa/relay.mjs).
// Base falsa y rutas del bot de Telegram espiadas: aquí quedan las reglas de
// identidad, deduplicación, menús numerados y firma que no pueden romperse.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const routes = vi.hoisted(() => ({ routePlayerCallback: vi.fn(), routePlayerMessage: vi.fn() }));
vi.mock("@/lib/telegram-player/handler", () => routes);

import { createHmac } from "node:crypto";
import { show, type PlayerCtx, type Screen } from "@/lib/telegram-player/context";
import { cb, cbNew } from "@/lib/telegram-player/ids";
import { getWhatsAppBotConfig, phoneAllowed } from "@/lib/whatsapp-player/config";
import { matchMenu, menuModeFor, parseMenu, renderScreen, toWhatsAppText, type WhatsAppMenu } from "@/lib/whatsapp-player/format";
import { base64Bytes, classifyOpenWaEvent, MAX_WHATSAPP_MEDIA_BYTES } from "@/lib/whatsapp-player/inbound";
import { chatStateFromRow, createWhatsAppChannel, type WhatsAppChatRow } from "@/lib/whatsapp-player/channel";
import { signRelayBody, verifyRelaySignature } from "@/lib/whatsapp-player/signature";
import { handleWhatsAppEvent, RATE_LIMIT_PER_MINUTE, type WhatsAppBotDeps } from "@/lib/whatsapp-player/handler";
import { notifyPlayerReviewByWhatsApp } from "@/lib/whatsapp-player/notify";
import { chatKeyOf, createChatQueue, createRelay, relayHeaders, verifyOpenWaSignature } from "../ops/whatsapp-openwa/relay.mjs";

const NOW = Date.parse("2026-10-29T18:00:00Z");
const NOW_S = Math.floor(NOW / 1000);
const PHONE = "573001234567";
const SECRET = "relay-secret-for-unit-tests-0123456789abcdef";
const CONFIG = { relaySecret: SECRET, allowedPhones: null };
const MEDIA_ID = "0b9a2c4e-1f3d-4a5b-8c7d-6e5f4a3b2c1d";
const POLLA = "3f2a9c4e-1b7d-4e8f-9a6b-5c4d3e2f1a0b";

beforeEach(() => {
  routes.routePlayerCallback.mockReset();
  routes.routePlayerMessage.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function event(data: Record<string, unknown>, ev = "message.received") {
  return {
    event: ev, timestamp: NOW, sessionId: "s-1", idempotencyKey: "k", deliveryId: "d",
    data: { id: "true_573001234567@c.us_3EB0AA", from: `${PHONE}@c.us`, to: "573110000000@c.us", chatId: `${PHONE}@c.us`,
      body: "hola", type: "text", timestamp: NOW_S, isGroup: false, kind: "individual", fromMe: false, ...data },
  };
}

// ── formato ──────────────────────────────────────────────────────────────
describe("Telegram screens → WhatsApp text", () => {
  it("converts bold, italics, code and links, line by line", () => {
    expect(toWhatsAppText("<b>Hola</b> y <i>chao</i>")).toBe("*Hola* y _chao_");
    expect(toWhatsAppText("<b>uno\ndos</b>")).toBe("*uno*\n*dos*");
    expect(toWhatsAppText("Cuenta <code>3001234567</code> &amp; <a href=\"https://x.co/a\">aquí</a>")).toBe("Cuenta 3001234567 & aquí: https://x.co/a");
  });

  it("speaks WhatsApp instead of Telegram buttons", () => {
    expect(toWhatsAppText("Toca el número para copiarlo.")).toBe("Mantén presionado el número para copiarlo.");
    expect(toWhatsAppText("Todo con botones.")).toBe("Solo responde con el número de cada opción.");
    expect(toWhatsAppText("Toca una opción y luego toca enviar")).toBe("Elige una opción y luego elige enviar");
    expect(toWhatsAppText("Envíala como foto (no como archivo) para que Telegram la comprima.")).not.toContain("Telegram");
  });

  it("numbers the buttons, strips the new-message mark and remembers each callback", () => {
    const screen: Screen = {
      text: "¿Qué quieres hacer?",
      buttons: [[{ text: "Pollas disponibles", callback_data: cbNew("ol", 0) }], [{ text: "Mis pagos", callback_data: "pg" }],
        [{ text: "Ver en la web", url: "https://lapollacolombiana.com/polla/x" }, { text: "Peligro", url: "javascript:alert(1)" }]],
    };
    const { text, menu } = renderScreen(screen, "num");
    expect(text).toContain("*1.* Pollas disponibles\n*2.* Mis pagos");
    expect(text).toContain("_Responde con el número de la opción._");
    expect(text).toContain("Ver en la web: https://lapollacolombiana.com/polla/x");
    expect(text).not.toContain("javascript:");
    expect(menu).toEqual({ mode: "num", options: [
      { key: "1", data: cb("ol", 0), label: "Pollas disponibles" },
      { key: "2", data: "pg", label: "Mis pagos" },
    ] });
  });

  it("uses letters while a number is expected and maps the goal buttons to digits", () => {
    const screen: Screen = {
      text: "¿Cuántos goles hace Millos?",
      buttons: [[0, 1, 2, 3, 4].map((g) => ({ text: String(g), callback_data: `h:${g}` })), [{ text: "⏭ Saltar", callback_data: "sk" }]],
    };
    const { text, menu } = renderScreen(screen, menuModeFor("score"));
    expect(text).toContain("*A.* ⏭ Saltar");
    expect(text).toContain("número del 0 al 9, o con la letra");
    expect(menu?.digits).toEqual({ 0: "h:0", 1: "h:1", 2: "h:2", 3: "h:3", 4: "h:4" });
    expect(menuModeFor("name")).toBe("abc");
    expect(menuModeFor("proof")).toBe("num");
    expect(menuModeFor(null)).toBe("num");
  });

  it("keeps the message within WhatsApp's 4096 characters, options intact", () => {
    const { text } = renderScreen({ text: "x".repeat(6000), buttons: [[{ text: "Volver", callback_data: "hm" }]] }, "num");
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain("*1.* Volver");
  });

  it("a screen without options leaves the previous menu in place", () => {
    expect(renderScreen({ text: "Listo." }, "num").menu).toBeNull();
  });
});

describe("short replies → callbacks", () => {
  const menu: WhatsAppMenu = { mode: "num", options: [
    { key: "1", data: "ol", label: "🏆 Pollas disponibles" },
    { key: "2", data: "pg", label: "Mis pagos" },
  ] };

  it("accepts the number with punctuation or as a keycap emoji", () => {
    for (const t of ["1", " 1 ", "1.", "1)", "1️⃣", "01"]) expect(matchMenu(menu, t, { labels: true })).toBe("ol");
    expect(matchMenu(menu, "3", { labels: true })).toBeNull();
  });

  it("matches the option text only outside text steps", () => {
    expect(matchMenu(menu, "mis pagos", { labels: true })).toBe("pg");
    expect(matchMenu(menu, "mis pagos", { labels: false })).toBeNull();
  });

  it("never reads a score, a name or a ticket as an option", () => {
    for (const t of ["2-1", "Carlos", "15", "1 2"]) expect(matchMenu(menu, t, { labels: false })).toBeNull();
    const abc: WhatsAppMenu = { mode: "abc", options: [{ key: "A", data: "cx", label: "Cancelar" }], digits: { 2: "h:2" } };
    expect(matchMenu(abc, "a", { labels: false })).toBe("cx");
    expect(matchMenu(abc, "2", { labels: false })).toBe("h:2");
    expect(matchMenu(abc, "15", { labels: false })).toBeNull();
    expect(matchMenu(null, "1", { labels: true })).toBeNull();
  });

  it("drops a stored menu that does not have the expected shape", () => {
    expect(parseMenu(null)).toBeNull();
    expect(parseMenu({ mode: "x", options: [] })).toBeNull();
    expect(parseMenu({ mode: "num", options: [{ key: "1", data: "z".repeat(65), label: "x" }, { key: "2", data: "pg", label: "ok" }], digits: { 10: "h", 3: "h:3" } }))
      .toEqual({ mode: "num", options: [{ key: "2", data: "pg", label: "ok" }], digits: { 3: "h:3" } });
  });
});

// ── quién escribe ────────────────────────────────────────────────────────
describe("classifyOpenWaEvent — the verified sender is the identity", () => {
  it("reads a private text from a phone number", () => {
    expect(classifyOpenWaEvent(event({}), NOW)).toEqual({
      kind: "message", messageId: "true_573001234567@c.us_3EB0AA", phone: PHONE, replyTo: `${PHONE}@c.us`, text: "hola", media: null, otherMedia: false,
    });
  });

  it("a private id (@lid) needs the phone OpenWA resolved; without it, no account is touched", () => {
    const lid = event({ from: "123456789012345@lid", chatId: "123456789012345@lid", senderPhone: "+57 300 123 4567" });
    expect(classifyOpenWaEvent(lid, NOW)).toMatchObject({ kind: "message", phone: PHONE, replyTo: "123456789012345@lid" });
    const unresolved = event({ from: "123456789012345@lid", chatId: "123456789012345@lid", senderPhone: null });
    expect(classifyOpenWaEvent(unresolved, NOW)).toEqual({ kind: "unverified", messageId: "true_573001234567@c.us_3EB0AA", replyTo: "123456789012345@lid" });
  });

  it("ignores groups, channels, own messages, other events, stale deliveries and junk", () => {
    expect(classifyOpenWaEvent(event({ isGroup: true, from: "1203630@g.us" }), NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent(event({ kind: "status" }), NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent(event({ fromMe: true }), NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent(event({}, "message.sent"), NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent(event({ timestamp: NOW_S - 31 * 60 }), NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent(event({ from: "0300@c.us", chatId: "0300@c.us" }), NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent({ event: "message.received", data: "x" }, NOW).kind).toBe("ignore");
    expect(classifyOpenWaEvent(event({ body: "   " }), NOW).kind).toBe("ignore");
  });

  it("a number written in the text or a shared contact never chooses the account", () => {
    const other = classifyOpenWaEvent(event({ body: "soy el 573009999999" }), NOW);
    expect(other).toMatchObject({ phone: PHONE });
    expect(classifyOpenWaEvent(event({ type: "contact", body: "BEGIN:VCARD TEL:573009999999" }), NOW)).toMatchObject({ phone: PHONE, otherMedia: true, text: null });
  });

  it("images inline up to 3 MB (photos and image documents); the caption is not a command", () => {
    const b64 = Buffer.from("fake-jpeg-bytes").toString("base64");
    expect(classifyOpenWaEvent(event({ type: "image", body: "menú", media: { mimetype: "image/jpeg", data: b64 } }), NOW)).toMatchObject({
      text: null, media: { kind: "inline", base64: b64, mimetype: "image/jpeg", bytes: 15, source: "photo" },
    });
    expect(classifyOpenWaEvent(event({ type: "document", media: { mimetype: "image/png", data: b64 } }), NOW)).toMatchObject({ media: { kind: "inline", source: "document" } });
    expect(classifyOpenWaEvent(event({ type: "image", media: { mimetype: "image/jpeg", omitted: true, sizeBytes: 5_000_000 } }), NOW)).toMatchObject({ media: { kind: "too_large" } });
    expect(classifyOpenWaEvent(event({ type: "document", media: { mimetype: "application/pdf", data: b64 } }), NOW)).toMatchObject({ media: null, otherMedia: true });
    expect(classifyOpenWaEvent(event({ type: "audio" }), NOW)).toMatchObject({ otherMedia: true, text: null });
  });

  it("counts base64 bytes without decoding", () => {
    for (const s of ["a", "ab", "abc", "abcd", "x".repeat(1000)]) expect(base64Bytes(Buffer.from(s).toString("base64"))).toBe(s.length);
    expect(MAX_WHATSAPP_MEDIA_BYTES).toBe(3 * 1024 * 1024);
  });
});

describe("configuration and relay signature", () => {
  it("is off unless enabled with a long secret; the allowlist restricts who gets answers", () => {
    expect(getWhatsAppBotConfig({})).toBeNull();
    expect(getWhatsAppBotConfig({ WHATSAPP_OPENWA_BOT_ENABLED: "true", WHATSAPP_OPENWA_RELAY_SECRET: "short" })).toBeNull();
    const open = getWhatsAppBotConfig({ WHATSAPP_OPENWA_BOT_ENABLED: "true", WHATSAPP_OPENWA_RELAY_SECRET: SECRET })!;
    expect(phoneAllowed(open, "573009999999")).toBe(true);
    const test = getWhatsAppBotConfig({ WHATSAPP_OPENWA_BOT_ENABLED: "true", WHATSAPP_OPENWA_RELAY_SECRET: SECRET, WHATSAPP_OPENWA_ALLOWED_PHONES: "+57 300 123 4567, nope" })!;
    expect(phoneAllowed(test, PHONE)).toBe(true);
    expect(phoneAllowed(test, "573009999999")).toBe(false);
  });

  it("accepts only the exact body, the right secret and a fresh timestamp", () => {
    const body = JSON.stringify(event({}));
    const sig = signRelayBody(SECRET, NOW_S, body);
    expect(verifyRelaySignature(SECRET, String(NOW_S), sig, body, NOW)).toBe(true);
    expect(verifyRelaySignature(SECRET, String(NOW_S), sig, `${body} `, NOW)).toBe(false);
    expect(verifyRelaySignature("other-secret-0123456789abcdef0123", String(NOW_S), sig, body, NOW)).toBe(false);
    expect(verifyRelaySignature(SECRET, String(NOW_S), sig, body, NOW + 301_000)).toBe(false);
    expect(verifyRelaySignature(SECRET, null, sig, body, NOW)).toBe(false);
    expect(verifyRelaySignature(SECRET, "abc", sig, body, NOW)).toBe(false);
  });

  it("the DGX relay signs exactly what the app verifies", () => {
    const body = JSON.stringify(event({}));
    const headers = relayHeaders(SECRET, body, NOW);
    expect(verifyRelaySignature(SECRET, headers["x-lapolla-timestamp"], headers["x-lapolla-signature"], body, NOW)).toBe(true);
  });
});

// ── base falsa ───────────────────────────────────────────────────────────
interface FakeOpts {
  chatRow?: WhatsAppChatRow | null;
  profile?: Record<string, unknown> | null;
  duplicate?: boolean;
  recentCount?: number;
  mediaRow?: { data_b64: string } | null;
}
type Write = { table: string; op: string; value: unknown; filters: Array<[string, unknown]> };

function fakeDb(opts: FakeOpts = {}) {
  const writes: Write[] = [];
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let write: Write | null = null;
    let head = false;
    const result = () => {
      if (write?.op === "insert" && table === "whatsapp_bot_inbound") return { error: opts.duplicate ? { code: "23505" } : null };
      if (head) return { count: opts.recentCount ?? 1, error: null };
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: (_cols?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return chain; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
      gte: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
      insert: (value: unknown) => { write = { table, op: "insert", value, filters }; writes.push(write); return chain; },
      update: (value: unknown) => { write = { table, op: "update", value, filters }; writes.push(write); return chain; },
      upsert: (value: unknown) => { write = { table, op: "upsert", value, filters }; writes.push(write); return chain; },
      single: async () => (table === "whatsapp_bot_media" && write ? { data: { id: MEDIA_ID }, error: null } : { data: null, error: null }),
      maybeSingle: async () => {
        reads.push({ table, filters });
        if (table === "whatsapp_bot_chats") return { data: opts.chatRow ?? null, error: null };
        if (table === "users") return { data: opts.profile ?? null, error: null };
        if (table === "whatsapp_bot_media") return { data: opts.mediaRow ?? null, error: null };
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  });
  return { from, rpc: vi.fn(), writes, reads };
}

const COMPLETE = { display_name: "Ana Pérez", avatar_url: "millos" };
function chatRow(extra: Partial<WhatsAppChatRow> = {}): WhatsAppChatRow {
  return { phone: PHONE, user_id: "user-1", flow: null, flow_data: null, flow_at: null, menu: null, ...extra };
}
function deps(db: ReturnType<typeof fakeDb>, extra: Partial<WhatsAppBotDeps> = {}): WhatsAppBotDeps {
  return {
    db: db as never,
    config: CONFIG,
    webLink: vi.fn().mockResolvedValue({ kind: "magic", url: "https://lapollacolombiana.com/login/whatsapp?t=abc" }),
    env: {},
    now: () => NOW,
    resolveAccount: vi.fn().mockResolvedValue({ ok: true, authUserId: "user-new", created: true }),
    ...extra,
  };
}

describe("handleWhatsAppEvent — who answers what", () => {
  it("a new number gets an account in the chat: introduction, then the name step (no web needed)", async () => {
    const db = fakeDb({ chatRow: null, profile: { display_name: "+573001234567", avatar_url: null } });
    const d = deps(db);
    const out = await handleWhatsAppEvent(event({}), d);
    expect(out.outcome).toBe("handled");
    expect(d.resolveAccount).toHaveBeenCalledWith(`+${PHONE}`, "whatsapp-bot", db);
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_chats", op: "upsert", value: expect.objectContaining({ phone: PHONE, user_id: "user-new" }) }));
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "users", op: "update", value: { whatsapp_number: PHONE, whatsapp_verified: true }, filters: [["id", "user-new"]] }));
    expect(out.replies.map((r) => r.to)).toEqual([`${PHONE}@c.us`, `${PHONE}@c.us`]);
    expect(out.replies[0].text).toContain("*Bienvenido a La Polla Colombiana*");
    expect(out.replies[0].text).toContain("Solo responde con el número de cada opción.");
    expect(out.replies[1].text).toContain("*Paso 1 de 2: tu nombre*");
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_chats", op: "update", value: expect.objectContaining({ flow: "name", flow_data: { onb: true } }) }));
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_inbound", op: "update", value: { status: "done" } }));
  });

  it("a first message from a web account with a complete profile gets the welcome and the numbered menu", async () => {
    const db = fakeDb({ chatRow: null, profile: COMPLETE });
    const out = await handleWhatsAppEvent(event({ body: "Buenas tardes" }), deps(db));
    expect(out.replies[0].text).toContain("*¡Hola, Ana Pérez!*");
    expect(out.replies[0].text).toContain("Escribe «menú»");
    expect(out.replies[1].text).toContain("*1.* ⚽ Pollas disponibles");
    const menuWrite = db.writes.find((w) => w.table === "whatsapp_bot_chats" && w.op === "update" && (w.value as { menu?: unknown }).menu);
    expect((menuWrite?.value as { menu: WhatsAppMenu }).menu.options[0]).toMatchObject({ key: "1", data: cb("ol", 0) });
  });

  it("each WhatsApp message id is processed once", async () => {
    const db = fakeDb({ duplicate: true, chatRow: chatRow() });
    const out = await handleWhatsAppEvent(event({}), deps(db));
    expect(out).toEqual({ outcome: "duplicate", replies: [] });
    expect(db.reads).toHaveLength(0);
    expect(routes.routePlayerMessage).not.toHaveBeenCalled();
  });

  it(`more than ${RATE_LIMIT_PER_MINUTE} messages a minute from one number are dropped silently`, async () => {
    const db = fakeDb({ recentCount: RATE_LIMIT_PER_MINUTE + 1, chatRow: chatRow() });
    const out = await handleWhatsAppEvent(event({}), deps(db));
    expect(out).toEqual({ outcome: "limited", replies: [] });
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_inbound", op: "update", value: { status: "limited" } }));
  });

  it("outside the allowlist nothing is read or written", async () => {
    const db = fakeDb();
    const out = await handleWhatsAppEvent(event({}), deps(db, { config: { relaySecret: SECRET, allowedPhones: new Set(["573110000000"]) } }));
    expect(out).toEqual({ outcome: "ignored", replies: [] });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("an unresolved private id gets an explanation and touches no account", async () => {
    const db = fakeDb();
    const out = await handleWhatsAppEvent(event({ from: "99887766@lid", chatId: "99887766@lid" }), deps(db));
    expect(out.outcome).toBe("unverified");
    expect(out.replies[0]).toMatchObject({ to: "99887766@lid" });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("«1» opens the first option of the last screen, as if the button were tapped", async () => {
    const menu: WhatsAppMenu = { mode: "num", options: [{ key: "1", data: cb("ol", 0), label: "Pollas disponibles" }] };
    const db = fakeDb({ chatRow: chatRow({ menu }) });
    routes.routePlayerCallback.mockImplementation(async (ctx: PlayerCtx) => {
      await show(ctx, { text: "<b>Pollas disponibles</b>", buttons: [[{ text: "Polla Millos", callback_data: cb("p", "x") }]] });
    });
    const out = await handleWhatsAppEvent(event({ body: "1" }), deps(db));
    expect(routes.routePlayerCallback).toHaveBeenCalledWith(expect.objectContaining({ account: { userId: "user-1", phoneE164: `+${PHONE}` } }), cb("ol", 0), expect.anything());
    expect(out.replies).toEqual([{ to: `${PHONE}@c.us`, text: "*Pollas disponibles*\n\n*1.* Polla Millos\n\n_Responde con el número de la opción._" }]);
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_chats", op: "update", value: expect.objectContaining({ menu: { mode: "num", options: [{ key: "1", data: cb("p", "x"), label: "Polla Millos" }] } }) }));
  });

  it("while typing a ticket number, «15» is text even if a notice left a numbered menu", async () => {
    const menu: WhatsAppMenu = { mode: "num", options: Array.from({ length: 15 }, (_, i) => ({ key: String(i + 1), data: `o${i}`, label: `Op ${i}` })) };
    const db = fakeDb({ chatRow: chatRow({ menu, flow: "ticket", flow_data: { p: POLLA }, flow_at: new Date(NOW - 60_000).toISOString() }) });
    await handleWhatsAppEvent(event({ body: "15" }), deps(db));
    expect(routes.routePlayerCallback).not.toHaveBeenCalled();
    expect(routes.routePlayerMessage).toHaveBeenCalledWith(expect.objectContaining({ chat: expect.objectContaining({ flow: expect.objectContaining({ name: "ticket" }) }) }), { text: "15", photo: null, otherMedia: false }, expect.anything());
  });

  it("an expired step is wiped before anything else", async () => {
    const db = fakeDb({ chatRow: chatRow({ flow: "pay_account", flow_data: { m: "nequi" }, flow_at: new Date(NOW - 3 * 3_600_000).toISOString() }) });
    await handleWhatsAppEvent(event({ body: "3001234567" }), deps(db));
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_chats", op: "update", value: expect.objectContaining({ flow: null, flow_data: null, flow_at: null }) }));
    expect(routes.routePlayerMessage).toHaveBeenCalledWith(expect.objectContaining({ chat: expect.objectContaining({ flow: null }) }), expect.anything(), expect.anything());
  });

  it("a photo is staged for this number and handed to the proof flow by reference", async () => {
    const b64 = Buffer.from("fake-jpeg").toString("base64");
    const db = fakeDb({ chatRow: chatRow() });
    await handleWhatsAppEvent(event({ type: "image", body: "", media: { mimetype: "image/jpeg", data: b64 } }), deps(db));
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_media", op: "insert", value: { phone: PHONE, mimetype: "image/jpeg", data_b64: b64 } }));
    expect(routes.routePlayerMessage).toHaveBeenCalledWith(expect.anything(), {
      text: null, otherMedia: false,
      photo: { fileId: `wa:${MEDIA_ID}`, fileUniqueId: `wa:${MEDIA_ID}`, size: 9, source: "photo", mime: "image/jpeg" },
    }, expect.anything());
  });

  it("an image over 3 MB is not stored: the person is asked to send it as a photo", async () => {
    const db = fakeDb({ chatRow: chatRow() });
    const out = await handleWhatsAppEvent(event({ type: "image", media: { mimetype: "image/jpeg", omitted: true } }), deps(db));
    expect(out.replies[0].text).toContain("más de 3 MB");
    expect(db.writes.some((w) => w.table === "whatsapp_bot_media")).toBe(false);
    expect(routes.routePlayerMessage).not.toHaveBeenCalled();
  });

  it("«web» sends the single-use login link for the verified number", async () => {
    const db = fakeDb({ chatRow: chatRow() });
    routes.routePlayerMessage.mockImplementation(async (_ctx: PlayerCtx, _m: unknown, r: { webLink: () => Promise<void> }) => r.webLink());
    const d = deps(db);
    const out = await handleWhatsAppEvent(event({ body: "web" }), d);
    expect(d.webLink).toHaveBeenCalledWith(PHONE);
    expect(out.replies[0].text).toContain("https://lapollacolombiana.com/login/whatsapp?t=abc");
    expect(out.replies[0].text).toContain("no lo compartas");
  });

  it("a failure answers with the generic message and marks the message failed", async () => {
    const db = fakeDb({ chatRow: chatRow() });
    routes.routePlayerMessage.mockRejectedValue(new Error("boom"));
    const out = await handleWhatsAppEvent(event({ body: "hola" }), deps(db));
    expect(out.outcome).toBe("failed");
    expect(out.replies.at(-1)?.text).toContain("No pudimos completar eso");
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "whatsapp_bot_inbound", op: "update", value: { status: "failed" } }));
  });
});

describe("WhatsApp channel", () => {
  it("restores a live step and its menu with the same expiry rules as Telegram", () => {
    const live = chatStateFromRow(chatRow({ flow: "score", flow_data: { p: POLLA }, flow_at: new Date(NOW - 60_000).toISOString(), menu: { mode: "abc", options: [] } }), NOW);
    expect(live).toMatchObject({ existed: true, userId: "user-1", chat: { flow: { name: "score" }, stored: true }, menu: { mode: "abc" }, expiredFlow: false });
    expect(chatStateFromRow(chatRow({ flow: "hack", flow_data: {}, flow_at: new Date(NOW).toISOString() }), NOW).expiredFlow).toBe(true);
    expect(chatStateFromRow(null, NOW)).toMatchObject({ existed: false, userId: null });
  });

  it("reads a staged photo only for the same number and only by a valid id", async () => {
    const db = fakeDb({ mediaRow: { data_b64: Buffer.from("12345").toString("base64") } });
    const channel = createWhatsAppChannel({ db: db as never, phone: PHONE, chat: { locale: "es", flow: null, stored: false }, turn: { replies: [], menu: undefined }, now: () => NOW });
    expect(await channel.download(`wa:${MEDIA_ID}`, 100)).toEqual(Buffer.from("12345"));
    expect(db.reads.at(-1)?.filters).toEqual([["id", MEDIA_ID], ["phone", PHONE]]);
    expect(await channel.download(`wa:${MEDIA_ID}`, 3)).toBe("too_large");
    expect(await channel.download("wa:../../etc", 100)).toBeNull();
    expect(await channel.download("AgACAgEAAx0", 100)).toBeNull();
  });
});

describe("review notice by WhatsApp", () => {
  const notice = {
    userId: "user-1", pollaId: POLLA, pollaName: "Polla Millos", kind: "partidos", approved: true,
    prizeKind: "pozo" as const, prizeObject: null, pozoCop: 70000, rejectReason: null, ticketNumber: null, entryNumber: 1,
  };

  it("does nothing while the bot is off", async () => {
    const db = fakeDb({ chatRow: chatRow() });
    expect(await notifyPlayerReviewByWhatsApp(db as never, notice)).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("queues the notice only for a number that already wrote to the bot", async () => {
    vi.stubEnv("WHATSAPP_OPENWA_BOT_ENABLED", "true");
    vi.stubEnv("WHATSAPP_OPENWA_RELAY_SECRET", SECRET);
    const none = fakeDb({ chatRow: null });
    expect(await notifyPlayerReviewByWhatsApp(none as never, notice)).toBe(false);
    expect(none.writes).toHaveLength(0);

    const db = fakeDb({ chatRow: chatRow() });
    expect(await notifyPlayerReviewByWhatsApp(db as never, notice)).toBe(true);
    const write = db.writes.find((w) => w.table === "whatsapp_bot_outbox");
    expect(write?.value).toMatchObject({ phone: PHONE, user_id: "user-1", kind: "review" });
    expect(String((write?.value as { body: string }).body)).toContain("Polla Millos");
  });
});

// ── relay del DGX ────────────────────────────────────────────────────────
describe("DGX relay", () => {
  const cfg = {
    openwaUrl: "http://openwa:2785", appUrl: "https://app.test", apiKey: "owa_k1_test", sessionId: "sess-1",
    webhookSecret: "openwa-webhook-secret-0123456789", relaySecret: SECRET, outboxIntervalMs: 30_000, port: 0,
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("checks OpenWA's signature over the raw body", () => {
    const raw = JSON.stringify(event({}));
    const sig = `sha256=${createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex")}`;
    expect(verifyOpenWaSignature(cfg.webhookSecret, sig, raw)).toBe(true);
    expect(verifyOpenWaSignature(cfg.webhookSecret, sig, `${raw}x`)).toBe(false);
    expect(verifyOpenWaSignature(cfg.webhookSecret, undefined, raw)).toBe(false);
  });

  it("queues only received private messages, in order per chat", async () => {
    expect(chatKeyOf(JSON.stringify(event({})))).toBe(`${PHONE}@c.us`);
    expect(chatKeyOf(JSON.stringify(event({}, "session.status")))).toBeNull();
    expect(chatKeyOf(JSON.stringify(event({ fromMe: true })))).toBeNull();
    expect(chatKeyOf("not json")).toBeNull();
    const order: string[] = [];
    const queue = createChatQueue(10);
    queue.push("a", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a1"); });
    queue.push("a", async () => { order.push("a2"); });
    queue.push("b", async () => { order.push("b1"); });
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["b1", "a1", "a2"]);
  });

  it("forwards the exact body signed for the app, then sends the replies in order with stable idempotency keys", async () => {
    const raw = JSON.stringify(event({}));
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://app.test/api/whatsapp/openwa") {
        const h = init.headers as Record<string, string>;
        expect(init.body).toBe(raw);
        expect(init.redirect).toBe("manual");
        expect(verifyRelaySignature(SECRET, h["x-lapolla-timestamp"], h["x-lapolla-signature"], raw, Date.now())).toBe(true);
        return json(200, { outcome: "handled", replies: [{ to: `${PHONE}@c.us`, text: "uno" }, { to: `${PHONE}@c.us`, text: "dos" }] });
      }
      return json(201, { messageId: "m" });
    });
    const relay = createRelay(cfg, { fetch: fetchMock, sleep: async () => {} });
    await relay.forward(raw);
    const sends = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/messages/send-text"));
    expect(sends.map((c) => JSON.parse(String(c[1].body)))).toEqual([
      { chatId: `${PHONE}@c.us`, text: "uno", linkPreview: false },
      { chatId: `${PHONE}@c.us`, text: "dos", linkPreview: false },
    ]);
    expect(sends.map((c) => (c[1].headers as Record<string, string>)["idempotency-key"])).toEqual([
      "in-true_573001234567@c.us_3EB0AA-0", "in-true_573001234567@c.us_3EB0AA-1",
    ]);
    expect(String(sends[0][0])).toBe("http://openwa:2785/api/sessions/sess-1/messages/send-text");
  });

  it("retries the app on 5xx, stops when the bot is off (404)", async () => {
    const raw = JSON.stringify(event({}));
    const flaky = vi.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { outcome: "handled", replies: [] }));
    await createRelay(cfg, { fetch: flaky, sleep: async () => {} }).forward(raw);
    expect(flaky).toHaveBeenCalledTimes(2);
    const off = vi.fn().mockResolvedValue(json(404, {}));
    await createRelay(cfg, { fetch: off, sleep: async () => {} }).forward(raw);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("claims notices, sends each one and confirms it", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (url.endsWith("/outbox") && body.action === "claim") return json(200, { messages: [{ id: "n-1", to: `${PHONE}@c.us`, text: "Pago confirmado" }] });
      if (url.endsWith("/outbox")) return json(200, { ok: true });
      return json(201, { messageId: "m" });
    });
    const relay = createRelay(cfg, { fetch: fetchMock, sleep: async () => {} });
    await relay.pollOutbox();
    relay.stop();
    expect(calls.map((c) => c.body)).toEqual([
      { action: "claim", limit: 10 },
      { chatId: `${PHONE}@c.us`, text: "Pago confirmado", linkPreview: false },
      { action: "ack", id: "n-1", ok: true },
    ]);
  });
});
