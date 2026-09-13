// tests/telegram-login-middleware.test.ts — El webhook del bot de login por
// Telegram llega a su handler (sin 307 a /login), igual que los crons de
// /api/cron/ tras #62. Quien llama es Telegram, no un browser: si la exención
// se cae, cada update muere en el gate de sesión y el login deja de responder.
// La exención es EXACTA: rutas vecinas siguen detrás del gate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

function telegramUpdate(url: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "no-importa-para-el-middleware",
    },
    body: JSON.stringify({ update_id: 1 }),
  });
}

describe("middleware: webhook de login por Telegram", () => {
  it("no redirige POST /api/telegram/login sin sesión", async () => {
    const response = await updateSession(telegramUpdate("http://localhost/api/telegram/login"));
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("el proxy raíz tampoco lo redirige", async () => {
    const response = await proxy(
      new NextRequest("https://lapollacolombiana.com/api/telegram/login", {
        method: "POST",
        headers: { host: "lapollacolombiana.com" },
      }),
    );
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/api/telegram/login/otra", "/api/telegram/loginx", "/api/telegram"])(
    "sigue protegiendo %s con el gate de sesión",
    async (path) => {
      const response = await updateSession(telegramUpdate(`http://localhost${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/login?returnTo=");
    },
  );

  it("los endpoints de canje siguen públicos vía /api/auth", async () => {
    for (const path of ["/api/auth/telegram-link", "/api/auth/telegram-verify"]) {
      const response = await updateSession(new NextRequest(`http://localhost${path}`));
      expect(response.status).not.toBe(307);
    }
  });
});
