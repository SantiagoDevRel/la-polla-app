// tests/auth-real-ip.test.ts — Las llamadas de Supabase Auth salen con la IP
// real de la persona (Sb-Forwarded-For + secret key) y el tope diario de SMS
// remite a soporte sin gastar cupo cuando Supabase rechaza el envío.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  sbCreateClient: vi.fn(),
  ssrCreateServerClient: vi.fn(),
  cookieStore: {
    getAll: vi.fn(() => [{ name: "sb-test-auth-token", value: "old" }]),
    set: vi.fn(),
  },
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.sbCreateClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.ssrCreateServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));

const route = vi.hoisted(() => ({
  checkIpRateLimit: vi.fn(),
  checkDailySmsCap: vi.fn(),
  checkAndRecordAttempt: vi.fn(),
  releaseGenerateAttempt: vi.fn(),
  signInWithOtp: vi.fn(),
  createAuthClient: vi.fn(),
}));

vi.mock("@/lib/auth/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/rate-limit")>();
  return {
    ...actual,
    checkIpRateLimit: route.checkIpRateLimit,
    checkDailySmsCap: route.checkDailySmsCap,
    checkAndRecordAttempt: route.checkAndRecordAttempt,
    releaseGenerateAttempt: route.releaseGenerateAttempt,
  };
});

import {
  SB_FORWARDED_FOR_HEADER,
  authRequestConfig,
  createAuthClient,
  createAuthRouteClient,
  getClientIp,
  normalizeIp,
  resetAuthIpWarningForTests,
} from "@/lib/supabase/auth-ip";
import { otpRejectedBeforeSending } from "@/lib/auth/rate-limit";
import { DAILY_SMS_CAP_CODE, SUPPORT_PATH } from "@/lib/auth/otp-codes";

const SECRET = "sb_secret_fake";
const ANON = "anon-test-key";
const URL_ = "https://example-ref.supabase.co";
const ORIGINAL_ENV = { ...process.env };

function headers(values: Record<string, string>) {
  return new Headers(values);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthIpWarningForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
  delete process.env.SUPABASE_SECRET_KEY;
  mocks.sbCreateClient.mockImplementation(() => ({ auth: { kind: "plain" } }));
  mocks.ssrCreateServerClient.mockImplementation(() => ({ auth: { kind: "ssr" } }));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getClientIp / normalizeIp", () => {
  it("prefiere x-real-ip sobre un x-forwarded-for distinto", () => {
    expect(
      getClientIp(headers({ "x-real-ip": "190.25.1.7", "x-forwarded-for": "6.6.6.6" })),
    ).toBe("190.25.1.7");
  });

  it("sin x-real-ip toma SOLO el primer valor de x-forwarded-for", () => {
    expect(
      getClientIp(headers({ "x-forwarded-for": " 181.49.2.3 , 10.0.0.1, 3.236.1.1" })),
    ).toBe("181.49.2.3");
  });

  it("no salta a valores posteriores si el primero es basura", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "evil, 181.49.2.3" }))).toBeNull();
  });

  it("x-real-ip inválida cae al primer x-forwarded-for válido", () => {
    expect(
      getClientIp(headers({ "x-real-ip": "not-an-ip", "x-forwarded-for": "2800:e2:9f00::1" })),
    ).toBe("2800:e2:9f00::1");
  });

  it("acepta IPv6, IPv4-mapeada y formas con puerto", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:190.25.1.7")).toBe("::ffff:190.25.1.7");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("190.25.1.7:5678")).toBe("190.25.1.7");
  });

  it("descarta vacío, texto, zonas, IPs imposibles y valores enormes", () => {
    for (const bad of [
      "",
      "   ",
      "unknown",
      "300.1.1.1",
      "1.2.3",
      "fe80::1%eth0",
      "190.25.1.7; DROP",
      `${"1".repeat(80)}`,
      "<script>",
    ]) {
      expect(normalizeIp(bad)).toBeNull();
    }
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(getClientIp(headers({}))).toBeNull();
    expect(getClientIp(headers({ "x-forwarded-for": "" }))).toBeNull();
  });
});

describe("selección de key y cabecera para Auth", () => {
  it("sin SUPABASE_SECRET_KEY usa la anon key, sin cabecera, y avisa una sola vez", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authRequestConfig("190.25.1.7")).toEqual({ key: ANON, headers: {}, forwardsIp: false });
    authRequestConfig("190.25.1.8");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(ANON);
    warn.mockRestore();
  });

  it("una key que no es sb_secret_ (p.ej. service_role legacy) no se usa", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SUPABASE_SECRET_KEY = "eyJhbGciOiJIUzI1NiJ9.legacy.service";
    expect(authRequestConfig("190.25.1.7")).toEqual({ key: ANON, headers: {}, forwardsIp: false });
    expect(String(warn.mock.calls[0][0])).not.toContain("eyJ");
    warn.mockRestore();
  });

  it("con secret key e IP válida manda Sb-Forwarded-For", () => {
    process.env.SUPABASE_SECRET_KEY = SECRET;
    expect(authRequestConfig("190.25.1.7")).toEqual({
      key: SECRET,
      headers: { [SB_FORWARDED_FOR_HEADER]: "190.25.1.7" },
      forwardsIp: true,
    });
  });

  it("con secret key pero sin IP válida no inventa cabecera", () => {
    process.env.SUPABASE_SECRET_KEY = SECRET;
    expect(authRequestConfig(null)).toEqual({ key: SECRET, headers: {}, forwardsIp: false });
    expect(authRequestConfig("basura")).toEqual({ key: SECRET, headers: {}, forwardsIp: false });
  });

  it("createAuthClient (start-otp) pasa key y cabecera y devuelve SOLO auth", () => {
    process.env.SUPABASE_SECRET_KEY = SECRET;
    const auth = createAuthClient("2800:e2:9f00::1");
    expect(auth).toEqual({ kind: "plain" });
    expect(mocks.sbCreateClient).toHaveBeenCalledWith(URL_, SECRET, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { "Sb-Forwarded-For": "2800:e2:9f00::1" },
        fetch: expect.any(Function),
      },
    });
  });

  it("createAuthClient sin secret key conserva el cliente anon de antes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    createAuthClient("190.25.1.7");
    expect(mocks.sbCreateClient).toHaveBeenCalledWith(URL_, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: {} },
    });
  });

  it("createAuthRouteClient (verify-otp) usa las cookies del request", async () => {
    process.env.SUPABASE_SECRET_KEY = SECRET;
    const auth = await createAuthRouteClient("190.25.1.7");
    expect(auth).toEqual({ kind: "ssr" });
    const [url, key, options] = mocks.ssrCreateServerClient.mock.calls[0];
    expect(url).toBe(URL_);
    expect(key).toBe(SECRET);
    expect(options.global).toEqual({
      headers: { "Sb-Forwarded-For": "190.25.1.7" },
      fetch: expect.any(Function),
    });
    expect(options.cookies.getAll()).toEqual([{ name: "sb-test-auth-token", value: "old" }]);
    options.cookies.setAll([{ name: "sb-test-auth-token", value: "new", options: { path: "/" } }]);
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("sb-test-auth-token", "new", { path: "/" });
  });
});

// Una sb_secret_ revocada, rotada, de otro proyecto o mal copiada: el gateway
// de Supabase responde 401 {"message":"Invalid API key"} (probado en prod el
// 2026-09-13 contra /auth/v1/otp y /auth/v1/logout) antes de llegar a Auth.
describe("secret key rechazada por Supabase: el login no se cae", () => {
  const invalidKey = () =>
    new Response(JSON.stringify({ message: "Invalid API key", hint: "Double check your API key." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  const ok = (body: unknown = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function secretFetchFor(create: () => unknown) {
    process.env.SUPABASE_SECRET_KEY = SECRET;
    await create();
    const calls = [...mocks.sbCreateClient.mock.calls, ...mocks.ssrCreateServerClient.mock.calls];
    const fetchImpl = calls[calls.length - 1][2].global.fetch as typeof fetch | undefined;
    expect(typeof fetchImpl).toBe("function");
    return fetchImpl!;
  }

  it("repite UNA vez con la anon key y sin Sb-Forwarded-For, y avisa por console.error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const net = vi.fn().mockResolvedValueOnce(invalidKey()).mockResolvedValueOnce(ok({ sent: true }));
    vi.stubGlobal("fetch", net);
    const fetchImpl = await secretFetchFor(() => createAuthClient("190.25.1.7"));

    const body = JSON.stringify({ phone: "+573001112233" });
    const res = await fetchImpl(`${URL_}/auth/v1/otp`, {
      method: "POST",
      headers: {
        apikey: SECRET,
        Authorization: `Bearer ${SECRET}`,
        "Sb-Forwarded-For": "190.25.1.7",
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(net).toHaveBeenCalledTimes(2);
    const retry = new Headers(net.mock.calls[1][1].headers);
    expect(retry.get("apikey")).toBe(ANON);
    expect(retry.get("authorization")).toBe(`Bearer ${ANON}`);
    expect(retry.get("sb-forwarded-for")).toBeNull();
    expect(net.mock.calls[1][0]).toBe(`${URL_}/auth/v1/otp`);
    expect(net.mock.calls[1][1].body).toBe(body);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/SUPABASE_SECRET_KEY/);
    expect(String(error.mock.calls[0][0])).not.toContain(SECRET);
  });

  it("signOut (verify-otp): conserva el token de la persona y cambia solo la apikey", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const net = vi.fn().mockResolvedValueOnce(invalidKey()).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", net);
    const fetchImpl = await secretFetchFor(() => createAuthRouteClient("190.25.1.7"));

    await fetchImpl(`${URL_}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: SECRET, Authorization: "Bearer user-access-token", "Sb-Forwarded-For": "190.25.1.7" },
    });

    const retry = new Headers(net.mock.calls[1][1].headers);
    expect(retry.get("apikey")).toBe(ANON);
    expect(retry.get("authorization")).toBe("Bearer user-access-token");
    expect(retry.get("sb-forwarded-for")).toBeNull();
  });

  it("otros 401 de Auth (JWT inválido) y respuestas normales no se repiten", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const net = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", net);
    const fetchImpl = await secretFetchFor(() => createAuthClient("190.25.1.7"));

    const first = await fetchImpl(`${URL_}/auth/v1/logout`, { headers: { apikey: SECRET } });
    expect(first.status).toBe(401);
    expect(await first.json()).toEqual({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    const second = await fetchImpl(`${URL_}/auth/v1/otp`, { headers: { apikey: SECRET } });
    expect(second.status).toBe(200);
    expect(net).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
  });

  it("start-otp de punta a punta (supabase-js real): la key rechazada igual envía el código", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
    mocks.sbCreateClient.mockImplementation(actual.createClient);
    process.env.SUPABASE_SECRET_KEY = SECRET;
    route.checkIpRateLimit.mockResolvedValue({ blocked: false, remaining: 0 });
    route.checkDailySmsCap.mockResolvedValue({ blocked: false, remaining: 2 });
    route.checkAndRecordAttempt.mockResolvedValue({ blocked: false, remaining: 4, attemptId: "attempt-1" });

    const net = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).get("apikey") === SECRET ? invalidKey() : ok(),
    );
    vi.stubGlobal("fetch", net);

    vi.resetModules();
    vi.doUnmock("@/lib/supabase/auth-ip");
    const { POST } = await import("@/app/api/auth/start-otp/route");
    const res = await POST(
      new NextRequest("https://lapollacolombiana.com/api/auth/start-otp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "190.25.1.7" },
        body: JSON.stringify({ phone: "+57 300 111 2233" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const otpCalls = net.mock.calls.filter(([input]) => String(input).includes("/auth/v1/otp"));
    expect(otpCalls).toHaveLength(2);
    expect(new Headers(otpCalls[1][1]?.headers).get("apikey")).toBe(ANON);
    expect(route.releaseGenerateAttempt).not.toHaveBeenCalled();
  });
});

describe("otpRejectedBeforeSending", () => {
  it("libera el cupo solo con respuestas 4xx de Supabase", () => {
    expect(otpRejectedBeforeSending({ status: 429 })).toBe(true);
    expect(otpRejectedBeforeSending({ status: 400 })).toBe(true);
    expect(otpRejectedBeforeSending({ status: 422 })).toBe(true);
    expect(otpRejectedBeforeSending({ status: 500 })).toBe(false);
    expect(otpRejectedBeforeSending({ status: 0 })).toBe(false);
    expect(otpRejectedBeforeSending({})).toBe(false);
    expect(otpRejectedBeforeSending(null)).toBe(false);
  });
});

describe("mensajes del tope diario", () => {
  const read = (lang: string) =>
    JSON.parse(readFileSync(join(process.cwd(), "messages", `${lang}.json`), "utf8")).Login;

  it("es/en explican el tope y remiten a soporte, sin WhatsApp ni emojis", () => {
    const es = read("es");
    const en = read("en");
    expect(es.errDailySmsCap).toMatch(/mañana/);
    expect(es.errDailySmsCap).toMatch(/soporte/);
    expect(en.errDailySmsCap).toMatch(/tomorrow/);
    expect(en.errDailySmsCap).toMatch(/support/);
    for (const text of [es.errDailySmsCap, es.errDailySmsCapSupport, en.errDailySmsCap]) {
      expect(text).not.toMatch(/whatsapp|telegram|botón verde/i);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(SUPPORT_PATH).toBe("/soporte");
    expect(DAILY_SMS_CAP_CODE).toBe("daily_sms_cap");
  });
});

describe("POST /api/auth/start-otp", () => {
  async function loadRoute() {
    vi.resetModules();
    vi.doMock("@/lib/supabase/auth-ip", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/supabase/auth-ip")>();
      return { ...actual, createAuthClient: route.createAuthClient };
    });
    return import("@/app/api/auth/start-otp/route");
  }

  function startRequest(extraHeaders: Record<string, string> = {}) {
    return new NextRequest("https://lapollacolombiana.com/api/auth/start-otp", {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify({ phone: "+57 300 111 2233" }),
    });
  }

  beforeEach(() => {
    route.checkIpRateLimit.mockResolvedValue({ blocked: false, remaining: 0 });
    route.checkDailySmsCap.mockResolvedValue({ blocked: false, remaining: 2 });
    route.checkAndRecordAttempt.mockResolvedValue({
      blocked: false,
      remaining: 4,
      attemptId: "attempt-1",
    });
    route.releaseGenerateAttempt.mockResolvedValue(undefined);
    route.signInWithOtp.mockResolvedValue({ error: null });
    route.createAuthClient.mockReturnValue({ signInWithOtp: route.signInWithOtp });
  });

  it("tope diario: 429 con código estable, enlace a soporte y sin WhatsApp", async () => {
    route.checkDailySmsCap.mockResolvedValue({ blocked: true, remaining: 0 });
    const { POST } = await loadRoute();
    const res = await POST(startRequest({ "x-real-ip": "190.25.1.7" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("daily_sms_cap");
    expect(body.supportPath).toBe("/soporte");
    expect(body.useWhatsapp).toBeUndefined();
    expect(body.error).not.toMatch(/whatsapp|botón verde/i);
    expect(route.checkAndRecordAttempt).not.toHaveBeenCalled();
    expect(route.signInWithOtp).not.toHaveBeenCalled();
  });

  it("envío aceptado: usa la IP real para el límite propio y para Supabase, y no libera", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      startRequest({ "x-real-ip": "190.25.1.7", "x-forwarded-for": "190.25.1.7" }),
    );
    expect(res.status).toBe(200);
    expect(route.checkIpRateLimit).toHaveBeenCalledWith("190.25.1.7");
    expect(route.checkAndRecordAttempt).toHaveBeenCalledWith("573001112233", "generate", "190.25.1.7");
    expect(route.createAuthClient).toHaveBeenCalledWith("190.25.1.7");
    expect(route.releaseGenerateAttempt).not.toHaveBeenCalled();
  });

  it("429 de Supabase: no gasta el cupo diario (libera el intento grabado)", async () => {
    route.signInWithOtp.mockResolvedValue({
      error: { status: 429, message: "email rate limit exceeded", code: "over_request_rate_limit" },
    });
    const { POST } = await loadRoute();
    const res = await POST(startRequest({ "x-real-ip": "190.25.1.7" }));
    expect(res.status).toBe(429);
    expect(route.releaseGenerateAttempt).toHaveBeenCalledWith("attempt-1");
  });

  it("5xx de Supabase: el intento sigue contando (el SMS pudo salir)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    route.signInWithOtp.mockResolvedValue({
      error: { status: 500, message: "Unexpected failure" },
    });
    const { POST } = await loadRoute();
    const res = await POST(startRequest({ "x-real-ip": "190.25.1.7" }));
    expect(res.status).toBe(500);
    expect(route.releaseGenerateAttempt).not.toHaveBeenCalled();
  });

  it("captcha: pasa captchaToken a signInWithOtp tal cual", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new NextRequest("https://lapollacolombiana.com/api/auth/start-otp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "190.25.1.7" },
        body: JSON.stringify({ phone: "+57 300 111 2233", captchaToken: " tok.en_-123 " }),
      }),
    );
    expect(res.status).toBe(200);
    expect(route.signInWithOtp).toHaveBeenCalledWith({
      phone: "573001112233",
      options: { channel: "sms", captchaToken: "tok.en_-123" },
    });
  });

  it("captcha: sin token envía como antes (Supabase decide si la captcha está activa)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(startRequest({ "x-real-ip": "190.25.1.7" }));
    expect(res.status).toBe(200);
    expect(route.signInWithOtp).toHaveBeenCalledWith({
      phone: "573001112233",
      options: { channel: "sms" },
    });
  });

  it("captcha: token malformado no viaja a Supabase", async () => {
    const { POST } = await loadRoute();
    await POST(
      new NextRequest("https://lapollacolombiana.com/api/auth/start-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+57 300 111 2233", captchaToken: "con espacio" }),
      }),
    );
    expect(route.signInWithOtp).toHaveBeenCalledWith({
      phone: "573001112233",
      options: { channel: "sms" },
    });
  });

  it("captcha rechazada por Supabase: 403 con código estable y libera el intento", async () => {
    route.signInWithOtp.mockResolvedValue({
      error: {
        status: 400,
        code: "captcha_failed",
        message: "captcha protection: request disallowed (no captcha response (captcha_token) found in request)",
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(startRequest({ "x-real-ip": "190.25.1.7" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("captcha_failed");
    expect(body.error).not.toMatch(/captcha_token|disallowed/);
    expect(route.releaseGenerateAttempt).toHaveBeenCalledWith("attempt-1");
  });

  it("límite por teléfono bloqueado: ni Supabase ni liberación", async () => {
    route.checkAndRecordAttempt.mockResolvedValue({ blocked: true, remaining: 0 });
    const { POST } = await loadRoute();
    const res = await POST(startRequest());
    expect(res.status).toBe(429);
    expect(route.signInWithOtp).not.toHaveBeenCalled();
    expect(route.releaseGenerateAttempt).not.toHaveBeenCalled();
  });
});

describe("rutas de sesión: solo Auth con IP real, nunca el cliente de datos", () => {
  const files = [
    "app/api/auth/start-otp/route.ts",
    "app/api/auth/verify-otp/route.ts",
    "app/api/auth/wa-magic/route.ts",
    // Telegram v2: las rutas de solicitud y enlace abren sesión por aquí.
    "lib/auth/telegram-login/session.ts",
    "lib/auth/phone-session.ts",
  ];

  it.each(files)("%s llama a Auth por lib/supabase/auth-ip", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toMatch(/from "@\/lib\/supabase\/auth-ip"/);
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(source).not.toMatch(/from "@\/lib\/supabase\/server"/);
    expect(source).not.toMatch(/\.auth\.(verifyOtp|signInWithOtp|signOut)\(/);
  });

  // lib/auth/phone-session.ts abre la sesión de WhatsApp y Telegram: cada ruta
  // le pasa la IP del request para que Supabase no vea la IP de Vercel.
  it.each([
    "app/api/auth/wa-magic/route.ts",
    "lib/auth/telegram-login/session.ts",
  ])("%s pasa la IP real a startSessionForVerifiedPhone", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toMatch(/getClientIp\(request\.headers\)/);
    expect(source).toMatch(/clientIp/);
  });

  // La única vía de sesión de Telegram v2 es el enlace de un solo uso.
  it("app/api/auth/telegram/link/route.ts abre sesión solo con startTelegramSession", () => {
    const source = readFileSync(join(process.cwd(), "app/api/auth/telegram/link/route.ts"), "utf8");
    expect(source).toMatch(/startTelegramSession\(request,/);
    expect(source).not.toMatch(/from "@\/lib\/supabase\/server"/);
    expect(source).not.toMatch(/\.auth\.(verifyOtp|signInWithOtp|signOut)\(/);
  });

  // complete/ abría la sesión de quien aprobaba en Telegram en el navegador que
  // creó la solicitud (phishing tipo device code): retirado antes de producción.
  it.each([
    "app/api/auth/telegram-link/route.ts",
    "app/api/auth/telegram-verify/route.ts",
    "app/api/auth/telegram/request/complete/route.ts",
    "app/api/auth/telegram/request/status/route.ts",
    "app/api/auth/telegram/request/route.ts",
  ])(
    "%s (retirado o sin sesión) no abre sesión",
    (file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/startSessionForVerifiedPhone|startTelegramSession/);
      if (!file.includes("/request/status/") && file !== "app/api/auth/telegram/request/route.ts") {
        expect(source).not.toMatch(/createAdminClient/);
      }
    },
  );
});
