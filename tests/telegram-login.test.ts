// tests/telegram-login.test.ts — Login por Telegram v2 (migración 119):
// solicitud atada al navegador, enlace de un solo uso desde el bot sin códigos.
// La sesión SOLO sale del enlace (nunca de la cookie del navegador que pidió:
// eso era phishing tipo device code). Base y API de Telegram falsas; la
// regresión SQL real está en scripts/telegram-login-v2-check.sql.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminFactory = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminFactory);
// El webhook ahora también es el bot de jugadores (lib/telegram-player), que
// importa módulos de Casa marcados server-only.
vi.mock("server-only", () => ({}));
// Cliente de Auth con las cookies del request y la IP real (el que abre la
// sesión). getClientIp se conserva real: las rutas la usan para la IP.
const authIpFactory = vi.hoisted(() => ({ createAuthRouteClient: vi.fn() }));
vi.mock("@/lib/supabase/auth-ip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth-ip")>()),
  createAuthRouteClient: authIpFactory.createAuthRouteClient,
}));
vi.mock("@/lib/auth/login-event", () => ({ recordLoginEvent: vi.fn().mockResolvedValue(undefined) }));

import { toE164 } from "@/lib/auth/phone";
import { classifyLoginUpdate } from "@/lib/auth/telegram-login/update";
import {
  BROWSER_SECRET_RE,
  generateBrowserSecret,
  generateLinkToken,
  generateNonce,
  hashLinkToken,
  LINK_TOKEN_RE,
  NONCE_RE,
  secretHeaderMatches,
  sha256Hex,
} from "@/lib/auth/telegram-login/crypto";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { telegramLoginDeepLink } from "@/lib/auth/telegram-login/deep-link";
import { loginLinkOrigin, loginLinkUrl, localeForHost } from "@/lib/auth/telegram-login/links";
import { loginBotCopy } from "@/lib/auth/telegram-login/messages";
import { maskPhone } from "@/lib/auth/telegram-login/mask-phone";
import { resetBotProfileStateForTests } from "@/lib/auth/telegram-login/bot-profile";
import { handleLoginUpdate, PROMPT_REPEAT_MS, sharePhonePageUrl } from "@/lib/auth/telegram-login/handler";
import * as requestsModule from "@/lib/auth/telegram-login/requests";
import {
  consumeLoginLink,
  linkedAccountFor,
  peekLoginLink,
  requesterLabel,
} from "@/lib/auth/telegram-login/requests";
import { resolveLinkPageView } from "@/lib/auth/telegram-login/link-page";
import {
  hasSessionCookie,
  readRequestBrowserHash,
  setRequestCookie,
  TG_REQUEST_COOKIE,
} from "@/lib/auth/telegram-login/request-cookie";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import {
  canIssueFor,
  linkTelegramAccountForContact,
  telegramGrantAuthorizer,
} from "@/lib/auth/telegram-login/identity";
import { startSessionForVerifiedPhone } from "@/lib/auth/phone-session";
import { POST as webhookPOST } from "@/app/api/telegram/login/route";
import { DELETE as requestDELETE, POST as requestPOST } from "@/app/api/auth/telegram/request/route";
import { GET as statusGET } from "@/app/api/auth/telegram/request/status/route";
import { POST as completePOST } from "@/app/api/auth/telegram/request/complete/route";
import { GET as linkGET, HEAD as linkHEAD, POST as linkPOST } from "@/app/api/auth/telegram/link/route";
import {
  GET as legacyLinkGET,
  HEAD as legacyLinkHEAD,
  POST as legacyLinkPOST,
} from "@/app/api/auth/telegram-link/route";
import { POST as legacyVerifyPOST } from "@/app/api/auth/telegram-verify/route";

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
const PHONE = "+573001234567";
const TG = 5550001;

function setLoginEnv(on: boolean) {
  if (on) {
    process.env.TELEGRAM_LOGIN_BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "LaPollaLoginBot";
  } else {
    for (const k of ENV_KEYS) delete process.env[k];
  }
}

function privateMessage(extra: Record<string, unknown>, userId = TG) {
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
  resetBotProfileStateForTests();
  adminFactory.createAdminClient.mockReset();
  authIpFactory.createAuthRouteClient.mockReset();
  setLoginEnv(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLoginEnv(false);
});

// ── fakes ────────────────────────────────────────────────────────────────
type RpcAnswer = { data: unknown; error?: unknown } | ((args: Record<string, unknown>) => { data: unknown; error?: unknown });
type RpcAnswers = Record<string, RpcAnswer>;

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

interface FakeOpts {
  existingUserId?: string | null;
  chat?: Record<string, unknown> | null;
}

/** Cliente admin falso: RPC por nombre, chats del bot y la API de Auth. */
function fakeAdmin(rpcAnswers: RpcAnswers, opts: FakeOpts = {}) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === "find_auth_user_id_by_phone" && !(fn in rpcAnswers)) {
      return { data: opts.existingUserId ?? null, error: null };
    }
    const answer = rpcAnswers[fn];
    if (!answer) throw new Error(`rpc inesperada: ${fn}`);
    const value = typeof answer === "function" ? answer(args) : answer;
    return { data: value.data, error: value.error ?? null };
  });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "telegram_login_chats") {
      return {
        upsert,
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.chat ?? null, error: null }) }) }),
      };
    }
    return chainable({ data: { display_name: "Ana", avatar_url: "millos" }, count: 0, error: null });
  });
  const auth = {
    admin: {
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null }),
      getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "573001234567@wa.lapolla.app" } }, error: null }),
      updateUserById: vi.fn().mockResolvedValue({ error: null }),
      generateLink: vi.fn().mockResolvedValue({ data: { properties: { email_otp: "999999" } }, error: null }),
    },
  };
  const client = { rpc, from, auth, upsert };
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
  authIpFactory.createAuthRouteClient.mockResolvedValue(client.auth);
  return client;
}

function rpcNames(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.map((c) => c[0]);
}

function rpcArgs(rpc: ReturnType<typeof vi.fn>, fn: string) {
  return rpc.mock.calls.find((c) => c[0] === fn)?.[1] as Record<string, unknown> | undefined;
}

const sentTexts = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map((c) => String(c[1].text));

// ── pure pieces ─────────────────────────────────────────────────────────
describe("phone normalization (same utility as the web login)", () => {
  it("accepts Telegram formats with or without + and returns E.164", () => {
    expect(toE164("573001234567")).toBe(PHONE);
    expect(toE164("+57 300-123-4567")).toBe(PHONE);
    expect(toE164("(1) 415 555 0100")).toBe("+14155550100");
  });
  it("rejects values that cannot be a phone", () => {
    for (const bad of ["", "12345", "0573001234567", "57300123456789012", "abc", null, undefined]) {
      expect(toE164(bad as string)).toBeNull();
    }
  });
});

describe("classifyLoginUpdate — proof of phone ownership and deep-link nonce", () => {
  it("accepts the account's own contact in a private chat", () => {
    const action = classifyLoginUpdate(
      privateMessage({ contact: { phone_number: "573001234567", first_name: "Ana", user_id: TG } }),
    );
    expect(action).toEqual({ kind: "own_contact", chatId: TG, telegramUserId: TG, phoneE164: PHONE });
  });

  it("rejects someone else's contact and contacts without user_id", () => {
    expect(
      classifyLoginUpdate(privateMessage({ contact: { phone_number: "573009999999", user_id: 7770001 } })).kind,
    ).toBe("foreign_contact");
    expect(classifyLoginUpdate(privateMessage({ contact: { phone_number: "573001234567" } })).kind).toBe(
      "foreign_contact",
    );
  });

  it.each([
    { forward_origin: { type: "user", date: 1 } },
    { forward_from: { id: TG } },
    { forward_date: 1_700_000_000 },
    { forward_sender_name: "Ana" },
  ])("rejects a forwarded contact even if it matches the sender: %o", (fwd) => {
    const action = classifyLoginUpdate(privateMessage({ ...fwd, contact: { phone_number: "573001234567", user_id: TG } }));
    expect(action.kind).toBe("foreign_contact");
  });

  it("never accepts a typed number as proof", () => {
    expect(classifyLoginUpdate(privateMessage({ text: "+57 300 123 4567" }))).toEqual({
      kind: "message",
      chatId: TG,
      telegramUserId: TG,
    });
  });

  it("ignores groups, bots and mismatched chat ids", () => {
    const group = privateMessage({ contact: { phone_number: "573001234567", user_id: TG } });
    (group.message.chat as Record<string, unknown>).type = "group";
    expect(classifyLoginUpdate(group).kind).toBe("ignore");
    const bot = privateMessage({ text: "/start" });
    (bot.message.from as Record<string, unknown>).is_bot = true;
    expect(classifyLoginUpdate(bot).kind).toBe("ignore");
    const mismatch = privateMessage({ text: "/start" });
    (mismatch.message.chat as Record<string, unknown>).id = 42;
    expect(classifyLoginUpdate(mismatch).kind).toBe("ignore");
    expect(classifyLoginUpdate({ update_id: 1, callback_query: {} }).kind).toBe("ignore");
    expect(classifyLoginUpdate(null).kind).toBe("ignore");
  });

  it("reads the nonce from /start exactly as sent (case sensitive)", () => {
    const nonce = generateNonce();
    expect(classifyLoginUpdate(privateMessage({ text: `/start ${nonce}` }))).toEqual({
      kind: "message",
      chatId: TG,
      telegramUserId: TG,
      nonce,
    });
    expect(classifyLoginUpdate(privateMessage({ text: `/start@LaPollaLoginBot ${nonce}` }))).toMatchObject({ nonce });
  });

  it("treats /start, /login, old payloads and junk payloads as a message without nonce", () => {
    for (const text of ["/start", "/login", "hola", `/start ${"a".repeat(42)}`, "/start <b>x</b>"]) {
      const action = classifyLoginUpdate(privateMessage({ text }));
      expect(action.kind).toBe("message");
      expect(action).not.toHaveProperty("nonce");
    }
    expect(classifyLoginUpdate(privateMessage({ text: "/start login_en" }))).toMatchObject({ locale: "en" });
    expect(classifyLoginUpdate(privateMessage({ text: "/start login" }))).toMatchObject({ locale: "es" });
  });
});

describe("secrets and deep link", () => {
  it("generates 43-char base64url nonces, browser secrets and link tokens that never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      for (const value of [generateNonce(), generateBrowserSecret(), generateLinkToken()]) {
        expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(seen.has(value)).toBe(false);
        seen.add(value);
      }
    }
    expect(NONCE_RE.test(generateNonce())).toBe(true);
    expect(BROWSER_SECRET_RE.test(generateBrowserSecret())).toBe(true);
    expect(LINK_TOKEN_RE.test(generateLinkToken())).toBe(true);
  });

  it("builds a Telegram deep link within the 64-character start limit", () => {
    const nonce = generateNonce();
    const link = telegramLoginDeepLink("LaPollaLoginBot", nonce);
    expect(link).toBe(`https://t.me/LaPollaLoginBot?start=${nonce}`);
    const start = new URL(link).searchParams.get("start")!;
    expect(start.length).toBeLessThanOrEqual(64);
    expect(start).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => telegramLoginDeepLink("LaPollaLoginBot", "login")).toThrow();
  });

  it("stores only hashes: sha256 for nonce/browser, peppered HMAC for links", () => {
    const nonce = generateNonce();
    expect(sha256Hex(nonce)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(nonce)).not.toContain(nonce);
    const token = generateLinkToken();
    expect(hashLinkToken(BOT_TOKEN, token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(BOT_TOKEN, token)).not.toBe(sha256Hex(token));
    expect(hashLinkToken("987654321:AAAnotherBotTokenValue_abcdefghijklmn", token)).not.toBe(hashLinkToken(BOT_TOKEN, token));
  });

  it("compares the webhook secret header through fixed-length digests", () => {
    expect(secretHeaderMatches(SECRET, SECRET)).toBe(true);
    expect(secretHeaderMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretHeaderMatches("", SECRET)).toBe(false);
    expect(secretHeaderMatches(null, SECRET)).toBe(false);
  });
});

describe("configuration and link host", () => {
  it("is off when something is missing or malformed", () => {
    expect(getTelegramLoginConfig({})).toBeNull();
    expect(getTelegramLoginConfig({ TELEGRAM_LOGIN_BOT_TOKEN: BOT_TOKEN })).toBeNull();
  });
  it("is on with the three variables and keeps existing accounts SMS-only unless opted in", () => {
    const base = {
      TELEGRAM_LOGIN_BOT_TOKEN: BOT_TOKEN,
      TELEGRAM_LOGIN_WEBHOOK_SECRET: SECRET,
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME: "@LaPollaLoginBot",
    };
    expect(getTelegramLoginConfig(base)).toEqual(CONFIG);
    expect(getTelegramLoginConfig({ ...base, TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS: "true" })?.allowExistingAccounts).toBe(true);
  });
  it("points single-use links to the /login/telegram page on the locale's domain", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com" };
    expect(loginLinkOrigin("en", env)).toBe("https://chickenpicks.app");
    expect(loginLinkUrl("es", "tok", env)).toBe("https://lapollacolombiana.com/login/telegram?t=tok");
    expect(loginLinkOrigin("en", { NEXT_PUBLIC_APP_URL: "http://localhost:3005" })).toBe("http://localhost:3005");
    expect(localeForHost("chickenpicks.app")).toBe("en");
    expect(localeForHost(null)).toBe("es");
    expect(maskPhone(PHONE)).toBe("+57 ••• ••• 4567");
  });
});

describe("browser request cookie", () => {
  it("is httpOnly, SameSite=Lax, host-only, readable by the link page and lasts 5 minutes", async () => {
    const { NextResponse } = await import("next/server");
    const secret = generateBrowserSecret();
    const dev = NextResponse.json({});
    setRequestCookie(dev, secret, { NODE_ENV: "development" });
    const header = dev.headers.get("set-cookie")!;
    expect(header).toContain(`${TG_REQUEST_COOKIE}=${secret}`);
    // /login/telegram tiene que verla para entrar sin confirmar en el mismo navegador.
    expect(header).toMatch(/Path=\/(;|$)/);
    expect(header).toMatch(/Max-Age=300/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).not.toMatch(/Secure/i);

    const prod = NextResponse.json({});
    setRequestCookie(prod, secret, { NODE_ENV: "production" });
    expect(prod.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("reads only well-formed secrets and hashes them", () => {
    const secret = generateBrowserSecret();
    const ok = new NextRequest("http://localhost/api/auth/telegram/request/status", {
      headers: { cookie: `${TG_REQUEST_COOKIE}=${secret}` },
    });
    expect(readRequestBrowserHash(ok)).toBe(sha256Hex(secret));
    const bad = new NextRequest("http://localhost/x", { headers: { cookie: `${TG_REQUEST_COOKIE}=short` } });
    expect(readRequestBrowserHash(bad)).toBeNull();
    expect(readRequestBrowserHash(new NextRequest("http://localhost/x"))).toBeNull();
  });

  it("detects a Supabase session cookie (plain or chunked) only by its name", () => {
    const jar = (names: string[]) => ({ getAll: () => names.map((name) => ({ name })) });
    expect(hasSessionCookie(jar(["sb-127-auth-token"]))).toBe(true);
    expect(hasSessionCookie(jar(["sb-sgmygyrvytzaushiqrst-auth-token.0"]))).toBe(true);
    expect(hasSessionCookie(jar([TG_REQUEST_COOKIE, "lp_onb"]))).toBe(false);
  });

  it("labels the request without IP or exact browser", () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
      "x-vercel-ip-city": "Bogot%C3%A1",
      "x-vercel-ip-country": "CO",
      "x-real-ip": "203.0.113.5",
    });
    expect(requesterLabel(headers, "es")).toBe("Windows en Bogotá, CO");
    expect(requesterLabel(headers, "en")).toBe("Windows in Bogotá, CO");
    expect(requesterLabel(new Headers(), "en")).toBe("an unknown device");
  });
});

describe("same-origin guard", () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
  it("rejects cross-site requests and requires positive proof when asked", () => {
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", origin: "https://evil.example" }))).toBe(false);
    const strict = { requireProof: true };
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com" }), strict)).toBe(false);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", "sec-fetch-site": "same-origin" }), strict)).toBe(true);
    expect(isSameOriginRequest(req({ host: "lapollacolombiana.com", origin: "https://lapollacolombiana.com" }), strict)).toBe(true);
  });
});

// ── bot handler ─────────────────────────────────────────────────────────
describe("handleLoginUpdate — linked Telegram account never shares its number again", () => {
  const env = { NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com" };
  const linkedRows = { data: [{ user_id: "account-1", phone_e164: PHONE }] };

  it("from /start <nonce> binds a 5-minute single-use link to the request and sends ONE message with ONE instruction", async () => {
    const nonce = generateNonce();
    const admin = fakeAdmin(
      {
        telegram_login_request_find: { data: [{ request_id: "req-1", status: "pending", telegram_user_id: null, locale: "es", requester_label: "Windows en Bogotá, CO" }] },
        telegram_login_linked_accounts: linkedRows,
        telegram_login_request_approve: { data: [{ status: "ok", expires_at: "2026-09-13T20:05:00Z", locale: "es", requester_label: "Windows en Bogotá, CO" }] },
      },
      { chat: { locale: "es", pending_request_id: null, contact_prompted_at: null, reply_keyboard_open: false } },
    );
    const send = vi.fn().mockResolvedValue(true);
    const outcome = await handleLoginUpdate(privateMessage({ text: `/start ${nonce}` }), {
      config: CONFIG, db: admin as never, send, env,
    });
    expect(outcome).toBe("approved");

    expect(rpcArgs(admin.rpc, "telegram_login_request_find")).toEqual({ p_nonce_hash: sha256Hex(nonce) });
    const approve = rpcArgs(admin.rpc, "telegram_login_request_approve")!;
    expect(approve).toMatchObject({ p_request_id: "req-1", p_telegram_user_id: TG, p_user_id: "account-1", p_phone_e164: PHONE });
    expect(rpcNames(admin.rpc)).not.toContain("telegram_login_identity_status");

    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0][1];
    // Una sola instrucción: el botón. Nada de «vuelve a la web, entrarás sola»
    // (esa pestaña no entra por la aprobación).
    expect(body.text).toBe("Toca el botón para entrar a La Polla. El enlace sirve una sola vez y vence en 5 minutos.");
    expect(body.text).not.toMatch(/automáticamente|Vuelve a La Polla/);
    expect(body.text).not.toMatch(/\b\d{6}\b/);
    expect(body.protect_content).toBe(true);
    expect(body.link_preview_options).toEqual({ is_disabled: true });
    const button = body.reply_markup.inline_keyboard[0][0];
    const url = new URL(button.url);
    expect(url.origin).toBe("https://lapollacolombiana.com");
    expect(url.pathname).toBe("/login/telegram");
    const token = url.searchParams.get("t")!;
    expect(token).toMatch(LINK_TOKEN_RE);
    expect(approve.p_link_token_hash).toBe(hashLinkToken(BOT_TOKEN, token));
    expect(JSON.stringify(send.mock.calls)).not.toContain("request_contact");
    expect(admin.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ telegram_user_id: TG, pending_request_id: null, reply_keyboard_open: false }),
      { onConflict: "telegram_user_id" },
    );
  });

  it("removes an old reply keyboard in a first message and sends the button in a second one", async () => {
    const nonce = generateNonce();
    const admin = fakeAdmin(
      {
        telegram_login_request_find: { data: [{ request_id: "req-1", status: "pending", locale: "es" }] },
        telegram_login_linked_accounts: linkedRows,
        telegram_login_request_approve: { data: [{ status: "ok", expires_at: "2026-09-13T20:05:00Z", locale: "es", requester_label: null }] },
      },
      { chat: { locale: "es", reply_keyboard_open: true } },
    );
    const send = vi.fn().mockResolvedValue(true);
    await handleLoginUpdate(privateMessage({ text: `/start ${nonce}` }), { config: CONFIG, db: admin as never, send, env });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1].reply_markup).toEqual({ remove_keyboard: true });
    expect(send.mock.calls[0][1].text).toBe("Tu cuenta de Telegram ya está confirmada para La Polla.");
    expect(send.mock.calls[1][1].reply_markup.inline_keyboard[0][0].text).toBe("Entrar a La Polla");
    expect(sentTexts(send).join("\n")).not.toMatch(/automáticamente|Vuelve a La Polla/);
  });

  it("without nonce sends only a single-use link", async () => {
    const admin = fakeAdmin(
      {
        telegram_login_linked_accounts: linkedRows,
        telegram_login_link_issue: { data: [{ status: "ok", expires_at: "2026-09-13T20:05:00Z" }] },
      },
      { chat: { locale: "es", reply_keyboard_open: false } },
    );
    const send = vi.fn().mockResolvedValue(true);
    expect(await handleLoginUpdate(privateMessage({ text: "/start" }), { config: CONFIG, db: admin as never, send, env })).toBe("link_sent");
    expect(rpcNames(admin.rpc)).toEqual(["telegram_login_linked_accounts", "telegram_login_link_issue"]);
    const body = send.mock.calls[0][1];
    expect(body.text).toBe("Toca el botón para entrar a La Polla. El enlace sirve una sola vez y vence en 5 minutos.");
    const token = new URL(body.reply_markup.inline_keyboard[0][0].url).searchParams.get("t")!;
    expect(rpcArgs(admin.rpc, "telegram_login_link_issue")).toMatchObject({
      p_telegram_user_id: TG,
      p_user_id: "account-1",
      p_phone_e164: PHONE,
      p_link_token_hash: hashLinkToken(BOT_TOKEN, token),
      p_locale: "es",
    });
  });

  it("an expired or foreign nonce still gets a link, with a clear note", async () => {
    const admin = fakeAdmin(
      {
        telegram_login_request_find: { data: [{ request_id: "req-1", status: "expired", locale: "en" }] },
        telegram_login_linked_accounts: linkedRows,
        telegram_login_link_issue: { data: [{ status: "ok" }] },
      },
      { chat: { locale: "es", reply_keyboard_open: false } },
    );
    const send = vi.fn().mockResolvedValue(true);
    await handleLoginUpdate(privateMessage({ text: `/start ${generateNonce()}` }), { config: CONFIG, db: admin as never, send, env });
    expect(rpcNames(admin.rpc)).not.toContain("telegram_login_request_approve");
    expect(send.mock.calls[0][1].text).toContain("already expired");
    expect(new URL(send.mock.calls[0][1].reply_markup.inline_keyboard[0][0].url).origin).toBe("https://chickenpicks.app");
  });

  it("answers rate limits without a link", async () => {
    const admin = fakeAdmin(
      {
        telegram_login_request_find: { data: [{ request_id: "req-1", status: "pending", locale: "es" }] },
        telegram_login_linked_accounts: linkedRows,
        telegram_login_request_approve: { data: [{ status: "rate_limited" }] },
      },
      { chat: { locale: "es", reply_keyboard_open: false } },
    );
    const send = vi.fn().mockResolvedValue(true);
    expect(await handleLoginUpdate(privateMessage({ text: `/start ${generateNonce()}` }), { config: CONFIG, db: admin as never, send, env })).toBe("rate_limited");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].reply_markup.inline_keyboard).toBeUndefined();
  });
});

describe("handleLoginUpdate — first time with Telegram asks for the number once", () => {
  const env = { NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com" };

  const SHARE_PAGE = "https://lapollacolombiana.com/telegram/numero.html";
  const CONTACT_KEYBOARD = {
    keyboard: [[{ text: "Compartir mi número", request_contact: true }]],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Toca Compartir mi número",
  };

  it("asks with a button stuck to the LAST message (mini app) plus the contact keyboard as backup, and remembers the pending request", async () => {
    const nonce = generateNonce();
    const admin = fakeAdmin({
      telegram_login_request_find: { data: [{ request_id: "req-9", status: "pending", locale: "es" }] },
      telegram_login_linked_accounts: { data: [] },
    });
    const send = vi.fn().mockResolvedValue(true);
    expect(await handleLoginUpdate(privateMessage({ text: `/start ${nonce}` }), { config: CONFIG, db: admin as never, send, env, now: () => 1_000_000 })).toBe("prompted");
    expect(send).toHaveBeenCalledTimes(2);
    const [first, second] = [send.mock.calls[0][1], send.mock.calls[1][1]];
    expect(first.reply_markup).toEqual(CONTACT_KEYBOARD);
    expect(first.text).toBe("Para entrar por primera vez con Telegram necesitamos confirmar tu número.");
    // «Toca Compartir mi número y no encuentro ningún botón» (15-sep): el botón
    // va pegado al último mensaje y abre la ventana nativa de Telegram.
    expect(second.reply_markup).toEqual({ inline_keyboard: [[{ text: "Compartir mi número", web_app: { url: SHARE_PAGE } }]] });
    expect(second.text).toContain("justo debajo de este mensaje");
    expect(rpcNames(admin.rpc)).not.toContain("telegram_login_request_approve");
    expect(admin.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ telegram_user_id: TG, pending_request_id: "req-9", reply_keyboard_open: true, contact_prompted_at: new Date(1_000_000).toISOString() }),
      { onConflict: "telegram_user_id" },
    );
  });

  it("without https (local development) keeps the single keyboard message: Telegram rejects web_app buttons without https", async () => {
    const admin = fakeAdmin({ telegram_login_linked_accounts: { data: [] } });
    const send = vi.fn().mockResolvedValue(true);
    const local = { NEXT_PUBLIC_APP_URL: "http://localhost:3006" };
    expect(sharePhonePageUrl("es", local)).toBeNull();
    expect(sharePhonePageUrl("en", env)).toBe("https://chickenpicks.app/telegram/numero.html?lang=en");
    await handleLoginUpdate(privateMessage({ text: "hola" }), { config: CONFIG, db: admin as never, send, env: local, now: () => 1_000_000 });
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0][1];
    expect(body.reply_markup).toEqual(CONTACT_KEYBOARD);
    expect(body.text).toContain("Para entrar por primera vez con Telegram necesitamos confirmar tu número.");
    // El control del teclado del bot se describe por forma y lugar (en Telegram
    // Web es un ícono de cuatro lóbulos junto a la carita), no como «teclado».
    expect(body.text).toContain("ícono de cuatro cuadritos");
    expect(body.text).toContain("junto a la carita");
    expect(body.text).not.toContain("ícono de teclado");
    expect(JSON.stringify(send.mock.calls)).not.toContain("web_app");
  });

  it("answers in Spanish even when the Telegram app is in English (owner's request)", async () => {
    const admin = fakeAdmin({ telegram_login_linked_accounts: { data: [] } });
    const send = vi.fn().mockResolvedValue(true);
    const english = privateMessage({ text: "/start", from: { id: TG, is_bot: false, first_name: "Ana", language_code: "en" } });
    await handleLoginUpdate(english, { config: CONFIG, db: admin as never, send, env, now: () => 1_000_000 });
    expect(send.mock.calls[0][1].text).toContain("necesitamos confirmar tu número");
    expect(send.mock.calls[1][1].reply_markup.inline_keyboard[0][0].web_app.url).toBe(SHARE_PAGE);
    expect(admin.upsert.mock.calls[0][0].locale).toBe("es");
  });

  it("does not repeat the long message within two minutes", async () => {
    const promptedAt = 5_000_000;
    const admin = fakeAdmin(
      { telegram_login_linked_accounts: { data: [] } },
      { chat: { locale: "es", pending_request_id: "req-9", contact_prompted_at: new Date(promptedAt).toISOString(), reply_keyboard_open: true } },
    );
    const send = vi.fn().mockResolvedValue(true);
    await handleLoginUpdate(privateMessage({ text: "hola" }), { config: CONFIG, db: admin as never, send, env, now: () => promptedAt + 30_000 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].text).toBe(
      "Toca el botón <b>Compartir mi número</b> que está justo debajo de este mensaje. Telegram te pide confirmar y listo.",
    );
    expect(send.mock.calls[0][1].reply_markup.inline_keyboard[0][0].web_app.url).toBe(SHARE_PAGE);
    expect(loginBotCopy("en").promptShort).toContain("four-squares icon next to the smiley face");
    // El texto suelto no pierde la solicitud pendiente.
    expect(admin.upsert.mock.calls[0][0].pending_request_id).toBe("req-9");

    send.mockClear();
    await handleLoginUpdate(privateMessage({ text: "hola" }), { config: CONFIG, db: admin as never, send, env, now: () => promptedAt + PROMPT_REPEAT_MS + 1 });
    expect(send.mock.calls[0][1].text).toContain("Para entrar por primera vez");
  });

  it("rejects someone else's contact without touching accounts or requests", async () => {
    const admin = fakeAdmin({});
    const send = vi.fn().mockResolvedValue(true);
    const foreign = privateMessage({ contact: { phone_number: "573009999999", user_id: 999 } });
    expect(await handleLoginUpdate(foreign, { config: CONFIG, db: admin as never, send, env })).toBe("foreign_contact");
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1].reply_markup.inline_keyboard[0][0].web_app.url).toBe(SHARE_PAGE);

    send.mockClear();
    await handleLoginUpdate(foreign, { config: CONFIG, db: admin as never, send, env: { NEXT_PUBLIC_APP_URL: "http://localhost:3006" } });
    expect(send.mock.calls[0][1].reply_markup.keyboard[0][0].request_contact).toBe(true);
    expect(send.mock.calls[0][1].reply_markup.is_persistent).toBe(true);
  });

  it("own contact of a new number: creates and links the account, binds the link to the pending request, removes the keyboard", async () => {
    const admin = fakeAdmin(
      {
        telegram_login_identity_status: { data: "new" },
        telegram_login_authorize: { data: true },
        telegram_login_request_approve: { data: [{ status: "ok", expires_at: "2026-09-13T20:05:00Z", locale: "es", requester_label: "iPhone" }] },
      },
      { existingUserId: null, chat: { locale: "es", pending_request_id: "req-9", reply_keyboard_open: true } },
    );
    const send = vi.fn().mockResolvedValue(true);
    const contact = privateMessage({ contact: { phone_number: "573001234567", user_id: TG } });
    expect(await handleLoginUpdate(contact, { config: CONFIG, db: admin as never, send, env })).toBe("approved");
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ phone: PHONE, phone_confirm: true }));
    expect(rpcArgs(admin.rpc, "telegram_login_authorize")).toEqual({ p_user_id: "new-user-id", p_telegram_user_id: TG, p_allow_first_link: true });
    expect(rpcArgs(admin.rpc, "telegram_login_request_approve")).toMatchObject({ p_request_id: "req-9", p_user_id: "new-user-id", p_phone_e164: PHONE });
    expect(send.mock.calls[0][1].reply_markup).toEqual({ remove_keyboard: true });
    expect(send.mock.calls[1][1].reply_markup.inline_keyboard[0][0].url).toContain("/login/telegram?t=");
    expect(send.mock.calls[1][1].text).toContain("vence en 5 minutos");
    expect(sentTexts(send).join("\n")).not.toMatch(/\b\d{6}\b/);
    expect(sentTexts(send).join("\n")).not.toMatch(/automáticamente/);
    // Sesión no se abre desde el webhook.
    expect(authIpFactory.createAuthRouteClient).not.toHaveBeenCalled();
  });

  it("own contact without a pending request: links and sends only the link", async () => {
    const admin = fakeAdmin(
      {
        telegram_login_identity_status: { data: "linked" },
        telegram_login_authorize: { data: true },
        telegram_login_link_issue: { data: [{ status: "ok" }] },
      },
      { existingUserId: "account-1", chat: { locale: "es", pending_request_id: null, reply_keyboard_open: true } },
    );
    const send = vi.fn().mockResolvedValue(true);
    const contact = privateMessage({ contact: { phone_number: "+573001234567", user_id: TG } });
    expect(await handleLoginUpdate(contact, { config: CONFIG, db: admin as never, send, env })).toBe("link_sent");
    expect(rpcArgs(admin.rpc, "telegram_login_authorize")).toEqual({ p_user_id: "account-1", p_telegram_user_id: TG, p_allow_first_link: false });
    expect(send.mock.calls[0][1].text).toContain("confirmamos tu número");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  // Número reciclado: el dueño anterior conserva el número en Telegram y el
  // dueño nuevo ya creó su cuenta por SMS. Telegram no prueba quién tiene la SIM.
  it("an existing account not linked to this Telegram account stays SMS-only and the waiting tab is cancelled", async () => {
    for (const identity of ["unlinked", "linked_other"]) {
      const admin = fakeAdmin(
        { telegram_login_identity_status: { data: identity }, telegram_login_request_cancel: { data: true } },
        { existingUserId: "sms-account", chat: { locale: "es", pending_request_id: "req-9", reply_keyboard_open: true } },
      );
      const send = vi.fn().mockResolvedValue(true);
      const contact = privateMessage({ contact: { phone_number: "573001234567", user_id: TG } });
      expect(await handleLoginUpdate(contact, { config: CONFIG, db: admin as never, send, env })).toBe("sms_only");
      expect(rpcArgs(admin.rpc, "telegram_login_request_cancel")).toEqual({ p_request_id: "req-9" });
      expect(rpcNames(admin.rpc)).not.toContain("telegram_login_authorize");
      expect(rpcNames(admin.rpc)).not.toContain("telegram_login_request_approve");
      expect(send.mock.calls[0][1].text).toContain("SMS");
      expect(send.mock.calls[0][1].reply_markup).toEqual({ remove_keyboard: true });
    }
    expect(canIssueFor("unlinked", { allowExistingAccounts: true })).toBe(true);
    expect(canIssueFor("linked_other", { allowExistingAccounts: true })).toBe(false);
  });

  it("links an existing SMS account only when the owner opts in", async () => {
    const admin = fakeAdmin({ telegram_login_authorize: { data: true } }, { existingUserId: "sms-account" });
    const result = await linkTelegramAccountForContact(admin as never, { allowExistingAccounts: true }, PHONE, TG);
    expect(result).toEqual({ status: "ok", grant: { userId: "sms-account", telegramUserId: TG, phoneE164: PHONE } });
    expect(rpcArgs(admin.rpc, "telegram_login_authorize")).toMatchObject({ p_allow_first_link: true });

    const denied = fakeAdmin({ telegram_login_authorize: { data: false } }, { existingUserId: "sms-account" });
    expect(await linkTelegramAccountForContact(denied as never, { allowExistingAccounts: false }, PHONE, TG)).toEqual({ status: "denied" });
  });
});

describe("request helpers", () => {
  it("rejects malformed tokens without calling the database", async () => {
    const rpc = vi.fn();
    expect(await consumeLoginLink({ rpc } as never, CONFIG, "short", null)).toEqual({ status: "invalid" });
    expect(await peekLoginLink({ rpc } as never, CONFIG, "short", null)).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("treats two linked accounts as ambiguous (the bot asks for the number)", async () => {
    const two = { rpc: vi.fn().mockResolvedValue({ data: [{ user_id: "a", phone_e164: PHONE }, { user_id: "b", phone_e164: "+573009999999" }], error: null }) };
    expect(await linkedAccountFor(two as never, TG)).toEqual({ kind: "ambiguous" });
    const noPhone = { rpc: vi.fn().mockResolvedValue({ data: [{ user_id: "a", phone_e164: null }], error: null }) };
    expect(await linkedAccountFor(noPhone as never, TG)).toEqual({ kind: "ambiguous" });
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
  it("answers 503 without reading the body when env is missing, 401 on a wrong secret", async () => {
    let request = webhookRequest({ "x-telegram-bot-api-secret-token": SECRET });
    let json = vi.spyOn(request, "json");
    expect((await webhookPOST(request)).status).toBe(503);
    expect(json).not.toHaveBeenCalled();

    setLoginEnv(true);
    request = webhookRequest({ "x-telegram-bot-api-secret-token": `${SECRET}-nope` });
    json = vi.spyOn(request, "json");
    expect((await webhookPOST(request)).status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("processes the update with the right secret and always answers 200", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn().mockResolvedValue(Response.json({ ok: true, result: {} }));
    vi.stubGlobal("fetch", fetchStub);
    fakeAdmin({ telegram_login_linked_accounts: { data: [] } });
    const res = await webhookPOST(webhookRequest({ "x-telegram-bot-api-secret-token": SECRET }));
    expect(res.status).toBe(200);
    // Además del mensaje, después de responder se sincroniza el perfil del bot
    // (tests/telegram-login-polish.test.ts): aquí solo cuenta el sendMessage.
    const sends = fetchStub.mock.calls.filter((c) => String(c[0]).endsWith("/sendMessage"));
    // Pedido del número: el teclado de respaldo y el botón de la mini app.
    expect(sends).toHaveLength(2);
    expect(String(sends[0][0])).toMatch(/^https:\/\/api\.telegram\.org\/bot.+\/sendMessage$/);
  });
});

const SAME_ORIGIN = { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" };

function apiRequest(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
}

describe("POST/DELETE /api/auth/telegram/request", () => {
  it("is unavailable without env and never touches the database", async () => {
    const res = await requestPOST(apiRequest("/api/auth/telegram/request", { method: "POST", headers: { ...SAME_ORIGIN, "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(404);
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects cross-site, proof-less and non-JSON requests before any database work", async () => {
    setLoginEnv(true);
    const variants: { headers: Record<string, string>; status: number }[] = [
      { headers: { host: "localhost", "content-type": "application/json", "sec-fetch-site": "cross-site" }, status: 403 },
      { headers: { host: "localhost", "content-type": "application/json" }, status: 403 },
      { headers: { ...SAME_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, status: 415 },
    ];
    for (const v of variants) {
      const res = await requestPOST(apiRequest("/api/auth/telegram/request", { method: "POST", headers: v.headers, body: "{}" }));
      expect(res.status).toBe(v.status);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("creates the request with hashes only, sets the browser cookie and returns the deep link", async () => {
    setLoginEnv(true);
    const admin = fakeAdmin({ telegram_login_request_create: { data: [{ status: "ok", expires_at: "2026-09-13T20:05:00Z" }] } });
    const res = await requestPOST(
      apiRequest("/api/auth/telegram/request", {
        method: "POST",
        headers: { ...SAME_ORIGIN, "content-type": "application/json", "x-real-ip": "203.0.113.5", "user-agent": "iPhone" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.expiresAt).toBe("2026-09-13T20:05:00Z");
    const nonce = new URL(body.deepLink).searchParams.get("start")!;
    expect(body.deepLink).toBe(`https://t.me/LaPollaLoginBot?start=${nonce}`);
    const secret = res.cookies.get(TG_REQUEST_COOKIE)!.value;
    expect(secret).toMatch(BROWSER_SECRET_RE);

    const args = rpcArgs(admin.rpc, "telegram_login_request_create")!;
    expect(args).toEqual({
      p_nonce_hash: sha256Hex(nonce),
      p_browser_hash: sha256Hex(secret),
      p_locale: "es",
      p_requester_ip: "203.0.113.5",
      p_requester_label: "iPhone",
    });
    expect(JSON.stringify(args)).not.toContain(nonce);
    expect(JSON.stringify(args)).not.toContain(secret);
  });

  it("answers 429 without a cookie when the IP is rate limited", async () => {
    setLoginEnv(true);
    fakeAdmin({ telegram_login_request_create: { data: [{ status: "rate_limited", expires_at: null }] } });
    const res = await requestPOST(apiRequest("/api/auth/telegram/request", { method: "POST", headers: { ...SAME_ORIGIN, "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("DELETE cancels this browser's request and clears the cookie", async () => {
    setLoginEnv(true);
    const secret = generateBrowserSecret();
    const admin = fakeAdmin({ telegram_login_request_cancel: { data: true } });
    const res = await requestDELETE(apiRequest("/api/auth/telegram/request", { method: "DELETE", headers: { ...SAME_ORIGIN, cookie: `${TG_REQUEST_COOKIE}=${secret}` } }));
    expect(res.status).toBe(200);
    expect(rpcArgs(admin.rpc, "telegram_login_request_cancel")).toEqual({ p_browser_hash: sha256Hex(secret) });
    expect(res.headers.get("set-cookie")).toMatch(/lp_tg_req=;.*Max-Age=0/);
  });
});

describe("GET /api/auth/telegram/request/status", () => {
  it("without a cookie answers invalid without touching the database", async () => {
    setLoginEnv(true);
    const res = await statusGET(apiRequest("/api/auth/telegram/request/status"));
    expect(await res.json()).toEqual({ status: "invalid", expiresAt: null });
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("looks up the hash of this browser's cookie and returns only the status", async () => {
    setLoginEnv(true);
    const secret = generateBrowserSecret();
    const admin = fakeAdmin({ telegram_login_request_status: { data: [{ status: "approved", expires_at: "2026-09-13T20:05:00Z" }] } });
    const res = await statusGET(apiRequest("/api/auth/telegram/request/status", { headers: { cookie: `${TG_REQUEST_COOKIE}=${secret}` } }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "approved", expiresAt: "2026-09-13T20:05:00Z" });
    expect(rpcArgs(admin.rpc, "telegram_login_request_status")).toEqual({ p_browser_hash: sha256Hex(secret) });
  });

  it("once consumed, tells the tab whether THIS browser has the session (link opened here) or not (opened elsewhere)", async () => {
    setLoginEnv(true);
    const secret = generateBrowserSecret();
    fakeAdmin({ telegram_login_request_status: { data: [{ status: "consumed", expires_at: "2026-09-13T20:05:00Z" }] } });
    const here = await statusGET(
      apiRequest("/api/auth/telegram/request/status", {
        headers: { cookie: `${TG_REQUEST_COOKIE}=${secret}; sb-127-auth-token=abc` },
      }),
    );
    expect(await here.json()).toEqual({ status: "consumed", expiresAt: "2026-09-13T20:05:00Z", signedIn: true });
    const elsewhere = await statusGET(
      apiRequest("/api/auth/telegram/request/status", { headers: { cookie: `${TG_REQUEST_COOKIE}=${secret}` } }),
    );
    expect(await elsewhere.json()).toEqual({ status: "consumed", expiresAt: "2026-09-13T20:05:00Z", signedIn: false });
    expect(authIpFactory.createAuthRouteClient).not.toHaveBeenCalled();
  });
});

// Hallazgo bloqueante del PR #78: la cookie del navegador que CREÓ la solicitud
// abría la sesión de la cuenta que aprobaba en Telegram. Un servidor atacante
// (que falsifica Origin sin problema) se quedaba con la cuenta de quien tocaba
// Iniciar. Ahora no existe esa vía.
describe("device-code phishing: the browser that created the request can never open a session", () => {
  const secret = generateBrowserSecret();
  // Lo que manda un servidor atacante: su propia cookie y un Origin falsificado.
  const forged = { host: "localhost", origin: "http://localhost", "content-type": "application/json", cookie: `${TG_REQUEST_COOKIE}=${secret}` };

  it("the same-origin guard cannot tell a server with a forged Origin apart (so it is not the defense)", () => {
    expect(isSameOriginRequest({ headers: new Headers(forged) }, { requireProof: true })).toBe(true);
  });

  it("POST /request/complete answers 410 without touching the database, Auth or cookies, even for an approved request", async () => {
    setLoginEnv(true);
    const admin = fakeAdmin({
      telegram_login_request_status: { data: [{ status: "approved", expires_at: "2026-09-13T20:05:00Z" }] },
    });
    const res = completePOST();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "gone" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
    expect(authIpFactory.createAuthRouteClient).not.toHaveBeenCalled();
  });

  it("there is no helper that consumes a request by browser cookie", () => {
    expect("consumeLoginRequest" in requestsModule).toBe(false);
  });

  it("the attacker's status poll only learns 'approved' and never gets account data", async () => {
    setLoginEnv(true);
    fakeAdmin({ telegram_login_request_status: { data: [{ status: "approved", expires_at: "2026-09-13T20:05:00Z" }] } });
    const res = await statusGET(apiRequest("/api/auth/telegram/request/status", { headers: forged }));
    const body = await res.json();
    expect(body).toEqual({ status: "approved", expiresAt: "2026-09-13T20:05:00Z" });
    expect(JSON.stringify(body)).not.toMatch(/user|phone|token/);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("/login/telegram page — what the single-use link shows (never signs in)", () => {
  const token = "Q".repeat(43);
  const ownHash = sha256Hex(generateBrowserSecret());

  it("is unavailable without configuration and does not touch the database", async () => {
    const db = vi.fn();
    expect(await resolveLinkPageView({ params: { t: token }, config: null, browserHash: ownHash, db })).toEqual({
      kind: "state",
      state: "unavailable",
    });
    expect(db).not.toHaveBeenCalled();
  });

  it("auto-submits only in the browser whose own cookie created that request", async () => {
    const admin = fakeAdmin({ telegram_login_link_peek: { data: [{ status: "ok", phone_e164: PHONE, same_browser: true }] } });
    const view = await resolveLinkPageView({ params: { t: token }, config: CONFIG, browserHash: ownHash, db: () => admin as never });
    expect(view).toEqual({ kind: "auto", token });
    expect(rpcArgs(admin.rpc, "telegram_login_link_peek")).toEqual({
      p_link_token_hash: hashLinkToken(BOT_TOKEN, token),
      p_browser_hash: ownHash,
    });
    expect(rpcNames(admin.rpc)).toEqual(["telegram_login_link_peek"]);
  });

  it("any other browser confirms first, seeing only the masked number", async () => {
    const admin = fakeAdmin({ telegram_login_link_peek: { data: [{ status: "ok", phone_e164: PHONE, same_browser: false }] } });
    const view = await resolveLinkPageView({ params: { t: token }, config: CONFIG, browserHash: null, db: () => admin as never });
    expect(view).toEqual({ kind: "confirm", token, maskedPhone: "+57 ••• ••• 4567" });
  });

  it("used, expired or malformed links and post-redeem states show a clear state", async () => {
    for (const status of ["used", "expired", "invalid"]) {
      const admin = fakeAdmin({ telegram_login_link_peek: { data: [{ status, phone_e164: null, same_browser: false }] } });
      expect(await resolveLinkPageView({ params: { t: token }, config: CONFIG, browserHash: null, db: () => admin as never })).toEqual({
        kind: "state",
        state: "gone",
      });
    }
    const db = vi.fn();
    expect(await resolveLinkPageView({ params: { t: "short" }, config: CONFIG, browserHash: null, db: () => ({ rpc: db }) as never })).toEqual({ kind: "state", state: "gone" });
    expect(db).not.toHaveBeenCalled();
    expect(await resolveLinkPageView({ params: { estado: "sms_only" }, config: CONFIG, browserHash: null, db })).toEqual({ kind: "state", state: "sms_only" });
    expect(await resolveLinkPageView({ params: { estado: "<script>" }, config: CONFIG, browserHash: null, db })).toEqual({ kind: "state", state: "gone" });
  });

  it("page copy has no routes as text and names the actions", async () => {
    const es = (await import("@/messages/es.json")).default.Login;
    const en = (await import("@/messages/en.json")).default.Login;
    for (const copy of [es, en]) {
      const all = JSON.stringify(copy);
      expect(all).not.toMatch(/\/login|\/api\//);
    }
    expect(es.tgLinkState.gone.title).toBe("ESTE ENLACE YA NO SIRVE");
    expect(es.tgLinkBackToLogin).toBe("Volver a iniciar sesión");
  });
});

describe("POST /api/auth/telegram/link — the only way to a Telegram session", () => {
  const token = "Q".repeat(43);
  const ownSecret = generateBrowserSecret();

  function formPost(headers: Record<string, string>, body = `t=${token}`) {
    return new NextRequest("http://localhost/api/auth/telegram/link", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded", ...headers },
      body,
    });
  }

  it("HEAD never consumes; GET forwards old-style links to the page without touching the database", async () => {
    expect(linkHEAD().status).toBe(405);
    const res = linkGET(new NextRequest(`http://localhost/api/auth/telegram/link?t=${token}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://localhost/login/telegram?t=${token}`);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("without env, from another site, without origin proof or not as a form never touches the database", async () => {
    const off = await linkPOST(formPost(SAME_ORIGIN));
    expect(off.headers.get("location")).toBe("http://localhost/login/telegram?estado=unavailable");
    setLoginEnv(true);
    for (const request of [
      formPost({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
      formPost({}),
      formPost({ "sec-fetch-site": "same-origin", "content-type": "application/json" }, JSON.stringify({ t: token })),
    ]) {
      const res = await linkPOST(request);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("http://localhost/login/telegram?estado=forbidden");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("redeems once and signs in with the real IP, notifies Telegram with the opener's device; a second POST lands on the 'gone' page without a session", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn().mockResolvedValue(Response.json({ ok: true, result: {} }));
    vi.stubGlobal("fetch", fetchStub);
    let used = false;
    const admin = fakeAdmin(
      {
        telegram_login_link_consume: () => {
          if (used) return { data: [{ status: "used" }] };
          used = true;
          return { data: [{ status: "ok", user_id: "account-1", telegram_user_id: TG, phone_e164: PHONE, same_browser: true }] };
        },
        telegram_login_authorize: { data: true },
      },
      { existingUserId: "account-1" },
    );
    const cookies = fakeCookieClient();
    const first = await linkPOST(
      formPost({
        ...SAME_ORIGIN,
        cookie: `${TG_REQUEST_COOKIE}=${ownSecret}`,
        "x-real-ip": "203.0.113.5",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    );
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("http://localhost/casa");
    expect(first.headers.get("cache-control")).toBe("no-store");
    // La cookie de la solicitud se queda: la pestaña que espera en este mismo
    // navegador la usa para ver «consumed» con sesión (si no, diría «venció»).
    expect(first.headers.get("set-cookie") ?? "").not.toMatch(/lp_tg_req=/);
    expect(authIpFactory.createAuthRouteClient).toHaveBeenCalledWith("203.0.113.5");
    expect(rpcArgs(admin.rpc, "telegram_login_link_consume")).toEqual({
      p_link_token_hash: hashLinkToken(BOT_TOKEN, token),
      p_browser_hash: sha256Hex(ownSecret),
    });
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalled());
    const notice = JSON.parse(String(fetchStub.mock.calls[0][1].body));
    expect(notice.chat_id).toBe(TG);
    expect(notice.text).toContain("Entraste a La Polla desde iPhone");

    const second = await linkPOST(formPost(SAME_ORIGIN));
    expect(second.status).toBe(303);
    expect(second.headers.get("location")).toBe("http://localhost/login/telegram?estado=gone");
    expect(cookies.auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("does not open a session when the phone now belongs to another account or the Telegram link was removed", async () => {
    setLoginEnv(true);
    for (const scenario of [
      { existingUserId: "other-account", authorize: true },
      { existingUserId: "account-1", authorize: false },
    ]) {
      const admin = fakeAdmin(
        {
          telegram_login_link_consume: { data: [{ status: "ok", user_id: "account-1", telegram_user_id: TG, phone_e164: PHONE, same_browser: false }] },
          telegram_login_authorize: { data: scenario.authorize },
        },
        { existingUserId: scenario.existingUserId },
      );
      const cookies = fakeCookieClient();
      const res = await linkPOST(formPost(SAME_ORIGIN));
      expect(res.headers.get("location")).toBe("http://localhost/login/telegram?estado=sms_only");
      expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
      expect(cookies.auth.verifyOtp).not.toHaveBeenCalled();
    }
  });
});

describe("retired endpoints", () => {
  it("telegram-verify answers 410 without touching the database, even with a valid-looking code", async () => {
    setLoginEnv(true);
    const res = await legacyVerifyPOST();
    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });
  it("telegram-link (v1) sends GET to the 'gone' page, answers 410 to POST and 405 to HEAD", async () => {
    setLoginEnv(true);
    const get = legacyLinkGET(new NextRequest(`http://localhost/api/auth/telegram-link?t=${"a".repeat(43)}`));
    expect(get.status).toBe(303);
    expect(get.headers.get("location")).toBe("http://localhost/login/telegram?estado=gone");
    expect(legacyLinkPOST().status).toBe(410);
    expect(legacyLinkHEAD().status).toBe(405);
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("recycled number: the session re-checks the Telegram link", () => {
  it("does not touch the account nor the browser session when the grant no longer matches", async () => {
    const admin = fakeAdmin({ telegram_login_authorize: { data: false } }, { existingUserId: "sms-account" });
    const cookies = fakeCookieClient();
    const authorize = telegramGrantAuthorizer(admin as never, { userId: "sms-account", telegramUserId: 7770001, phoneE164: PHONE });
    const result = await startSessionForVerifiedPhone(PHONE, "test", { authorize });
    expect(result).toEqual({ ok: false, stage: "denied" });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(cookies.auth.signOut).not.toHaveBeenCalled();
    expect(cookies.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("never links at session time and refuses a freshly created account", async () => {
    const admin = fakeAdmin({ telegram_login_authorize: { data: true } });
    const authorize = telegramGrantAuthorizer(admin as never, { userId: "account-1", telegramUserId: TG, phoneE164: PHONE });
    expect(await authorize({ authUserId: "account-1", created: true })).toBe(false);
    expect(await authorize({ authUserId: "account-2", created: false })).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(await authorize({ authUserId: "account-1", created: false })).toBe(true);
    expect(rpcArgs(admin.rpc, "telegram_login_authorize")).toMatchObject({ p_allow_first_link: false });
  });
});
