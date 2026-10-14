// tests/root-home-middleware.test.ts — La lista de pollas vive en `/` desde el
// 2026-10-14. Sin sesión, el enlace limpio va a /login sin returnTo (ese ya es
// el destino por defecto) y, con sesión, `/` pasa por el gate de onboarding
// como cualquier otra pantalla: antes `/` solo redirigía y estaba exenta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), profile: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";

const page = (path: string, cookie?: string) =>
  updateSession(new NextRequest(`https://lapollacolombiana.com${path}`, cookie ? { headers: { cookie } } : undefined));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.profile.mockResolvedValue({ data: { display_name: "Ana", avatar_url: "millos" } });
});

describe("middleware: la raíz es la lista de pollas", () => {
  it("sin sesión, / va a /login sin returnTo", async () => {
    const response = await page("/");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://lapollacolombiana.com/login");
  });

  it("sin sesión, el resto conserva su returnTo", async () => {
    const response = await page("/polla/ofigolazo/pagar");
    expect(response.headers.get("location")).toBe("https://lapollacolombiana.com/login?returnTo=%2Fpolla%2Fofigolazo%2Fpagar");
  });

  it("con sesión, /login sin returnTo lleva a /", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const response = await page("/login");
    expect(response.headers.get("location")).toBe("https://lapollacolombiana.com/");
  });

  it("con sesión y perfil completo, / se sirve", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const response = await page("/");
    expect(response.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });

  it("con sesión y sin pollito, / pasa primero por onboarding", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.profile.mockResolvedValue({ data: { display_name: "Ana", avatar_url: null } });
    const response = await page("/");
    expect(response.headers.get("location")).toBe("https://lapollacolombiana.com/onboarding?returnTo=%2F");
  });
});
