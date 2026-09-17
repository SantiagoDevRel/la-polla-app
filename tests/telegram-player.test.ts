// tests/telegram-player.test.ts — Bot de Telegram para jugadores
// (lib/telegram-player). Base y API de Telegram falsas. El recorrido completo
// contra Supabase local (cuenta, perfil, comprobante, pronósticos, tabla, rifa)
// se verificó con un servidor falso de la Bot API; aquí quedan las reglas que no
// pueden romperse sin que falle una prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminFactory = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminFactory);
vi.mock("server-only", () => ({}));
const queries = vi.hoisted(() => ({
  getMyEntry: vi.fn(),
  getPollaMatches: vi.fn(),
  getPot: vi.fn(),
  getPayouts: vi.fn(),
}));
vi.mock("@/lib/casa/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/casa/queries")>()),
  getMyEntry: queries.getMyEntry,
  getPollaMatches: queries.getPollaMatches,
  getPot: queries.getPot,
  getPayouts: queries.getPayouts,
}));
vi.mock("@/lib/casa/tournaments", () => ({ getPollaTournamentSlugs: vi.fn().mockResolvedValue({}) }));

import { CALLBACK_MAX_BYTES, cb, cbNew, longId, shortId, stableUuid } from "@/lib/telegram-player/ids";
import { redactTelegramDescription } from "@/lib/auth/telegram-login/bot-api";
import { classifyPlayerUpdate } from "@/lib/telegram-player/update";
import { isBareStart, isLoginIntent, MAIN_KEYBOARD, menuCommandOf } from "@/lib/telegram-player/copy";
import { ensureWebhookUpdates, resetWebhookUpdatesStateForTests } from "@/lib/auth/telegram-login/webhook-updates";
import { notifyPlayerReviewByTelegram, reviewNoticeMessage } from "@/lib/telegram-player/notify";
import { saveCasaPicks } from "@/lib/casa/picks-save";
import { handleTelegramUpdate, isDoubleTap } from "@/lib/telegram-player/handler";
import { paymentLine, pollaDetailScreen, showPayments } from "@/lib/telegram-player/pollas";
import { cannotPickReason } from "@/lib/telegram-player/picks";
import { generateNonce, sha256Hex } from "@/lib/auth/telegram-login/crypto";

const BOT_TOKEN = "123456789:AAFakeTokenForUnitTestsOnly_abcdefghijk";
const SECRET = "unit-test-webhook-secret-0123456789abcdef";
const CONFIG = { botToken: BOT_TOKEN, webhookSecret: SECRET, botUsername: "LaPollaLoginBot", allowExistingAccounts: true };
const TG = 5550001;
const PHONE = "+573001234567";
const POLLA = "3f2a9c4e-1b7d-4e8f-9a6b-5c4d3e2f1a0b";
const MATCH = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

beforeEach(() => {
  resetWebhookUpdatesStateForTests();
  adminFactory.createAdminClient.mockReset();
  queries.getMyEntry.mockReset();
  queries.getPollaMatches.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function privateMessage(extra: Record<string, unknown>, userId = TG) {
  return { update_id: 1, message: { message_id: 10, date: 1, chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false }, ...extra } };
}
function callback(data: string, userId = TG, chatType = "private") {
  return { update_id: 2, callback_query: { id: "cb-1", data, from: { id: userId, is_bot: false }, message: { message_id: 55, chat: { id: userId, type: chatType } } } };
}

// ── ids ──────────────────────────────────────────────────────────────────
describe("callback ids — 64 bytes and untrusted input", () => {
  it("round-trips a uuid in 22 base64url characters", () => {
    const s = shortId(POLLA);
    expect(s).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(longId(s)).toBe(POLLA);
  });

  it("rejects malformed or non-canonical ids instead of guessing", () => {
    for (const bad of [undefined, "", "abc", `${shortId(POLLA)}x`, "!!!!!!!!!!!!!!!!!!!!!!", "AAAAAAAAAAAAAAAAAAAAAB"]) {
      expect(longId(bad)).toBeNull();
    }
    expect(() => shortId("not-a-uuid")).toThrow();
  });

  it("the longest callbacks the bot builds fit Telegram's limit", () => {
    const P = shortId(POLLA);
    const M = shortId(MATCH);
    for (const data of [cb("s", P, M, 30, 30), cb("qo", M, P), cb("rt", P, 100000), cb("pa", "gambeteador", "o")]) {
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    }
    expect(() => cb("x".repeat(65))).toThrow();
    expect(cbNew("rt", P, 100000)).toBe(`!rt:${P}:100000`);
    expect(Buffer.byteLength(cbNew("s", P, M, 30, 30))).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
  });

  it("stable uuids are deterministic v4-shaped", () => {
    const a = stableUuid("tg-proof|u|p||hash");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableUuid("tg-proof|u|p||hash")).toBe(a);
    expect(stableUuid("tg-proof|u|p||other")).not.toBe(a);
  });
});

// ── classify ─────────────────────────────────────────────────────────────
describe("classifyPlayerUpdate — private chats only, sender is the chat", () => {
  it("reads a callback from the owner of the chat", () => {
    expect(classifyPlayerUpdate(callback("pg"))).toEqual({ kind: "callback", callbackId: "cb-1", chatId: TG, telegramUserId: TG, messageId: 55, editDate: null, data: "pg" });
  });

  it("ignores callbacks from groups, other chats, bots and oversized data", () => {
    expect(classifyPlayerUpdate(callback("pg", TG, "group")).kind).toBe("ignore");
    const other = callback("pg");
    other.callback_query.message.chat.id = 42;
    expect(classifyPlayerUpdate(other).kind).toBe("ignore");
    const bot = callback("pg");
    (bot.callback_query.from as Record<string, unknown>).is_bot = true;
    expect(classifyPlayerUpdate(bot).kind).toBe("ignore");
    expect(classifyPlayerUpdate(callback("x".repeat(65))).kind).toBe("ignore");
  });

  it("picks the largest photo size and accepts image documents", () => {
    const photo = classifyPlayerUpdate(privateMessage({ photo: [
      { file_id: "small", file_unique_id: "u1", width: 90, height: 90, file_size: 10 },
      { file_id: "big", file_unique_id: "u2", width: 1280, height: 720, file_size: 900 },
    ] }));
    expect(photo).toMatchObject({ kind: "message", photo: { fileId: "big", fileUniqueId: "u2", source: "photo", size: 900 } });
    const doc = classifyPlayerUpdate(privateMessage({ document: { file_id: "d", file_unique_id: "ud", mime_type: "image/PNG", file_size: 5 } }));
    expect(doc).toMatchObject({ photo: { fileId: "d", source: "document", mime: "image/png" }, otherMedia: false });
    const pdf = classifyPlayerUpdate(privateMessage({ document: { file_id: "d", file_unique_id: "ud", mime_type: "application/pdf" } }));
    expect(pdf).toMatchObject({ photo: null, otherMedia: true });
    expect(classifyPlayerUpdate(privateMessage({ sticker: { file_id: "s" } }))).toMatchObject({ otherMedia: true });
  });
});

describe("menu commands", () => {
  it("maps the fixed keyboard labels (with emoji) and commands", () => {
    const labels = MAIN_KEYBOARD.keyboard.flat().map((b) => b.text);
    expect(labels.map((label) => menuCommandOf(label))).toEqual(["abiertas", "mias", "pagos", "perfil", "ayuda"]);
    expect(menuCommandOf("/start@LaPollaLoginBot")).toBe("home");
    expect(menuCommandOf("Menú")).toBe("home");
    expect(menuCommandOf("/web")).toBe("web");
    expect(menuCommandOf("Carlos Pérez")).toBeNull();
    expect(menuCommandOf("2-1")).toBeNull();
  });

  it("while typing a name or a free answer, only the real buttons and /commands count as menu", () => {
    for (const word of ["Hola", "Pagos", "web", "menu", "perfil"]) {
      expect(menuCommandOf(word, { strict: true })).toBeNull();
      expect(menuCommandOf(word)).not.toBeNull();
    }
    expect(menuCommandOf("💳 Mis pagos", { strict: true })).toBe("pagos");
    expect(menuCommandOf("/cancelar", { strict: true })).toBe("cancelar");
  });

  it("leaves web login intents to the login flow", () => {
    expect(isLoginIntent(`/start ${generateNonce()}`)).toBe(true);
    expect(isLoginIntent("/login")).toBe(true);
    expect(isLoginIntent("/start")).toBe(false);
    expect(isBareStart("/start@LaPollaLoginBot")).toBe(true);
  });
});

describe("Bot API logs", () => {
  it("never logs the single-use link that Telegram echoes back in an error", () => {
    const echoed = "Bad Request: inline keyboard button URL 'http://localhost:3006/login/telegram?t=_ILVhzFYdhaja-3jtRs3hLYXlDocdtAhzcGX5KKUa98' is invalid: Wrong HTTP URL";
    const safe = redactTelegramDescription(echoed);
    expect(safe).toBe("Bad Request: inline keyboard button URL <url> is invalid: Wrong HTTP URL");
    expect(safe).not.toMatch(/t=|_ILVh/);
  });
});

// ── webhook allowed_updates ──────────────────────────────────────────────
describe("ensureWebhookUpdates — adds callback_query without moving the webhook", () => {
  const info = (result: Record<string, unknown>) => ({ ok: true as const, result });

  it("does nothing without configuration", async () => {
    const call = vi.fn();
    expect(await ensureWebhookUpdates({ config: null, call })).toBe("disabled");
    expect(call).not.toHaveBeenCalled();
  });

  it("re-registers the SAME url with the env secret, merged types and no dropped updates", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(info({ url: "https://lapollacolombiana.com/api/telegram/login", allowed_updates: ["message"], max_connections: 20 }))
      .mockResolvedValueOnce({ ok: true, result: true });
    expect(await ensureWebhookUpdates({ config: CONFIG, call })).toBe("updated");
    expect(call).toHaveBeenNthCalledWith(2, "setWebhook", {
      url: "https://lapollacolombiana.com/api/telegram/login",
      secret_token: SECRET,
      allowed_updates: ["message", "callback_query"],
      max_connections: 20,
    });
    expect(JSON.stringify(call.mock.calls)).not.toContain("drop_pending_updates");
    // Una vez por instancia.
    expect(await ensureWebhookUpdates({ config: CONFIG, call })).toBe("current");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("never sets a webhook that is missing or points elsewhere", async () => {
    for (const url of ["", "https://evil.example/api/telegram/login/x", "http://lapollacolombiana.com/api/telegram/login"]) {
      resetWebhookUpdatesStateForTests();
      const call = vi.fn().mockResolvedValueOnce(info({ url, allowed_updates: ["message"] }));
      expect(await ensureWebhookUpdates({ config: CONFIG, call })).toBe("skipped");
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("is current with callback_query or with Telegram's default list; a failure retries later", async () => {
    let call = vi.fn().mockResolvedValueOnce(info({ url: "https://lapollacolombiana.com/api/telegram/login" }));
    expect(await ensureWebhookUpdates({ config: CONFIG, call })).toBe("current");
    resetWebhookUpdatesStateForTests();
    call = vi.fn().mockResolvedValue({ ok: false, description: null });
    expect(await ensureWebhookUpdates({ config: CONFIG, call })).toBe("failed");
    expect(await ensureWebhookUpdates({ config: CONFIG, call })).toBe("failed");
    expect(call).toHaveBeenCalledTimes(2);
  });
});

// ── avisos de revisión ───────────────────────────────────────────────────
describe("review notice by Telegram", () => {
  const base = { userId: "user-1", pollaId: POLLA, pollaName: "Fecha <8>", kind: "partidos", prizeKind: "pozo" as const, prizeObject: null, pozoCop: 140000, rejectReason: null, ticketNumber: null };

  it("approved: confirms, shows the pot and offers to predict", () => {
    const m = reviewNoticeMessage({ ...base, approved: true });
    expect(m.text).toContain("Confirmamos tu pago de Fecha &lt;8&gt;");
    expect(m.text).toContain("$140.000");
    // «!»: el botón abre un mensaje nuevo y este aviso sigue en el chat.
    expect(m.buttons[0][0]).toEqual({ text: "⚽ Pronosticar", callback_data: `!pk:${shortId(POLLA)}` });
  });

  it("rejected: escaped reason, never asks to pay again, button to resend the proof", () => {
    const m = reviewNoticeMessage({ ...base, approved: false, rejectReason: "Valor <incompleto>" });
    expect(m.text).toContain("Motivo: Valor &lt;incompleto&gt;");
    expect(m.text).toContain("no repitas el pago");
    expect(m.buttons[0][0].callback_data).toBe(`!j:${shortId(POLLA)}`);
    // Rifa rechazada: directo a reenviar el comprobante de ESA boleta.
    const raffle = reviewNoticeMessage({ ...base, kind: "rifa", ticketNumber: 7, approved: false }).buttons[0][0];
    expect(raffle).toEqual({ text: "📸 Enviar el comprobante de la boleta 7", callback_data: `!rt:${shortId(POLLA)}:7` });
  });

  it("goes only to the linked Telegram account, and not at all without the bot", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { telegram_user_id: TG }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const db = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) };
    const client = { send: vi.fn().mockResolvedValue(true), call: vi.fn(), download: vi.fn() };

    expect(await notifyPlayerReviewByTelegram(db as never, { ...base, approved: true }, client)).toBe(false);
    expect(db.from).not.toHaveBeenCalled();

    vi.stubEnv("TELEGRAM_LOGIN_BOT_TOKEN", BOT_TOKEN);
    vi.stubEnv("TELEGRAM_LOGIN_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME", "LaPollaLoginBot");
    expect(await notifyPlayerReviewByTelegram(db as never, { ...base, approved: true }, client)).toBe(true);
    expect(db.from).toHaveBeenCalledWith("telegram_login_identities");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(client.send).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ chat_id: TG, parse_mode: "HTML" }));

    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    client.send.mockClear();
    expect(await notifyPlayerReviewByTelegram(db as never, { ...base, approved: true }, client)).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });
});

// ── reglas de guardado compartidas con la web ────────────────────────────
describe("saveCasaPicks — same rules for the web and the bot", () => {
  const polla = { id: POLLA, kind: "manual" as const, status: "abierta" as const, closes_at: "2999-01-01T00:00:00Z", opens_at: "2000-01-01T00:00:00Z", publication_mode: "ahora" as const, scoring_mode: null, draw_pending: false };
  const Q1 = "11111111-1111-4111-8111-111111111111";
  const Q2 = "22222222-2222-4222-8222-222222222222";
  const OPT_Q2 = "33333333-3333-4333-8333-333333333333";

  function fakeDb() {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "casa_questions") return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: Q1, resolved_at: null }, { id: Q2, resolved_at: null }], error: null }) }) };
      if (table === "casa_options") return { select: () => ({ in: () => Promise.resolve({ data: [{ id: OPT_Q2, question_id: Q2 }], error: null }) }) };
      if (table === "casa_picks") return { upsert };
      throw new Error(`tabla inesperada ${table}`);
    });
    return { from, upsert };
  }

  it("does not save without a paid entry or a proof in review", async () => {
    const db = fakeDb();
    queries.getMyEntry.mockResolvedValue({ id: "e1", status: "pendiente", proof_path: null });
    queries.getPollaMatches.mockResolvedValue([]);
    const result = await saveCasaPicks(polla, "user-1", [{ questionId: Q1, freeText: "x" }], db as never);
    expect(result).toEqual({ ok: false, status: 403, error: "Primero tienes que inscribirte a la polla." });
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("rejects an option that belongs to another question", async () => {
    const db = fakeDb();
    queries.getMyEntry.mockResolvedValue({ id: "e1", status: "pagada", proof_path: "x" });
    queries.getPollaMatches.mockResolvedValue([]);
    const result = await saveCasaPicks(polla, "user-1", [{ questionId: Q1, optionId: OPT_Q2 }], db as never);
    expect(result).toEqual({ ok: false, status: 400, error: "Una opción no pertenece a su pregunta." });
    expect(db.upsert).not.toHaveBeenCalled();

    const ok = await saveCasaPicks(polla, "user-1", [{ questionId: Q2, optionId: OPT_Q2 }], db as never);
    expect(ok).toEqual({ ok: true, guardados: 1, avisos: [] });
    expect(db.upsert).toHaveBeenCalledWith([expect.objectContaining({ entry_id: "e1", user_id: "user-1", question_id: Q2, option_id: OPT_Q2 })], { onConflict: "entry_id,question_id" });
  });

  it("a closed or started match is never saved, and a match from another polla is refused", async () => {
    const db = fakeDb();
    const matches = { ...polla, kind: "partidos" as const, scoring_mode: "1x2" as const };
    queries.getMyEntry.mockResolvedValue({ id: "e1", status: "pagada", proof_path: "x" });
    queries.getPollaMatches.mockResolvedValue([{ id: MATCH, scheduled_at: new Date(Date.now() + 60_000).toISOString(), status: "scheduled", voided_at: null, final_verified_at: null }]);
    const soon = await saveCasaPicks(matches, "user-1", [{ matchId: MATCH, pick1x2: "L" }], db as never);
    expect(soon).toMatchObject({ ok: false, status: 400 });
    const foreign = await saveCasaPicks(matches, "user-1", [{ matchId: "44444444-4444-4444-8444-444444444444", pick1x2: "L" }], db as never);
    expect(foreign).toEqual({ ok: false, status: 400, error: "Un partido no pertenece a esta polla." });
    expect(db.upsert).not.toHaveBeenCalled();
  });
});

// ── enrutamiento ─────────────────────────────────────────────────────────
type RpcAnswer = { data: unknown; error?: unknown };

/** Admin falso: RPC por nombre, perfil y estado del chat. */
function fakeAdmin(rpcAnswers: Record<string, RpcAnswer>, opts: { profile?: Record<string, unknown> | null; existingUserId?: string | null } = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "find_auth_user_id_by_phone" && !(fn in rpcAnswers)) return { data: opts.existingUserId ?? null, error: null };
    const answer = rpcAnswers[fn];
    if (!answer) throw new Error(`rpc inesperada: ${fn}`);
    return { data: answer.data, error: answer.error ?? null };
  });
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: table === "users" ? (opts.profile ?? null) : null, error: null }),
      upsert: (value: unknown) => { writes.push({ table, op: "upsert", value }); return Promise.resolve({ error: null }); },
      update: (value: unknown) => { writes.push({ table, op: "update", value }); return { eq: () => Promise.resolve({ error: null }) }; },
    };
    return chain;
  });
  const auth = { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null }) } };
  const client = { rpc, from, auth, writes };
  adminFactory.createAdminClient.mockReturnValue(client);
  return client;
}

function fakeBot() {
  const send = vi.fn().mockResolvedValue(true);
  const call = vi.fn(async (method: string, body: Record<string, unknown>) => {
    send(method, body);
    return { ok: true as const, result: { message_id: 99 } };
  });
  return { send, call, download: vi.fn() };
}

const sentBodies = (bot: ReturnType<typeof fakeBot>) => bot.send.mock.calls.filter((c) => c[0] === "sendMessage" || c[0] === "editMessageText").map((c) => c[1]);

describe("handleTelegramUpdate — who answers what", () => {
  const env = { NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com" };

  it("a button from a Telegram account without La Polla asks for the number: introduction first, the share button stuck to the last message", async () => {
    const db = fakeAdmin({ telegram_login_linked_accounts: { data: [] } });
    const bot = fakeBot();
    const outcome = await handleTelegramUpdate(callback(`p:${shortId(POLLA)}`), { config: CONFIG, db: db as never, bot: bot as never, env });
    expect(outcome).toBe("prompted");
    expect(bot.send).toHaveBeenCalledWith("answerCallbackQuery", { callback_query_id: "cb-1" });
    const bodies = sentBodies(bot);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].text).toContain("Bienvenido a La Polla Colombiana");
    expect((bodies[0].reply_markup as { keyboard: Array<Array<{ request_contact?: boolean }>> }).keyboard[0][0].request_contact).toBe(true);
    expect(bodies[1].text).toContain("justo debajo de este mensaje");
    expect(bodies[1].reply_markup).toEqual({
      inline_keyboard: [[{ text: "Compartir mi número", web_app: { url: "https://lapollacolombiana.com/telegram/numero.html" } }]],
    });
    // Solo lecturas de vínculo (la del bot y la del flujo de login): ninguna
    // cuenta, solicitud ni enlace se toca por un botón sin cuenta.
    expect(new Set(db.rpc.mock.calls.map((c) => c[0]))).toEqual(new Set(["telegram_login_linked_accounts"]));
  });

  it("/start <nonce> from the web still goes to the single-use login link flow", async () => {
    const nonce = generateNonce();
    const db = fakeAdmin({
      telegram_login_request_find: { data: [{ request_id: "req-1", status: "expired", locale: "es" }] },
      telegram_login_linked_accounts: { data: [{ user_id: "account-1", phone_e164: PHONE }] },
      telegram_login_link_issue: { data: [{ status: "ok" }] },
    });
    const bot = fakeBot();
    expect(await handleTelegramUpdate(privateMessage({ text: `/start ${nonce}` }), { config: CONFIG, db: db as never, bot: bot as never, env })).toBe("link_sent");
    expect(db.rpc).toHaveBeenCalledWith("telegram_login_request_find", { p_nonce_hash: sha256Hex(nonce) });
    expect(JSON.stringify(sentBodies(bot))).toContain("/login/telegram?t=");
  });

  it("own contact without a browser request: links the account, removes the keyboard, asks for the name and sends NO loose link", async () => {
    const db = fakeAdmin({
      telegram_login_identity_status: { data: "new" },
      telegram_login_authorize: { data: true },
    }, { profile: { display_name: "573001234567", avatar_url: null } });
    const bot = fakeBot();
    const outcome = await handleTelegramUpdate(privateMessage({ contact: { phone_number: "573001234567", user_id: TG } }), { config: CONFIG, db: db as never, bot: bot as never, env });
    expect(outcome).toBe("linked");
    expect(db.rpc).toHaveBeenCalledWith("telegram_login_authorize", { p_user_id: "new-user-id", p_telegram_user_id: TG, p_allow_first_link: true });
    expect(db.rpc.mock.calls.map((c) => c[0])).not.toContain("telegram_login_link_issue");
    const bodies = sentBodies(bot);
    expect(bodies[0].reply_markup).toEqual({ remove_keyboard: true });
    expect(bodies.some((b) => String(b.text).includes("Paso 1 de 2"))).toBe(true);
    expect(JSON.stringify(bodies)).not.toContain("/login/telegram?t=");
    expect(db.writes).toContainEqual({ table: "users", op: "update", value: { whatsapp_number: "573001234567", whatsapp_verified: true } });
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "telegram_login_chats", op: "upsert", value: expect.objectContaining({ bot_flow: "name", bot_flow_data: { onb: true } }) }));
  });

  it("a linked account without a real name cannot predict: the button asks for the name and writes no pick", async () => {
    const db = fakeAdmin({ telegram_login_linked_accounts: { data: [{ user_id: "account-1", phone_e164: PHONE }] } }, { profile: { display_name: null, avatar_url: null } });
    const bot = fakeBot();
    await handleTelegramUpdate(callback(`x:${shortId(POLLA)}:${shortId(MATCH)}:L`), { config: CONFIG, db: db as never, bot: bot as never, env });
    expect(sentBodies(bot).some((b) => String(b.text).includes("Paso 1 de 2"))).toBe(true);
    expect(db.writes.some((w) => w.table === "casa_picks")).toBe(false);
    expect(queries.getMyEntry).not.toHaveBeenCalled();
  });

  it("tapping an unrelated button abandons a pending text step, so later text is never saved as an answer", async () => {
    const db = fakeAdmin({ telegram_login_linked_accounts: { data: [{ user_id: "account-1", phone_e164: PHONE }] } }, { profile: { display_name: "Ana", avatar_url: "millos" } });
    const chatRow = { locale: "es", bot_flow: "answer", bot_flow_data: { p: POLLA, q: MATCH }, bot_flow_at: new Date().toISOString() };
    const baseFrom = db.from.getMockImplementation()!;
    db.from.mockImplementation((table: string) => {
      const chain = baseFrom(table) as Record<string, unknown>;
      if (table === "telegram_login_chats") chain.maybeSingle = () => Promise.resolve({ data: chatRow, error: null });
      return chain as never;
    });
    const bot = fakeBot();
    // «Ayuda» no pertenece al paso «respuesta».
    await handleTelegramUpdate(callback("hp"), { config: CONFIG, db: db as never, bot: bot as never, env });
    expect(db.writes).toContainEqual({ table: "telegram_login_chats", op: "update", value: expect.objectContaining({ bot_flow: null, bot_flow_data: null }) });
  });

  it("an expired step is wiped from the row on the next read (no half-typed data stays stored)", async () => {
    const db = fakeAdmin({ telegram_login_linked_accounts: { data: [{ user_id: "account-1", phone_e164: PHONE }] } }, { profile: { display_name: "Ana", avatar_url: "millos" } });
    const chatRow = { locale: "es", bot_flow: "pay_account", bot_flow_data: { m: "bancolombia", t: "ahorros", n: "Ana Titular" }, bot_flow_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    const baseFrom = db.from.getMockImplementation()!;
    db.from.mockImplementation((table: string) => {
      const chain = baseFrom(table) as Record<string, unknown>;
      if (table === "telegram_login_chats") chain.maybeSingle = () => Promise.resolve({ data: chatRow, error: null });
      return chain as never;
    });
    const bot = fakeBot();
    await handleTelegramUpdate(privateMessage({ text: "12345678" }), { config: CONFIG, db: db as never, bot: bot as never, env });
    expect(db.writes).toContainEqual({ table: "telegram_login_chats", op: "update", value: { bot_flow: null, bot_flow_data: null, bot_flow_at: null } });
    // El número escrito no llega a users: el paso ya había vencido.
    expect(db.writes.some((w) => w.table === "users" && JSON.stringify(w.value).includes("12345678"))).toBe(false);
  });

  it("group messages are ignored without reading the database", async () => {
    const db = fakeAdmin({});
    const bot = fakeBot();
    const group = privateMessage({ text: "/start" });
    (group.message.chat as Record<string, unknown>).type = "supergroup";
    expect(await handleTelegramUpdate(group, { config: CONFIG, db: db as never, bot: bot as never, env })).toBe("ignored");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(bot.send).not.toHaveBeenCalled();
  });
});

// ── ya inscrito: nunca ofrecer inscribirse otra vez ─────────────────────
describe("polla detail — the join button depends on the person's entry", () => {
  const polla = {
    id: POLLA, slug: "fecha-8", name: "Fecha 8", kind: "partidos", tournament: null, scoring_mode: "1x2", description: null,
    entry_price_cop: 20000, house_cut_pct: 30, prize_kind: "pozo", pot_mode: "proporcional", fixed_prize_cop: null,
    publication_mode: "ahora", prize_object: null, prize_image_path: null, points_exact: 3, points_one_team: 1, points_result: 3,
    status: "abierta", opens_at: "2000-01-01T00:00:00Z", closes_at: "2999-01-01T00:00:00Z", close_mode: "manual",
    ticket_count: null, draw_method: null, drawn_number: null, settled_at: null, settle_notes: null, settlement_outcome: null,
    payout_method: "nequi", payout_account: "3000000000", payout_account_name: null, created_by: "admin", created_at: "2026-09-01T00:00:00Z",
  } as const;
  const ctx = { account: { userId: "user-1", phoneE164: PHONE }, env: {}, db: {} } as never;
  const labels = async (entry: unknown, overrides: Record<string, unknown> = {}) => {
    queries.getPot.mockResolvedValue({ paid_entries: 3, gross_cop: 60000, prize_cop: 42000, house_cop: 18000 });
    queries.getPayouts.mockResolvedValue([]);
    queries.getMyEntry.mockResolvedValue(entry);
    const screen = await pollaDetailScreen(ctx, { ...polla, ...overrides } as never);
    return { buttons: (screen.buttons ?? []).flat().map((b) => b.text), text: screen.text };
  };

  it("not inscribed and open: offers to join", async () => {
    const r = await labels(null);
    expect(r.buttons).toContain("✅ Inscribirme · $20.000");
    expect(r.buttons.some((b) => b.includes("Pronosticar"))).toBe(false);
  });

  it("proof in review: no join button, says it is in review and lets them predict", async () => {
    const r = await labels({ id: "e1", status: "pendiente", proof_path: "casa/x.jpg", reject_reason: null });
    expect(r.buttons.some((b) => /Inscribirme|Enviar comprobante/.test(b))).toBe(false);
    expect(r.buttons).toContain("⚽ Pronosticar");
    expect(r.text).toContain("Tu comprobante está en revisión");
  });

  it("paid: no join button, confirmed", async () => {
    const r = await labels({ id: "e1", status: "pagada", proof_path: "casa/x.jpg", reject_reason: null });
    expect(r.buttons.some((b) => /Inscribirme|Enviar comprobante/.test(b))).toBe(false);
    expect(r.text).toContain("Estás inscrito");
  });

  it("rejected or unfinished upload: resend the proof (same entry), never a new inscription", async () => {
    for (const entry of [
      { id: "e1", status: "rechazada", proof_path: null, reject_reason: "Valor distinto" },
      { id: "e1", status: "anulada", proof_path: null, reject_reason: null },
      { id: "e1", status: "pendiente", proof_path: null, reject_reason: null },
    ]) {
      const r = await labels(entry);
      expect(r.buttons).toContain("📸 Enviar comprobante");
      expect(r.buttons.some((b) => b.includes("Inscribirme"))).toBe(false);
    }
  });

  it("closed: no join or resend button at all", async () => {
    const r = await labels(null, { status: "cerrada" });
    expect(r.buttons.some((b) => /Inscribirme|Enviar comprobante/.test(b))).toBe(false);
  });

  it("explains why someone cannot predict yet, by entry state", () => {
    expect(cannotPickReason(null, "pronosticar")).toContain("inscribirte");
    expect(cannotPickReason({ status: "rechazada", proof_path: null }, "pronosticar")).toContain("rechazado");
    expect(cannotPickReason({ status: "anulada", proof_path: null }, "responder")).toContain("no repitas el pago");
  });
});

describe("double tap guard", () => {
  it("drops a tap that lands on a screen edited in the last second, keeps normal taps", () => {
    const now = 1_757_950_000_500;
    const nowS = Math.floor(now / 1000);
    expect(isDoubleTap(nowS, now)).toBe(true);
    expect(isDoubleTap(nowS - 1, now)).toBe(true);
    expect(isDoubleTap(nowS - 2, now)).toBe(false);
    expect(isDoubleTap(null, now)).toBe(false);
  });

  it("a double-tapped button answers with a hint and changes nothing", async () => {
    const db = fakeAdmin({});
    const bot = fakeBot();
    const now = 1_757_950_000_500;
    const tap = callback(`x:${shortId(POLLA)}:${shortId(MATCH)}:L`);
    (tap.callback_query.message as Record<string, unknown>).edit_date = Math.floor(now / 1000);
    expect(await handleTelegramUpdate(tap, { config: CONFIG, db: db as never, bot: bot as never, now: () => now })).toBe("ignored");
    expect(bot.send).toHaveBeenCalledWith("answerCallbackQuery", { callback_query_id: "cb-1", text: "La pantalla acaba de cambiar. Revisa las opciones y toca otra vez." });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
});

describe("Mis pagos: cupos de regalo por invitar (migración 135)", () => {
  const compra = { status: "pagada", proof_path: "x", reject_reason: null, origin: "compra" as const };

  it("un regalo activo no es un pago y uno en pausa no aparece", () => {
    expect(paymentLine({ ...compra, origin: "invitacion", proof_path: null })).toEqual({ state: "🎁 regalo por invitar", actionable: false });
    expect(paymentLine({ ...compra, origin: "invitacion", proof_path: null, status: "anulada" })).toBeNull();
  });

  it("los cupos comprados conservan sus estados", () => {
    expect(paymentLine(compra)).toEqual({ state: "✅ confirmado", actionable: false });
    expect(paymentLine({ ...compra, status: "pendiente" })).toEqual({ state: "⏳ en revisión", actionable: false });
    expect(paymentLine({ ...compra, status: "rechazada", reject_reason: "<b>" })).toEqual({ state: "❌ rechazado: &lt;b&gt;", actionable: true });
    expect(paymentLine({ ...compra, status: "anulada", proof_path: null })).toEqual({ state: "⚠️ falta el comprobante", actionable: true });
    expect(paymentLine({ ...compra, origin: null, status: "anulada", proof_path: null })?.actionable).toBe(true);
  });

  it("la consulta deja fuera los regalos en pausa antes del límite de 15", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ["select", "eq", "or", "is", "in", "order"]) {
      chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
    }
    const polla = { name: "OFIGOLAZO", status: "abierta", kind: "partidos", archived_at: null };
    chain.limit = () => Promise.resolve({ data: [
      { id: "e1", polla_id: POLLA, status: "pendiente", proof_path: "p", reject_reason: null, ticket_number: null, entry_number: 1, origin: "compra", created_at: "2026-09-17T00:00:00Z", casa_pollas: polla },
      { id: "e2", polla_id: POLLA, status: "pagada", proof_path: null, reject_reason: null, ticket_number: null, entry_number: 2, origin: "invitacion", created_at: "2026-09-17T00:00:00Z", casa_pollas: polla },
    ], error: null });
    const send = vi.fn().mockResolvedValue(undefined);
    await showPayments({ db: { from: () => chain }, bot: { send }, account: { userId: "u1" }, chatId: TG, editMessageId: null, env: {} } as never);
    expect(calls).toContainEqual(["or", ["origin.eq.compra,status.eq.pagada"]]);
    const text = (send.mock.calls[0][1] as { text: string }).text;
    expect(text).toContain("⏳ en revisión");
    expect(text).toContain("🎁 regalo por invitar");
    expect(text).not.toContain("falta el comprobante");
  });
});
