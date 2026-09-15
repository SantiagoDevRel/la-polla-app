// tests/telegram-login-polish.test.ts — Ajustes al login por Telegram v2 tras la
// prueba real en producción (2026-09-14):
//   1. número enmascarado con el código de país correcto (+351, no "+35");
//   2. Telegram en la misma pestaña solo en teléfonos y tabletas;
//   3. comandos y descripciones del bot sincronizados desde el servidor, una
//      vez por versión (webhook y ruta de cron);
//   4. un solo enlace vigente por cuenta de Telegram (migración 120; la
//      regresión SQL real está en scripts/telegram-login-single-link-check.sql);
//   5. sin splash ni bienvenida sobre /login/telegram;
//   6. SMS primario y Telegram secundario en /login.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminFactory = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminFactory);
// El webhook ahora también es el bot de jugadores (módulos de Casa server-only).
vi.mock("server-only", () => ({}));

import { callingCodeOf, maskPhone } from "@/lib/auth/telegram-login/mask-phone";
import { prefersSameTab, SAME_TAB_MEDIA_QUERY } from "@/lib/auth/telegram-login/open-mode";
import {
  BOT_PROFILE_CONFIG_KEY,
  BOT_PROFILE_RETRY_MS,
  BOT_PROFILE_STEPS,
  botProfileVersion,
  ensureBotProfile,
  resetBotProfileStateForTests,
} from "@/lib/auth/telegram-login/bot-profile";
import { isLoginLinkPath, LOGIN_LINK_PATH } from "@/lib/auth/telegram-login/link-path";
import { LOGIN_LINK_PATH as LINKS_LOGIN_LINK_PATH } from "@/lib/auth/telegram-login/links";
import { POST as webhookPOST } from "@/app/api/telegram/login/route";
import { POST as profileCronPOST } from "@/app/api/cron/telegram-login-bot-profile/route";

const ROOT = process.cwd();

/**
 * Fin de línea LF, venga como venga el checkout: con core.autocrlf=true (Windows)
 * los archivos bajan con CRLF y las guardas de varias líneas fallarían.
 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function readSource(path: string): string {
  return normalizeEol(readFileSync(join(ROOT, path), "utf8"));
}
const BOT_TOKEN = "123456789:AAFakeTokenForUnitTestsOnly_abcdefghijk";
const OTHER_BOT_TOKEN = "987654321:AAFakeTokenForUnitTestsOnly_abcdefghijk";
const WEBHOOK_SECRET = "unit-test-webhook-secret-0123456789abcdef";
const CRON_SECRET = "test-cron-secret-0123456789";
const CONFIG = { botToken: BOT_TOKEN };
const ENV_KEYS = [
  "TELEGRAM_LOGIN_BOT_TOKEN",
  "TELEGRAM_LOGIN_WEBHOOK_SECRET",
  "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME",
  "CRON_SECRET",
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setLoginEnv(on: boolean) {
  if (on) {
    process.env.TELEGRAM_LOGIN_BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "LaPollaLoginBot";
  } else {
    delete process.env.TELEGRAM_LOGIN_BOT_TOKEN;
    delete process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET;
    delete process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME;
  }
}

beforeEach(() => {
  resetBotProfileStateForTests();
  adminFactory.createAdminClient.mockReset();
  setLoginEnv(false);
  process.env.CRON_SECRET = CRON_SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
});

// ── 1. Número enmascarado ────────────────────────────────────────────────
describe("maskPhone — country calling code from the phone library, last 4 digits only", () => {
  it.each([
    ["+573001234567", "+57 ••• ••• 4567"],
    ["+351912345581", "+351 ••• ••• 5581"],
    ["+14155552671", "+1 ••• ••• 2671"],
    ["+34612345678", "+34 ••• ••• 5678"],
    ["+4915112345678", "+49 ••• ••• 5678"],
    ["+79161234567", "+7 ••• ••• 4567"],
    ["+97312345678", "+973 ••• ••• 5678"],
  ])("%s → %s", (phone, masked) => {
    expect(maskPhone(phone)).toBe(masked);
  });

  it("reads formatted or plus-less input by its digits", () => {
    expect(maskPhone("+351 912 345 581")).toBe("+351 ••• ••• 5581");
    expect(maskPhone("573001234567")).toBe("+57 ••• ••• 4567");
  });

  it("keeps at least 4 national digits hidden on short national numbers", () => {
    // Islandia (7 dígitos nacionales) y Andorra (6).
    expect(maskPhone("+3545512345")).toBe("+354 ••• ••• •345");
    expect(maskPhone("+376312345")).toBe("+376 ••• ••• ••45");
  });

  it("without a known country code shows no prefix and never guesses one", () => {
    expect(callingCodeOf("80012345678")).toBeNull();
    expect(maskPhone("+80012345678")).toBe("••• ••• 5678");
  });

  it("reveals nothing for values that cannot be E.164", () => {
    for (const junk of ["", "abc", "+123", "+6834012", "+0123456789", "+1234567890123456", "+57 300"]) {
      expect(maskPhone(junk)).toBe("••• ••• ••••");
    }
    expect(maskPhone(undefined as unknown as string)).toBe("••• ••• ••••");
  });

  it("always has the same shape: it does not leak the number's length", () => {
    const shapes = ["+573001234567", "+351912345581", "+14155552671", "+3545512345"].map((p) =>
      maskPhone(p).replace(/^\+\d+ /, "").replace(/\d/g, "#").replace(/•/g, "#"),
    );
    expect(new Set(shapes)).toEqual(new Set(["### ### ####"]));
  });

  it("the link page and the old messages module do not keep the 10-digit rule", () => {
    const messages = readSource("lib/auth/telegram-login/messages.ts");
    expect(messages).not.toMatch(/export function maskPhone/);
    const linkPage = readSource("lib/auth/telegram-login/link-page.ts");
    expect(linkPage).toContain('import { maskPhone } from "./mask-phone";');
    // La página es de servidor: el componente React del selector rompe el build.
    const mask = readSource("lib/auth/telegram-login/mask-phone.ts");
    expect(mask).toMatch(/from "libphonenumber-js\/min";/);
    expect(mask).not.toMatch(/from "react-phone-number-input/);
  });
});

// ── 2. Misma pestaña solo en teléfonos y tabletas ────────────────────────
type Device = { hover: "none" | "hover"; pointer: "coarse" | "fine" };

/** matchMedia falso que evalúa (hover: …) y (pointer: …) unidos por «and». */
function fakeMatchMedia(device: Device) {
  return vi.fn((query: string) => ({
    matches: query
      .split(/\s+and\s+/)
      .every((part) => {
        const m = /^\((hover|pointer):\s*(\w+)\)$/.exec(part.trim());
        return m ? device[m[1] as keyof Device] === m[2] : false;
      }),
  }));
}

describe("prefersSameTab — phones and tablets only", () => {
  it("uses the primary pointer: no hover and coarse", () => {
    expect(SAME_TAB_MEDIA_QUERY).toBe("(hover: none) and (pointer: coarse)");
  });

  it.each([
    ["phone", { hover: "none", pointer: "coarse" }, true],
    ["tablet without trackpad", { hover: "none", pointer: "coarse" }, true],
    ["desktop with mouse", { hover: "hover", pointer: "fine" }, false],
    ["touchscreen PC reporting a coarse pointer with hover", { hover: "hover", pointer: "coarse" }, false],
    ["touchscreen laptop with trackpad", { hover: "hover", pointer: "fine" }, false],
  ] as const)("%s → same tab: %s", (_label, device, expected) => {
    const matchMedia = fakeMatchMedia(device);
    expect(prefersSameTab(matchMedia)).toBe(expected);
    expect(matchMedia).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");
  });

  it("v2's (pointer: coarse) alone would have sent the touchscreen PC to the same tab", () => {
    expect(fakeMatchMedia({ hover: "hover", pointer: "coarse" })("(pointer: coarse)").matches).toBe(true);
  });

  it("falls back to a new window when matchMedia is missing or throws", () => {
    expect(prefersSameTab(undefined)).toBe(false);
    expect(prefersSameTab(() => { throw new Error("blocked"); })).toBe(false);
  });

  it("reads window.matchMedia by default", () => {
    const matchMedia = fakeMatchMedia({ hover: "none", pointer: "coarse" });
    vi.stubGlobal("window", { matchMedia });
    expect(prefersSameTab()).toBe(true);
    vi.stubGlobal("window", { matchMedia: fakeMatchMedia({ hover: "hover", pointer: "coarse" }) });
    expect(prefersSameTab()).toBe(false);
  });

  it("LoginClient uses the shared helper, not its own coarse-only query", () => {
    const source = readSource("app/(auth)/login/LoginClient.tsx");
    expect(source).toContain('import { prefersSameTab } from "@/lib/auth/telegram-login/open-mode";');
    expect(source).not.toMatch(/matchMedia\(/);
    expect(source).not.toMatch(/function prefersSameTab/);
  });
});

// ── 3. Perfil del bot ────────────────────────────────────────────────────
function fakeProfileDb(opts: { stored?: string | null; readError?: boolean; saveError?: boolean } = {}) {
  const maybeSingle = vi.fn(async () =>
    opts.readError
      ? { data: null, error: { code: "XX000" } }
      : { data: opts.stored === undefined || opts.stored === null ? null : { value: opts.stored }, error: null },
  );
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn(async () => ({ error: opts.saveError ? { code: "42501" } : null }));
  const from = vi.fn(() => ({ select, upsert }));
  return { from, select, eq, maybeSingle, upsert };
}

describe("ensureBotProfile — commands and descriptions, once per version", () => {
  it("does nothing without the bot token: no database, no Telegram", async () => {
    const db = vi.fn();
    const send = vi.fn();
    expect(await ensureBotProfile({ config: null, db, send })).toEqual({ status: "disabled" });
    expect(await ensureBotProfile({ config: { botToken: "" }, db, send })).toEqual({ status: "disabled" });
    expect(db).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("the profile: player-bot commands, v2 texts in the default, es and en lists", () => {
    const byLang = (method: string, lang?: string) =>
      BOT_PROFILE_STEPS.filter(([m, body]) => m === method && body.language_code === lang).map(([, body]) => body);
    const COMMANDS = ["start", "pollas", "mispollas", "pagos", "perfil", "ayuda", "web"];

    // Pedido del dueño (2026-09-15): todo en español, también para quien usa
    // Telegram en inglés, y con el enlace a la web en la descripción.
    for (const lang of [undefined, "es", "en"]) {
      const [commands] = byLang("setMyCommands", lang) as Array<{ commands: { command: string; description: string }[] }>;
      expect(commands.commands.map((c) => c.command)).toEqual(COMMANDS);
      expect(commands.commands[0]).toEqual({ command: "start", description: "Menú principal" });
      expect(commands.commands[commands.commands.length - 1]).toEqual({ command: "web", description: "Entrar a la página web" });
      const description = byLang("setMyDescription", lang)[0].description as string;
      expect(description).toContain("inscríbete a las pollas");
      expect(description).toContain("cuando el SMS no llega");
      expect(description).toContain("https://lapollacolombiana.com");
      expect(byLang("setMyShortDescription", lang)[0].short_description).toBe(
        "Inscríbete, pronostica y mira la tabla de La Polla Colombiana. https://lapollacolombiana.com",
      );
    }
    const allTexts = JSON.stringify(BOT_PROFILE_STEPS);
    expect(allTexts).not.toMatch(/\b(sign in|when the|Main menu|Help)\b/i);
    expect(BOT_PROFILE_STEPS).toHaveLength(9);

    const commands = BOT_PROFILE_STEPS.flatMap(([, body]) => (body.commands as { command: string }[] | undefined) ?? []);
    expect(commands.map((c) => c.command)).toEqual([...COMMANDS, ...COMMANDS, ...COMMANDS]);
    // Límite de la Bot API para la descripción de un comando.
    for (const c of commands as unknown as { description: string }[]) expect(c.description.length).toBeLessThanOrEqual(256);
    const texts = JSON.stringify(
      BOT_PROFILE_STEPS.map(([, body]) => [body.commands, body.description, body.short_description]),
    );
    expect(texts).not.toMatch(/code|código|Chicken Picks/i);
    // Límites de la Bot API.
    for (const [, body] of BOT_PROFILE_STEPS) {
      if (typeof body.short_description === "string") expect(body.short_description.length).toBeLessThanOrEqual(120);
      if (typeof body.description === "string") expect(body.description.length).toBeLessThanOrEqual(512);
    }
  });

  it("the manual setup script sends the same texts, so running it cannot bring v1 back", () => {
    const script = readSource("scripts/telegram-login-set-webhook.mjs");
    const texts = new Set(
      BOT_PROFILE_STEPS.flatMap(([, body]) => [
        ...((body.commands as { description: string }[] | undefined) ?? []).map((c) => c.description),
        body.description,
        body.short_description,
      ]).filter((t): t is string => typeof t === "string"),
    );
    // La descripción larga se arma por líneas en los dos archivos.
    for (const text of texts) {
      for (const line of text.split("\n").filter(Boolean)) expect(script).toContain(JSON.stringify(line));
    }
    expect(script).not.toMatch(/command: "login"|Chicken Picks|sin códigos/);
  });

  it("the version hashes the profile and the bot's public id, never the token", () => {
    const version = botProfileVersion(BOT_TOKEN);
    expect(version).toMatch(/^2026-09-15b-[0-9a-f]{16}$/);
    expect(botProfileVersion(BOT_TOKEN)).toBe(version);
    expect(botProfileVersion(OTHER_BOT_TOKEN)).not.toBe(version);
    expect(botProfileVersion("123456789:AAOtherSecretPartForTheSameBot_zyxwvutsrq")).toBe(version);
    expect(version).not.toContain(BOT_TOKEN.split(":")[1]);
  });

  it("first run: sends the nine calls, then saves the version in app_config with explicit columns", async () => {
    const db = fakeProfileDb();
    const send = vi.fn().mockResolvedValue(true);
    const result = await ensureBotProfile({ config: CONFIG, db: db as never, send, now: () => Date.parse("2026-09-14T03:00:00Z") });
    const version = botProfileVersion(BOT_TOKEN);
    expect(result).toEqual({ status: "synced", version });

    expect(db.from).toHaveBeenCalledWith("app_config");
    expect(db.select).toHaveBeenCalledWith("value");
    expect(db.eq).toHaveBeenCalledWith("key", BOT_PROFILE_CONFIG_KEY);
    expect(BOT_PROFILE_CONFIG_KEY).toBe("telegram_login_bot_profile_version");
    expect(send).toHaveBeenCalledTimes(9);
    expect(send.mock.calls.map((c) => [c[0], c[1]])).toEqual(BOT_PROFILE_STEPS.map(([m, b]) => [m, b]));
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(db.upsert).toHaveBeenCalledWith(
      { key: BOT_PROFILE_CONFIG_KEY, value: version, updated_at: "2026-09-14T03:00:00.000Z" },
      { onConflict: "key" },
    );
  });

  it("is idempotent: the same instance does not touch the database again, a new one reads and skips", async () => {
    const db = fakeProfileDb();
    const send = vi.fn().mockResolvedValue(true);
    await ensureBotProfile({ config: CONFIG, db: db as never, send });
    const again = await ensureBotProfile({ config: CONFIG, db: db as never, send });
    expect(again.status).toBe("current");
    expect(send).toHaveBeenCalledTimes(9);
    expect(db.maybeSingle).toHaveBeenCalledTimes(1);

    // Otra instancia (estado en memoria vacío) con la versión ya guardada.
    resetBotProfileStateForTests();
    const stored = fakeProfileDb({ stored: botProfileVersion(BOT_TOKEN) });
    const send2 = vi.fn().mockResolvedValue(true);
    expect(await ensureBotProfile({ config: CONFIG, db: stored as never, send: send2 })).toEqual({
      status: "current",
      version: botProfileVersion(BOT_TOKEN),
    });
    expect(send2).not.toHaveBeenCalled();
    expect(stored.upsert).not.toHaveBeenCalled();
  });

  it("a stored older version syncs again", async () => {
    const db = fakeProfileDb({ stored: "2026-09-13-0000000000000000" });
    const send = vi.fn().mockResolvedValue(true);
    expect((await ensureBotProfile({ config: CONFIG, db: db as never, send })).status).toBe("synced");
    expect(send).toHaveBeenCalledTimes(9);
  });

  it("concurrent updates share one run", async () => {
    const db = fakeProfileDb();
    const send = vi.fn().mockResolvedValue(true);
    const [a, b] = await Promise.all([
      ensureBotProfile({ config: CONFIG, db: db as never, send }),
      ensureBotProfile({ config: CONFIG, db: db as never, send }),
    ]);
    expect(a.status).toBe("synced");
    expect(b.status).toBe("synced");
    expect(send).toHaveBeenCalledTimes(9);
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });

  it("a failed call does not save the version, pauses retries and logs no token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let clock = 1_000_000;
    const db = fakeProfileDb();
    const send = vi.fn(async (method: string, body: Record<string, unknown>) => !(method === "setMyCommands" && body.language_code === "en"));
    const failed = await ensureBotProfile({ config: CONFIG, db: db as never, send, now: () => clock });
    expect(failed).toMatchObject({ status: "failed", stage: "telegram", method: "setMyCommands" });
    expect(db.upsert).not.toHaveBeenCalled();

    send.mockClear();
    clock += BOT_PROFILE_RETRY_MS - 1;
    expect((await ensureBotProfile({ config: CONFIG, db: db as never, send, now: () => clock })).status).toBe("backoff");
    expect(send).not.toHaveBeenCalled();

    // La corrida manual no espera la pausa.
    expect((await ensureBotProfile({ config: CONFIG, db: db as never, send, now: () => clock, retryNow: true })).status).toBe("failed");
    expect(send).toHaveBeenCalledTimes(9);

    send.mockReset();
    send.mockResolvedValue(true);
    clock += BOT_PROFILE_RETRY_MS;
    expect((await ensureBotProfile({ config: CONFIG, db: db as never, send, now: () => clock })).status).toBe("synced");
    expect(db.upsert).toHaveBeenCalledTimes(1);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(BOT_TOKEN);
    expect(logged).not.toContain(BOT_TOKEN.split(":")[1]);
  });

  it("a read error does not call Telegram", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = fakeProfileDb({ readError: true });
    const send = vi.fn().mockResolvedValue(true);
    expect(await ensureBotProfile({ config: CONFIG, db: db as never, send })).toMatchObject({ status: "failed", stage: "read" });
    expect(send).not.toHaveBeenCalled();
  });

  it("force re-sends even with the version stored; a failed save is reported", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = fakeProfileDb({ stored: botProfileVersion(BOT_TOKEN), saveError: true });
    const send = vi.fn().mockResolvedValue(true);
    expect(await ensureBotProfile({ config: CONFIG, db: db as never, send, force: true })).toMatchObject({
      status: "failed",
      stage: "save",
    });
    expect(db.maybeSingle).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(9);
    // Telegram ya quedó al día: esta instancia no lo repite en cada update.
    expect((await ensureBotProfile({ config: CONFIG, db: db as never, send })).status).toBe("current");
    expect(send).toHaveBeenCalledTimes(9);
  });
});

// ── 3b. Webhook y ruta de cron ───────────────────────────────────────────
function privateStart(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: 10 + updateId,
      date: 1_700_000_000,
      chat: { id: 5550001, type: "private" },
      from: { id: 5550001, is_bot: false, first_name: "Ana", language_code: "en" },
      text: "/start",
    },
  };
}

function webhookRequest(secret: string, body: unknown) {
  return new NextRequest("http://localhost/api/telegram/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}

/** Admin falso: sin vínculo (el bot pide el número) y app_config vacío. */
function fakeWebhookAdmin() {
  const profile = fakeProfileDb();
  const chats = {
    upsert: vi.fn().mockResolvedValue({ error: null }),
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
  };
  const client = {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "telegram_login_linked_accounts") return { data: [], error: null };
      throw new Error(`rpc inesperada: ${fn}`);
    }),
    from: vi.fn((table: string) => (table === "app_config" ? profile.from() : chats)),
    profile,
  };
  adminFactory.createAdminClient.mockReturnValue(client);
  return client;
}

const telegramMethods = (fetchStub: ReturnType<typeof vi.fn>) =>
  fetchStub.mock.calls.map((c) => String(c[0]).split("/").pop());

describe("webhook: profile sync after an authenticated update", () => {
  it("runs once per version across updates, after the bot's own answer", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchStub);
    const admin = fakeWebhookAdmin();

    expect((await webhookPOST(webhookRequest(WEBHOOK_SECRET, privateStart(1)))).status).toBe(200);
    await vi.waitFor(() => expect(admin.profile.upsert).toHaveBeenCalledTimes(1));
    expect((await webhookPOST(webhookRequest(WEBHOOK_SECRET, privateStart(2)))).status).toBe(200);

    const methods = telegramMethods(fetchStub);
    // Dos pedidos de número, dos mensajes cada uno (teclado + botón de la mini app).
    expect(methods.filter((m) => m === "sendMessage")).toHaveLength(4);
    expect(methods.filter((m) => m === "setMyCommands")).toHaveLength(3);
    expect(methods.filter((m) => m === "setMyDescription")).toHaveLength(3);
    expect(methods.filter((m) => m === "setMyShortDescription")).toHaveLength(3);
    // El mensaje del bot sale antes que el perfil.
    expect(methods[0]).toBe("sendMessage");
    expect(admin.profile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: BOT_PROFILE_CONFIG_KEY, value: botProfileVersion(BOT_TOKEN) }),
      { onConflict: "key" },
    );
  });

  it("still answers 200 to Telegram when the admin client cannot be created", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchStub);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    adminFactory.createAdminClient.mockImplementation(() => {
      throw new Error("supabaseUrl is required.");
    });

    const res = await webhookPOST(webhookRequest(WEBHOOK_SECRET, privateStart(1)));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("[telegram-login] perfil del bot sin sincronizar: unexpected"));
    // Sin base no hay mensaje ni perfil que mandar.
    expect(fetchStub).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[telegram-login] update falló:", "supabaseUrl is required.");
  });

  it("never syncs on a wrong secret or without configuration", async () => {
    const fetchStub = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchStub);
    expect((await webhookPOST(webhookRequest(WEBHOOK_SECRET, privateStart(1)))).status).toBe(503);
    setLoginEnv(true);
    expect((await webhookPOST(webhookRequest(`${WEBHOOK_SECRET}-nope`, privateStart(1)))).status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchStub).not.toHaveBeenCalled();
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });
});

function cronRequest(query = "", authorization: string | null = `Bearer ${CRON_SECRET}`) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== null) headers.Authorization = authorization;
  return new NextRequest(`http://localhost/api/cron/telegram-login-bot-profile${query}`, { method: "POST", headers });
}

describe("POST /api/cron/telegram-login-bot-profile", () => {
  it("requires the cron secret before reading configuration or the database", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    for (const auth of [null, "", CRON_SECRET, "Bearer otro-secreto", `bearer ${CRON_SECRET}`]) {
      const res = await profileCronPOST(cronRequest("", auth));
      expect(res.status).toBe(403);
    }
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("answers 503 when the login bot is not configured", async () => {
    const res = await profileCronPOST(cronRequest());
    expect(res.status).toBe(503);
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("syncs, then reports current; ?force=1 re-sends; the body never carries the token", async () => {
    setLoginEnv(true);
    const fetchStub = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchStub);
    const admin = fakeWebhookAdmin();

    let res = await profileCronPOST(cronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, status: "synced", version: botProfileVersion(BOT_TOKEN) });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetchStub).toHaveBeenCalledTimes(9);

    res = await profileCronPOST(cronRequest());
    expect(await res.json()).toMatchObject({ ok: true, status: "current" });
    expect(fetchStub).toHaveBeenCalledTimes(9);

    res = await profileCronPOST(cronRequest("?force=1"));
    expect(await res.json()).toMatchObject({ ok: true, status: "synced" });
    expect(fetchStub).toHaveBeenCalledTimes(18);
    expect(admin.profile.upsert).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toContain(BOT_TOKEN.split(":")[1]);
  });

  it("answers 502 with the failing stage when Telegram rejects a call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setLoginEnv(true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, description: "Bad Request" })));
    fakeWebhookAdmin();
    const res = await profileCronPOST(cronRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error", "stage", "version"]);
    expect(body.stage).toBe("telegram");
  });

  it("the manual workflow is hardened like the other cron workflows", () => {
    const yml = readSource(".github/workflows/telegram-login-bot-profile.yml");
    expect(yml).toMatch(/^permissions: \{\}$/m);
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).not.toMatch(/schedule:/);
    expect(yml).toMatch(/timeout-minutes: 5/);
    expect(yml).toMatch(/--max-time 60/);
    expect(yml).toContain("/api/cron/telegram-login-bot-profile");
    expect(yml).toContain('Authorization: Bearer $CRON_SECRET');
    expect(yml).not.toMatch(/TELEGRAM_LOGIN_BOT_TOKEN/);
    // El input llega por env, nunca interpolado dentro del script.
    expect(yml).toContain("FORCE: ${{ inputs.force }}");
    expect(yml.split("run: |")[1]).not.toContain("${{");
  });
});

// ── 4. Un solo enlace vivo por cuenta de Telegram (migración 120) ─────────
const MIGRATIONS = readdirSync(join(ROOT, "supabase/migrations"));
const MIGRATION_120 = MIGRATIONS.find((f) => f.startsWith("120_"));
const MIGRATION_120_LF = MIGRATION_120 ? readSource(`supabase/migrations/${MIGRATION_120}`) : "";

describe("static source reads", () => {
  it("normalize CRLF checkouts (core.autocrlf=true) to LF", () => {
    expect(normalizeEol("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(MIGRATION_120_LF).not.toContain("\r");
  });
});

// Las mismas guardas sobre el archivo tal como está y sobre una copia CRLF, que
// es como lo baja git en Windows: sin normalizar, la variante CRLF falla.
describe.each([
  ["LF", MIGRATION_120_LF],
  ["CRLF", MIGRATION_120_LF.replace(/\n/g, "\r\n")],
])("migration 120 (%s checkout) — issuing a link expires the account's other live links", (_eol, raw) => {
  const migrations = MIGRATIONS;
  const sql = normalizeEol(raw);

  function body(fn: string): string {
    const m = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql);
    return m?.[1] ?? "";
  }

  const EXPIRE_OTHERS =
    /UPDATE public\.telegram_login_requests r\s+SET status = 'expired', expires_at = LEAST\(r\.expires_at, t\)\s+WHERE r\.telegram_user_id = p_telegram_user_id\s+AND r\.status = 'approved'/g;

  it("is the only migration numbered 120 and is additive", () => {
    expect(migrations.filter((f) => f.startsWith("120_"))).toEqual(["120_telegram_login_single_live_link.sql"]);
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE|ALTER TABLE)\b/i);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
  });

  it("approve expires every other approved link of the same Telegram account, in both approval paths", () => {
    const approve = body("telegram_login_request_approve");
    const expires = approve.match(EXPIRE_OTHERS) ?? [];
    expect(expires).toHaveLength(2);
    expect(approve.match(/AND r\.id <> req\.id;/g)).toHaveLength(2);
  });

  it("a loose link also expires links bound to browser requests (119 only expired loose ones)", () => {
    const issue = body("telegram_login_link_issue");
    expect(issue.match(EXPIRE_OTHERS)).toHaveLength(1);
    expect(issue).not.toMatch(/nonce_hash IS NULL/);
    // El vencimiento va después del tope: un intento rechazado no vence nada.
    expect(issue.indexOf("telegram_login_link_rate_limited")).toBeLessThan(issue.search(EXPIRE_OTHERS));
  });

  it("keeps the signatures, SECURITY DEFINER, fixed search_path and service_role-only grants", () => {
    for (const sig of [
      "public.telegram_login_request_approve(uuid, bigint, uuid, text, text)",
      "public.telegram_login_link_issue(bigint, uuid, text, text, text)",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig}\n  FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${sig}\n  TO service_role;`);
    }
    expect(sql.match(/SECURITY DEFINER\nSET search_path = public, pg_temp/g)).toHaveLength(2);
  });
});

// ── 5. Sin splash ni bienvenida sobre /login/telegram ───────────────────
describe("overlays skip the single-use link page", () => {
  it("matches only the link page and its subpaths", () => {
    expect(LOGIN_LINK_PATH).toBe("/login/telegram");
    expect(LINKS_LOGIN_LINK_PATH).toBe(LOGIN_LINK_PATH);
    expect(isLoginLinkPath("/login/telegram")).toBe(true);
    expect(isLoginLinkPath("/login/telegram/x")).toBe(true);
    for (const path of ["/login", "/login/telegramx", "/casa", "/", "", null, undefined]) {
      expect(isLoginLinkPath(path)).toBe(false);
    }
  });

  it("the root splash and the welcome intro both use the shared check", () => {
    const splash = readSource("components/layout/SplashScreen.tsx");
    expect(splash).toContain('import { isLoginLinkPath } from "@/lib/auth/telegram-login/link-path";');
    expect(splash).toMatch(/const skip = isLoginLinkPath\(usePathname\(\)\);/);
    expect(splash).toMatch(/if \(phase === "idle" \|\| skip\) return null;/);
    const intro = readSource("components/auth/WelcomeIntroLoader.tsx");
    expect(intro).toMatch(/if \(isLoginLinkPath\(pathname\)\) return null;/);
  });
});

// ── 6. SMS primario, Telegram secundario ────────────────────────────────
describe("/login keeps SMS first and Telegram second", () => {
  const source = readSource("app/(auth)/login/LoginClient.tsx");

  it("phone step: gold SMS submit first, Telegram as a secondary button below", () => {
    const input = source.slice(source.indexOf('{step === "input" && ('), source.indexOf('{step === "otp" && ('));
    const sms = input.indexOf('{t("btnSms")}');
    const telegram = input.indexOf('onClick={() => void startTelegram("input")}');
    expect(sms).toBeGreaterThan(0);
    expect(telegram).toBeGreaterThan(sms);
    expect(input.slice(input.lastIndexOf("<button", sms), sms)).toMatch(/type="submit"[\s\S]*bg-gold/);
    expect(input.slice(telegram, telegram + 120)).toContain("className={SECONDARY_BTN}");
  });

  it("code step: «¿No te llegó el SMS?» and the Telegram button after the verify form", async () => {
    const otp = source.slice(source.indexOf('{step === "otp" && ('), source.indexOf('{step === "telegram" && ('));
    const verify = otp.indexOf('t("otpVerify")');
    const didnt = otp.indexOf('{t("tgDidntArrive")}');
    const telegram = otp.indexOf('onClick={() => void startTelegram("otp")}');
    expect(verify).toBeGreaterThan(0);
    expect(didnt).toBeGreaterThan(verify);
    expect(telegram).toBeGreaterThan(didnt);
    expect(otp.slice(telegram, telegram + 120)).toContain("className={SECONDARY_BTN}");

    const es = (await import("@/messages/es.json")).default.Login;
    const en = (await import("@/messages/en.json")).default.Login;
    expect(es.tgDidntArrive).toBe("¿No te llegó el SMS?");
    expect(es.tgUseTelegram).toBe("Entrar con Telegram");
    expect(en.tgDidntArrive).toBe("Didn't get the text message?");
    expect(en.tgUseTelegram).toBe("Sign in with Telegram");
  });
});
