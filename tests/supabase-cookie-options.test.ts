// tests/supabase-cookie-options.test.ts — Las cookies de sesión salen con
// Secure en producción, SameSite=Lax, Path=/, host-only y legibles por el
// cliente del navegador (sin HttpOnly). Se prueba con el @supabase/ssr real:
// verifyOtp contra un fetch falso escribe la sesión y se revisa el Set-Cookie.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onboardingCookieOptions,
  sessionCookieOptions,
} from "@/lib/supabase/cookie-options";

const ROOT = join(__dirname, "..");

function fakeSessionFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        access_token: "header.payload.signature",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "refresh-test",
        user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
}

async function setCookieHeaderFor(nodeEnv: string): Promise<string[]> {
  const response = NextResponse.next();
  const client = createServerClient("https://example.supabase.co", "anon-test", {
    cookieOptions: sessionCookieOptions(nodeEnv),
    global: { fetch: fakeSessionFetch() },
    cookies: {
      getAll: () => [],
      setAll: (rows) =>
        rows.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await client.auth.verifyOtp({ phone: "+570000000000", token: "000000", type: "sms" });
  expect(error).toBeNull();
  return response.headers.getSetCookie().filter((row) => row.startsWith("sb-"));
}

afterEach(() => vi.unstubAllEnvs());

describe("sessionCookieOptions", () => {
  it("marca Secure solo en producción y conserva lax + path /", () => {
    expect(sessionCookieOptions("production")).toEqual({ path: "/", sameSite: "lax", secure: true });
    expect(sessionCookieOptions("development")).toEqual({ path: "/", sameSite: "lax", secure: false });
    expect(sessionCookieOptions("test")).toEqual({ path: "/", sameSite: "lax", secure: false });
    expect(sessionCookieOptions(undefined).secure).toBe(false);
  });

  it("lee NODE_ENV por defecto", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it("nunca fija domain ni httpOnly en la sesión", () => {
    const options = sessionCookieOptions("production") as Record<string, unknown>;
    expect(options).not.toHaveProperty("domain");
    expect(options).not.toHaveProperty("httpOnly");
  });

  it("lp_onb es httpOnly, 30 días y Secure en producción", () => {
    expect(onboardingCookieOptions("production")).toEqual({
      path: "/",
      sameSite: "lax",
      secure: true,
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
    });
    expect(onboardingCookieOptions("development").secure).toBe(false);
  });
});

describe("Set-Cookie real de @supabase/ssr", () => {
  it("en producción la sesión sale Secure; SameSite=Lax; Path=/; sin Domain ni HttpOnly", async () => {
    const rows = await setCookieHeaderFor("production");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatch(/;\s*Secure/i);
      expect(row).toMatch(/;\s*SameSite=lax/i);
      expect(row).toMatch(/;\s*Path=\//i);
      expect(row).not.toMatch(/;\s*Domain=/i);
      expect(row).not.toMatch(/;\s*HttpOnly/i);
    }
  });

  it("en desarrollo (http://localhost) no agrega Secure", async () => {
    const rows = await setCookieHeaderFor("development");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toMatch(/;\s*Secure/i);
  });
});

describe("todos los clientes con cookies usan las opciones compartidas", () => {
  it.each([
    "lib/supabase/client.ts",
    "lib/supabase/server.ts",
    "lib/supabase/middleware.ts",
    "lib/supabase/auth-ip.ts",
  ])("%s pasa cookieOptions: sessionCookieOptions()", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    const clients = source.match(/create(Server|Browser)Client\(/g) ?? [];
    const withOptions = source.match(/cookieOptions: sessionCookieOptions\(\)/g) ?? [];
    expect(clients.length).toBeGreaterThan(0);
    expect(withOptions.length).toBe(clients.length);
  });

  it.each(["lib/supabase/middleware.ts", "lib/auth/phone-session.ts", "app/api/users/me/route.ts"])(
    "%s fija lp_onb con onboardingCookieOptions()",
    (file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).toContain('cookies.set("lp_onb", "1", onboardingCookieOptions())');
    },
  );
});
