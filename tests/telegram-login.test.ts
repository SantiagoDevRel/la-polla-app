import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminFactory = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminFactory);

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
import { consumeLoginCode, consumeLoginLink } from "@/lib/auth/telegram-login/consume";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { POST as webhookPOST } from "@/app/api/telegram/login/route";
import { POST as verifyPOST } from "@/app/api/auth/telegram-verify/route";
import { GET as linkGET, HEAD as linkHEAD } from "@/app/api/auth/telegram-link/route";

const BOT_TOKEN = "123456789:AAFakeTokenForUnitTestsOnly_abcdefghijk";
const SECRET = "unit-test-webhook-secret-0123456789abcdef";
const CONFIG = { botToken: BOT_TOKEN, webhookSecret: SECRET, botUsername: "LaPollaLoginBot" };
const ENV_KEYS = [
  "TELEGRAM_LOGIN_BOT_TOKEN",
  "TELEGRAM_LOGIN_WEBHOOK_SECRET",
  "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME",
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
function fakeDb(issueStatus: string | null, opts: { error?: boolean; locale?: "es" | "en" } = {}) {
  const rpc = vi.fn().mockResolvedValue(
    opts.error ? { data: null, error: { code: "XX000", message: "boom" } } : { data: issueStatus, error: null },
  );
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

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
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
    expect(await consumeLoginCode(db, CONFIG, "+573001234567", "12a456")).toBe("invalid");
    expect(await consumeLoginLink(db, CONFIG, "short")).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps database answers", async () => {
    const token = generateLinkToken();
    const ok = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "ok", phone_e164: "+573001234567" }], error: null }) } as never;
    expect(await consumeLoginLink(ok, CONFIG, token)).toEqual({ status: "ok", phoneE164: "+573001234567" });
    const used = { rpc: vi.fn().mockResolvedValue({ data: [{ status: "used", phone_e164: null }], error: null }) } as never;
    expect(await consumeLoginLink(used, CONFIG, token)).toEqual({ status: "used" });
    const code = { rpc: vi.fn().mockResolvedValue({ data: "ok", error: null }) };
    expect(await consumeLoginCode(code as never, CONFIG, "+573001234567", "123456")).toBe("ok");
    expect(code.rpc).toHaveBeenCalledWith("telegram_login_consume_code", {
      p_phone_e164: "+573001234567",
      p_code_hash: hashLoginCode(BOT_TOKEN, "+573001234567", "123456"),
    });
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
