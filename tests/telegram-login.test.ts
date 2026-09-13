import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminFactory = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminFactory);
// Cliente de Supabase con las cookies del request (el que abre la sesión).
const serverFactory = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => serverFactory);
vi.mock("@/lib/auth/login-event", () => ({ recordLoginEvent: vi.fn().mockResolvedValue(undefined) }));

import { toE164 } from "@/lib/auth/phone";
import { classifyLoginUpdate } from "@/lib/auth/telegram-login/update";
import {
  generateLinkToken,
  generateLoginCode,
  hashLinkToken,
  hashLoginCode,
  LINK_TOKEN_RE,
  secretHeaderMatches,
} from "@/lib/auth/telegram-login/crypto";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { telegramLoginDeepLink } from "@/lib/auth/telegram-login/deep-link";
import { loginLinkOrigin, localeForHost } from "@/lib/auth/telegram-login/links";
import { maskPhone } from "@/lib/auth/telegram-login/messages";
import { handleLoginUpdate } from "@/lib/auth/telegram-login/handler";
import { consumeLoginCode, consumeLoginLink, peekLoginLink } from "@/lib/auth/telegram-login/consume";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { POST as webhookPOST } from "@/app/api/telegram/login/route";
import { POST as verifyPOST } from "@/app/api/auth/telegram-verify/route";
import {
  GET as linkGET,
  HEAD as linkHEAD,
  POST as linkPOST,
} from "@/app/api/auth/telegram-link/route";
import { canIssueFor, telegramSessionAuthorizer } from "@/lib/auth/telegram-login/identity";
import { startSessionForVerifiedPhone } from "@/lib/auth/phone-session";

const BOT_TOKEN = "123456789:AAFakeTokenForUnitTestsOnly_abcdefghijk";
const SECRET = "unit-test-webhook-secret-0123456789abcdef";
const CONFIG = {
  botToken: BOT_TOKEN,
  webhookSecret: SECRET,
  botUsername: "LaPollaLoginBot",
  allowExistingAccounts: false,
};
const ENV_KEYS = [
  "TELEGRAM_LOGIN_BOT_TOKEN",
  "TELEGRAM_LOGIN_WEBHOOK_SECRET",
  "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME",
  "TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS",
] as const;

function setLoginEnv(on: boolean) {
  if (on) {
    process.env.TELEGRAM_LOGIN_BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "LaPollaLoginBot";
  } else {
    for (const k of ENV_KEYS) delete process.env[k];
  }
}

function privateMessage(extra: Record<string, unknown>, userId = 5550001) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_700_000_000,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Ana" },
      ...extra,
    },
  };
}

beforeEach(() => {
  adminFactory.createAdminClient.mockReset();
  serverFactory.createClient.mockReset();
  setLoginEnv(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLoginEnv(false);
});

describe("phone normalization (same utility as the web login)", () => {
  it("accepts Telegram formats with or without + and returns E.164", () => {
    expect(toE164("573001234567")).toBe("+573001234567");
    expect(toE164("+57 300-123-4567")).toBe("+573001234567");
    expect(toE164("(1) 415 555 0100")).toBe("+14155550100");
  });
  it("rejects values that cannot be a phone", () => {
    for (const bad of ["", "12345", "0573001234567", "57300123456789012", "abc", null, undefined]) {
      expect(toE164(bad as string)).toBeNull();
    }
  });
});

describe("classifyLoginUpdate — proof of phone ownership", () => {
  it("accepts the account's own contact in a private chat", () => {
    const action = classifyLoginUpdate(
      privateMessage({ contact: { phone_number: "573001234567", first_name: "Ana", user_id: 5550001 } }),
    );
    expect(action).toEqual({
      kind: "own_contact",
      chatId: 5550001,
      telegramUserId: 5550001,
      phoneE164: "+573001234567",
    });
  });

  it("rejects someone else's contact", () => {
    const action = classifyLoginUpdate(
      privateMessage({ contact: { phone_number: "573009999999", first_name: "Otro", user_id: 7770001 } }),
    );
    expect(action.kind).toBe("foreign_contact");
  });

  it("rejects a contact without user_id (typed/phonebook contact)", () => {
    const action = classifyLoginUpdate(
      privateMessage({ contact: { phone_number: "573001234567", first_name: "Ana" } }),
    );
    expect(action.kind).toBe("foreign_contact");
  });

  it.each([
    { forward_origin: { type: "user", date: 1 } },
    { forward_from: { id: 5550001 } },
    { forward_date: 1_700_000_000 },
    { forward_sender_name: "Ana" },
  ])("rejects a forwarded contact even if it matches the sender: %o", (fwd) => {
    const action = classifyLoginUpdate(
      privateMessage({ ...fwd, contact: { phone_number: "573001234567", user_id: 5550001 } }),
    );
    expect(action.kind).toBe("foreign_contact");
  });

  it("never accepts a typed number as proof", () => {
    const action = classifyLoginUpdate(privateMessage({ text: "+57 300 123 4567" }));
    expect(action.kind).toBe("prompt");
  });

  it("ignores groups, channels, bots and mismatched chat ids", () => {
    const group = privateMessage({ contact: { phone_number: "573001234567", user_id: 5550001 } });
    (group.message.chat as Record<string, unknown>).type = "group";
    expect(classifyLoginUpdate(group).kind).toBe("ignore");

    const bot = privateMessage({ text: "/start" });
    (bot.message.from as Record<string, unknown>).is_bot = true;
    expect(classifyLoginUpdate(bot).kind).toBe("ignore");

    const mismatch = privateMessage({ text: "/start" });
    (mismatch.message.chat as Record<string, unknown>).id = 42;
    expect(classifyLoginUpdate(mismatch).kind).toBe("ignore");

    expect(classifyLoginUpdate({ update_id: 1, edited_message: {} }).kind).toBe("ignore");
    expect(classifyLoginUpdate(null).kind).toBe("ignore");
  });

  it("flags an unreadable own number", () => {
    const action = classifyLoginUpdate(privateMessage({ contact: { phone_number: "12", user_id: 5550001 } }));
    expect(action.kind).toBe("invalid_phone");
  });

  it("reads the deep-link locale from /start", () => {
    expect(classifyLoginUpdate(privateMessage({ text: "/start login" }))).toMatchObject({ kind: "prompt", locale: "es" });
    expect(classifyLoginUpdate(privateMessage({ text: "/start login_en" }))).toMatchObject({ kind: "prompt", locale: "en" });
    expect(classifyLoginUpdate(privateMessage({ text: "/start" }))).not.toHaveProperty("locale");
    expect(classifyLoginUpdate(privateMessage({ text: "/login" }))).toMatchObject({ kind: "prompt" });
  });
});

describe("secrets", () => {
  it("generates 6-digit codes and 43-char base64url link tokens", () => {
    for (let i = 0; i < 200; i++) expect(generateLoginCode()).toMatch(/^\d{6}$/);
    const a = generateLinkToken();
    expect(a).toMatch(LINK_TOKEN_RE);
    expect(generateLinkToken()).not.toBe(a);
  });

  it("stores only peppered hashes bound to the phone", () => {
    const h = hashLoginCode(BOT_TOKEN, "+573001234567", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(hashLoginCode(BOT_TOKEN, "+573001234567", "123456")).toBe(h);
    expect(hashLoginCode(BOT_TOKEN, "+573001234568", "123456")).not.toBe(h);
    expect(hashLoginCode("987654321:AAAnotherBotTokenValue_abcdefghijklmn", "+573001234567", "123456")).not.toBe(h);
    expect(hashLinkToken(BOT_TOKEN, "x".repeat(43))).not.toBe(hashLinkToken(BOT_TOKEN, "y".repeat(43)));
  });

  it("compares the webhook secret header through fixed-length digests", () => {
    expect(secretHeaderMatches(SECRET, SECRET)).toBe(true);
    expect(secretHeaderMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretHeaderMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretHeaderMatches("", SECRET)).toBe(false);
    expect(secretHeaderMatches(null, SECRET)).toBe(false);
  });
});

describe("configuration", () => {
  it("is off when nothing or something is missing or malformed", () => {
    expect(getTelegramLoginConfig({})).toBeNull();
    expect(getTelegramLoginConfig({ TELEGRAM_LOGIN_BOT_TOKEN: BOT_TOKEN })).toBeNull();
    expect(
      getTelegramLoginConfig({
        TELEGRAM_LOGIN_BOT_TOKEN: BOT_TOKEN,
        TELEGRAM_LOGIN_WEBHOOK_SECRET: "short",
        NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME: "LaPollaLoginBot",
      }),
    ).toBeNull();
  });
  it("is on with the three variables and strips @ from the username", () => {
    expect(
      getTelegramLoginConfig({
        TELEGRAM_LOGIN_BOT_TOKEN: BOT_TOKEN,
        TELEGRAM_LOGIN_WEBHOOK_SECRET: SECRET,
        NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME: "@LaPollaLoginBot",
      }),
    ).toEqual(CONFIG);
  });
  it("keeps existing accounts SMS-only unless the owner opts in explicitly", () => {
    const base = {
      TELEGRAM_LOGIN_BOT_TOKEN: BOT_TOKEN,
      TELEGRAM_LOGIN_WEBHOOK_SECRET: SECRET,
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME: "LaPollaLoginBot",
    };
    expect(getTelegramLoginConfig(base)?.allowExistingAccounts).toBe(false);
    expect(getTelegramLoginConfig({ ...base, TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS: "1" })?.allowExistingAccounts).toBe(false);
    expect(getTelegramLoginConfig({ ...base, TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS: "true" })?.allowExistingAccounts).toBe(true);
  });
  it("builds the deep link with the locale payload", () => {
    expect(telegramLoginDeepLink("LaPollaLoginBot", "es")).toBe("https://t.me/LaPollaLoginBot?start=login");
    expect(telegramLoginDeepLink("LaPollaLoginBot", "en")).toBe("https://t.me/LaPollaLoginBot?start=login_en");
  });
});

describe("link host", () => {
  it("uses the canonical domain per locale in production", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com" };
    expect(loginLinkOrigin("es", env)).toBe("https://lapollacolombiana.com");
    expect(loginLinkOrigin("en", env)).toBe("https://chickenpicks.app");
    expect(loginLinkOrigin("es", {})).toBe("https://lapollacolombiana.com");
  });
  it("keeps local and preview environments on their own origin", () => {
    expect(loginLinkOrigin("en", { NEXT_PUBLIC_APP_URL: "http://localhost:3005" })).toBe("http://localhost:3005");
  });
  it("chooses the error page language by host and masks the phone", () => {
    expect(localeForHost("chickenpicks.app")).toBe("en");
    expect(localeForHost("lapollacolombiana.com")).toBe("es");
    expect(localeForHost(null)).toBe("es");
    expect(maskPhone("+573001234567")).toBe("+57 ••• ••• 4567");
  });
});

// ── handler with fake db + fake Telegram API ─────────────────────────────
function fakeDb(
  issueStatus: string | null,
  opts: { error?: boolean; locale?: "es" | "en"; identity?: string } = {},
) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "telegram_login_identity_status") return { data: opts.identity ?? "new", error: null };
    return opts.error
      ? { data: null, error: { code: "XX000", message: "boom" } }
      : { data: issueStatus, error: null };
  });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: opts.locale ? { locale: opts.locale } : null, error: null });
  const from = vi.fn(() => ({ upsert, select: () => ({ eq: () => ({ maybeSingle }) }) }));
  return { db: { rpc, from } as never, rpc, upsert, from };
}

describe("handleLoginUpdate", () => {
  const ownContact = privateMessage({ contact: { phone_number: "+573001234567", user_id: 5550001 } });
  const env = { NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com" };

  it("issues a code and a single-use link; the database only receives hashes", async () => {
    const { db, rpc } = fakeDb("ok");
    const send = vi.fn().mockResolvedValue(true);
    expect(await handleLoginUpdate(ownContact, { config: CONFIG, db, send, env })).toBe("issued");

    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["telegram_login_identity_status", "telegram_login_issue"]);
    const [fn, args] = rpc.mock.calls[1] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("telegram_login_issue");
    expect(args.p_phone_e164).toBe("+573001234567");
    expect(args.p_telegram_user_id).toBe(5550001);

    const [method, body] = send.mock.calls[0];
    expect(method).toBe("sendMessage");
    expect(body.protect_content).toBe(true);
    const code = /<code>(\d{6})<\/code>/.exec(body.text)?.[1];
    expect(code).toBeDefined();
    expect(args.p_code_hash).toBe(hashLoginCode(BOT_TOKEN, "+573001234567", code!));
    expect(JSON.stringify(args)).not.toContain(code!);

    const url = new URL(body.reply_markup.inline_keyboard[0][0].url);
    expect(url.origin).toBe("https://lapollacolombiana.com");
    expect(url.pathname).toBe("/api/auth/telegram-link");
    const token = url.searchParams.get("t")!;
    expect(token).toMatch(LINK_TOKEN_RE);
    expect(args.p_link_token_hash).toBe(hashLinkToken(BOT_TOKEN, token));
    expect(body.text).toContain("+57 ••• ••• 4567");
  });

  it("uses the English domain when the chat started with login_en", async () => {
    const { db } = fakeDb("ok", { locale: "en" });
    const send = vi.fn().mockResolvedValue(true);
    await handleLoginUpdate(ownContact, { config: CONFIG, db, send, env });
    const body = send.mock.calls[0][1];
    expect(new URL(body.reply_markup.inline_keyboard[0][0].url).origin).toBe("https://chickenpicks.app");
    expect(body.text).toContain("Chicken Picks");
  });

  it("does not send a code when rate limited or when the database fails", async () => {
    for (const [status, opts, outcome] of [
      ["rate_limited", {}, "rate_limited"],
      [null, { error: true }, "failed"],
    ] as const) {
      const { db } = fakeDb(status, opts);
      const send = vi.fn().mockResolvedValue(true);
      expect(await handleLoginUpdate(ownContact, { config: CONFIG, db, send, env })).toBe(outcome);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1].text).not.toMatch(/<code>\d{6}<\/code>/);
      expect(send.mock.calls[0][1].reply_markup.inline_keyboard).toBeUndefined();
    }
  });

  // Número reciclado: el dueño anterior conserva el número en Telegram y el
  // dueño nuevo ya creó su cuenta por SMS. Telegram no prueba quién tiene la SIM.
  it("does not issue a code for an existing account that is not linked to this Telegram account", async () => {
    for (const identity of ["unlinked", "linked_other"]) {
      const { db, rpc } = fakeDb("ok", { identity });
      const send = vi.fn().mockResolvedValue(true);
      expect(await handleLoginUpdate(ownContact, { config: CONFIG, db, send, env })).toBe("sms_only");
      expect(rpc.mock.calls.map((c) => c[0])).toEqual(["telegram_login_identity_status"]);
      const body = send.mock.calls[0][1];
      expect(body.text).toContain("SMS");
      expect(body.text).not.toMatch(/<code>\d{6}<\/code>/);
      expect(body.reply_markup.inline_keyboard).toBeUndefined();
    }
  });

  it("issues for new phones and linked accounts; unlinked accounts only when the owner opts in", async () => {
    expect(canIssueFor("new", CONFIG)).toBe(true);
    expect(canIssueFor("linked", CONFIG)).toBe(true);
    expect(canIssueFor("unlinked", CONFIG)).toBe(false);
    expect(canIssueFor("linked_other", CONFIG)).toBe(false);
    const allow = { ...CONFIG, allowExistingAccounts: true };
    expect(canIssueFor("unlinked", allow)).toBe(true);
    expect(canIssueFor("linked_other", allow)).toBe(false);

    const { db } = fakeDb("ok", { identity: "unlinked" });
    const send = vi.fn().mockResolvedValue(true);
    expect(await handleLoginUpdate(ownContact, { config: allow, db, send, env })).toBe("issued");
  });

  it("answers foreign contacts without touching the token table", async () => {
    const { db, rpc } = fakeDb("ok");
    const send = vi.fn().mockResolvedValue(true);
    const foreign = privateMessage({ contact: { phone_number: "573009999999", user_id: 999 } });
    expect(await handleLoginUpdate(foreign, { config: CONFIG, db, send, env })).toBe("foreign_contact");
    expect(rpc).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1].reply_markup.keyboard[0][0].request_contact).toBe(true);
  });

  it("offers the share-contact keyboard on /start and stores the deep-link locale", async () => {
    const { db, upsert, rpc } = fakeDb("ok");
    const send = vi.fn().mockResolvedValue(true);
    expect(
      await handleLoginUpdate(privateMessage({ text: "/start login_en" }), { config: CONFIG, db, send, env }),
    ).toBe("prompted");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ telegram_user_id: 5550001, locale: "en" }),
      { onConflict: "telegram_user_id" },
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1].reply_markup).toMatchObject({ one_time_keyboard: true });
    expect(send.mock.calls[0][1].reply_markup.keyboard[0][0]).toEqual({ text: "Share my number", request_contact: true });
  });
});

describe("consume helpers", () => {
  it("rejects malformed input without calling the database", async () => {
    const rpc = vi.fn();
    const db = { rpc } as never;
    expect(await consumeLoginCode(db, CONFIG, "+573001234567", "12a456")).toEqual({ status: "invalid" });
    expect(await consumeLoginLink(db, CONFIG, "short")).toEqual({ status: "invalid" });
    expect(await peekLoginLink(db, CONFIG, "short")).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps database answers and returns the Telegram account that requested the token", async () => {
    const token = generateLinkToken();
    const ok = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "ok", phone_e164: "+573001234567", telegram_user_id: 5550001 }], error: null }) };
    expect(await consumeLoginLink(ok as never, CONFIG, token)).toEqual({ status: "ok", phoneE164: "+573001234567", telegramUserId: 5550001 });
    expect(ok.rpc).toHaveBeenCalledWith("telegram_login_redeem_link", { p_link_token_hash: hashLinkToken(BOT_TOKEN, token) });
    const used = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "used", phone_e164: null, telegram_user_id: null }], error: null }) } as never;
    expect(await consumeLoginLink(used, CONFIG, token)).toEqual({ status: "used" });
    const code = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "ok", telegram_user_id: 5550001 }], error: null }) };
    expect(await consumeLoginCode(code as never, CONFIG, "+573001234567", "123456")).toEqual({ status: "ok", telegramUserId: 5550001 });
    expect(code.rpc).toHaveBeenCalledWith("telegram_login_redeem_code", {
      p_phone_e164: "+573001234567",
      p_code_hash: hashLoginCode(BOT_TOKEN, "+573001234567", "123456"),
    });
    // Un 'ok' sin cuenta de Telegram no abre nada.
    const noTg = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "ok", telegram_user_id: null }], error: null }) } as never;
    expect(await consumeLoginCode(noTg, CONFIG, "+573001234567", "123456")).toEqual({ status: "invalid" });
    const peek = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "ok", phone_e164: "+573001234567" }], error: null }) };
    expect(await peekLoginLink(peek as never, CONFIG, token)).toEqual({ status: "ok", phoneE164: "+573001234567" });
    expect(peek.rpc).toHaveBeenCalledWith("telegram_login_peek_link", { p_link_token_hash: hashLinkToken(BOT_TOKEN, token) });
  });
});

describe("rate limit — 5 code attempts / 15 min per phone", () => {
  it("blocks the sixth attempt and records attempts with their own type", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    let count = 4;
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue({ data: { attempted_at: new Date().toISOString() } }),
      then: (resolve: (v: unknown) => void) => resolve({ count }),
      insert,
    };
    adminFactory.createAdminClient.mockReturnValue({ from: vi.fn(() => chain) });

    const allowed = await checkAndRecordAttempt("573001234567", "telegram_verify", "1.2.3.4");
    expect(allowed.blocked).toBe(false);
    expect(insert).toHaveBeenCalledWith({ phone_number: "573001234567", attempt_type: "telegram_verify", ip_address: "1.2.3.4" });
    expect(chain.eq).toHaveBeenCalledWith("attempt_type", "telegram_verify");
    const since = new Date((chain.gte.mock.calls[0] as unknown as [string, string])[1]).getTime();
    expect(Math.round((Date.now() - since) / 60_000)).toBe(15);

    count = 5;
    insert.mockClear();
    expect((await checkAndRecordAttempt("573001234567", "telegram_verify")).blocked).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("same-origin guard", () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
  it("accepts same-origin and header-less requests", () => {
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", origin: "https://lapollacolombiana.com", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com" }))).toBe(true);
  });
  it("rejects cross-site requests", () => {
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", origin: "null" }))).toBe(false);
  });
  it("requires positive same-origin proof for form posts", () => {
    const strict = { requireProof: true };
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com" }), strict)).toBe(false);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", "sec-fetch-site": "same-origin" }), strict)).toBe(true);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", origin: "https://lapollacolombiana.com" }), strict)).toBe(true);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", "sec-fetch-site": "none" }), strict)).toBe(false);
  });
});

// ── routes ───────────────────────────────────────────────────────────────
function webhookRequest(headers: Record<string, string>, body: unknown = privateMessage({ text: "/start" })) {
  return new NextRequest("http://localhost/api/telegram/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("webhook route", () => {
  it("answers 503 without reading the body or touching the database when env is missing", async () => {
    const request = webhookRequest({ "x-telegram-bot-api-secret-token": SECRET });
    const json = vi.spyOn(request, "json");
    const res = await webhookPOST(request);
    expect(res.status).toBe(503);
    expect(json).not.toHaveBeenCalled();
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("answers 401 on a missing or wrong secret before reading the body", async () => {
    setLoginEnv(true);
    const variants: Record<string, string>[] = [{}, { "x-telegram-bot-api-secret-token": `${SECRET}-nope` }];
    for (const headers of variants) {
      const request = webhookRequest(headers);
      const json = vi.spyOn(request, "json");
      const res = await webhookPOST(request);
      expect(res.status).toBe(401);
      expect(json).not.toHaveBeenCalled();
    }
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("processes the update with the right secret and always answers 200", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn().mockResolvedValue(Response.json({ ok: true, result: {} }));
    vi.stubGlobal("fetch", fetchStub);
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    adminFactory.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
    });
    const res = await webhookPOST(webhookRequest({ "x-telegram-bot-api-secret-token": SECRET }));
    expect(res.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0][0])).toMatch(/^https:\/\/api\.telegram\.org\/bot.+\/sendMessage$/);
  });
});

describe("verify and link routes", () => {
  it("telegram-verify is unavailable without env and never touches the database", async () => {
    const res = await verifyPOST(
      new NextRequest("http://localhost/api/auth/telegram-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+573001234567", code: "123456" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("telegram-verify rejects cross-site and non-JSON requests before any database work", async () => {
    setLoginEnv(true);
    const cross = await verifyPOST(
      new NextRequest("http://localhost/api/auth/telegram-verify", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ phone: "+573001234567", code: "123456" }),
      }),
    );
    expect(cross.status).toBe(403);
    const form = await verifyPOST(
      new NextRequest("http://localhost/api/auth/telegram-verify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "phone=%2B573001234567&code=123456",
      }),
    );
    expect(form.status).toBe(415);
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("telegram-link HEAD never consumes and GET without env does not touch the database", async () => {
    const head = linkHEAD();
    expect(head.status).toBe(405);
    const res = await linkGET(new NextRequest(`http://localhost/api/auth/telegram-link?t=${"a".repeat(43)}`));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── sesión: fakes del cliente admin y del cliente con cookies ─────────────
type RpcAnswers = Record<string, { data: unknown; error?: unknown }>;

/** Consulta encadenable de PostgREST: cualquier método devuelve la misma cadena. */
function chainable(result: unknown) {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
        return () => chain;
      },
    },
  );
  return chain;
}

function fakeAdmin(rpcAnswers: RpcAnswers, opts: { existingUserId?: string | null } = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "find_auth_user_id_by_phone") return { data: opts.existingUserId ?? null, error: null };
    const answer = rpcAnswers[fn];
    if (!answer) throw new Error(`rpc inesperada: ${fn}`);
    return { data: answer.data, error: answer.error ?? null };
  });
  const auth = {
    admin: {
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null }),
      getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "573001234567@wa.lapolla.app" } }, error: null }),
      updateUserById: vi.fn().mockResolvedValue({ error: null }),
      generateLink: vi.fn().mockResolvedValue({ data: { properties: { email_otp: "999999" } }, error: null }),
    },
  };
  const from = vi.fn(() =>
    chainable({ data: { display_name: "Ana", avatar_url: "millos" }, count: 0, error: null }),
  );
  const client = { rpc, auth, from };
  adminFactory.createAdminClient.mockReturnValue(client);
  return client;
}

function fakeCookieClient() {
  const client = {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  };
  serverFactory.createClient.mockResolvedValue(client);
  return client;
}

describe("telegram-link: the GET only shows the number, a same-origin POST signs in", () => {
  const token = "Q".repeat(43);
  const url = `http://localhost/api/auth/telegram-link?t=${token}`;

  function formPost(headers: Record<string, string>, body = `t=${token}`) {
    return new NextRequest("http://localhost/api/auth/telegram-link", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded", ...headers },
      body,
    });
  }

  it("GET with a valid token does not redeem it nor touch the browser session", async () => {
    setLoginEnv(true);
    const admin = fakeAdmin({
      telegram_login_peek_link: { data: [{ status: "ok", phone_e164: "+573001234567" }] },
    });
    const cookies = fakeCookieClient();

    const res = await linkGET(new NextRequest(url, { headers: { host: "localhost" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain("+57 ••• ••• 4567");
    expect(html).not.toContain("3001234567");
    expect(html).toMatch(/<form method="post" action="\/api\/auth\/telegram-link">/);
    expect(html).toContain(`name="t" value="${token}"`);
    expect(html).not.toContain("sesión abierta");

    expect(admin.rpc.mock.calls.map((c) => c[0])).toEqual(["telegram_login_peek_link"]);
    expect(serverFactory.createClient).not.toHaveBeenCalled();
    expect(cookies.auth.signOut).not.toHaveBeenCalled();
  });

  it("GET warns when this browser already has a session that would be replaced", async () => {
    setLoginEnv(true);
    fakeAdmin({ telegram_login_peek_link: { data: [{ status: "ok", phone_e164: "+573001234567" }] } });
    const res = await linkGET(
      new NextRequest(url, { headers: { host: "localhost", cookie: "sb-127-auth-token.0=abc" } }),
    );
    expect(await res.text()).toContain("Este navegador ya tiene una sesión abierta");
  });

  it("GET reports used or expired links without redeeming", async () => {
    setLoginEnv(true);
    const admin = fakeAdmin({ telegram_login_peek_link: { data: [{ status: "used", phone_e164: null }] } });
    const res = await linkGET(new NextRequest(url, { headers: { host: "localhost" } }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("ya se usó");
    expect(admin.rpc.mock.calls.map((c) => c[0])).toEqual(["telegram_login_peek_link"]);
  });

  it("POST from another site, without origin proof or not as a form, never touches the database", async () => {
    setLoginEnv(true);
    const variants = [
      formPost({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
      formPost({ origin: "https://evil.example" }),
      formPost({}),
      formPost({ "sec-fetch-site": "same-origin", "content-type": "application/json" }, JSON.stringify({ t: token })),
    ];
    for (const request of variants) {
      const res = await linkPOST(request);
      expect(res.status).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
    expect(serverFactory.createClient).not.toHaveBeenCalled();
  });

  it("same-origin POST redeems once and opens the session of an account linked to that Telegram account", async () => {
    setLoginEnv(true);
    const admin = fakeAdmin(
      {
        telegram_login_redeem_link: { data: [{ status: "ok", phone_e164: "+573001234567", telegram_user_id: 5550001 }] },
        telegram_login_authorize: { data: true },
      },
      { existingUserId: "account-1" },
    );
    const cookies = fakeCookieClient();

    const res = await linkPOST(formPost({ "sec-fetch-site": "same-origin", origin: "http://localhost" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/casa");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(admin.rpc).toHaveBeenCalledWith("telegram_login_redeem_link", { p_link_token_hash: hashLinkToken(BOT_TOKEN, token) });
    expect(admin.rpc).toHaveBeenCalledWith("telegram_login_authorize", {
      p_user_id: "account-1",
      p_telegram_user_id: 5550001,
      p_allow_first_link: false,
    });
    expect(cookies.auth.verifyOtp).toHaveBeenCalledTimes(1);
  });
});

describe("recycled number: an existing account only accepts its linked Telegram account", () => {
  it("does not touch the account nor the browser session when the Telegram account is not authorized", async () => {
    const admin = fakeAdmin({ telegram_login_authorize: { data: false } }, { existingUserId: "sms-account" });
    const cookies = fakeCookieClient();
    const authorize = telegramSessionAuthorizer(admin as never, CONFIG, 7770001);

    const result = await startSessionForVerifiedPhone("+573001234567", "test", { authorize });
    expect(result).toEqual({ ok: false, stage: "denied" });
    expect(admin.rpc).toHaveBeenCalledWith("telegram_login_authorize", {
      p_user_id: "sms-account",
      p_telegram_user_id: 7770001,
      p_allow_first_link: false,
    });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(serverFactory.createClient).not.toHaveBeenCalled();
    expect(cookies.auth.signOut).not.toHaveBeenCalled();
    expect(cookies.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("links the Telegram account when Telegram creates the account, or when the owner allows existing accounts", async () => {
    const admin = fakeAdmin({ telegram_login_authorize: { data: true } }, { existingUserId: null });
    fakeCookieClient();
    const created = await startSessionForVerifiedPhone("+573001234567", "test", {
      authorize: telegramSessionAuthorizer(admin as never, CONFIG, 5550001),
    });
    expect(created).toMatchObject({ ok: true, userId: "new-user-id" });
    expect(admin.rpc).toHaveBeenCalledWith("telegram_login_authorize", {
      p_user_id: "new-user-id",
      p_telegram_user_id: 5550001,
      p_allow_first_link: true,
    });

    const existing = fakeAdmin({ telegram_login_authorize: { data: true } }, { existingUserId: "sms-account" });
    const authorize = telegramSessionAuthorizer(existing as never, { ...CONFIG, allowExistingAccounts: true }, 5550001);
    await authorize({ authUserId: "sms-account", created: false });
    expect(existing.rpc).toHaveBeenCalledWith("telegram_login_authorize", {
      p_user_id: "sms-account",
      p_telegram_user_id: 5550001,
      p_allow_first_link: true,
    });
  });

  it("telegram-verify answers 409 sms_only without cookies when a correct code comes from an unauthorized Telegram account", async () => {
    setLoginEnv(true);
    const admin = fakeAdmin(
      {
        telegram_login_redeem_code: { data: [{ status: "ok", telegram_user_id: 7770001 }] },
        telegram_login_authorize: { data: false },
      },
      { existingUserId: "sms-account" },
    );
    const cookies = fakeCookieClient();

    const res = await verifyPOST(
      new NextRequest("http://localhost/api/auth/telegram-verify", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ phone: "+573001234567", code: "123456" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "sms_only" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(cookies.auth.verifyOtp).not.toHaveBeenCalled();
  });
});
