// tests/cron-auth.test.ts — Los crons de GitHub Actions llegan a su handler
// (sin 307 a /login) y el handler rechaza cualquier llamada sin el secreto
// ANTES de crear el admin client.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAdminClient: vi.fn(() => {
    throw new Error("admin client must not be created in this test");
  }),
  collectPollaHealth: vi.fn(),
  whatsappOutboundEnabled: vi.fn(() => false),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/admin/polla-health", () => ({ collectPollaHealth: mocks.collectPollaHealth }));
vi.mock("@/lib/whatsapp/outbound", () => ({
  whatsappOutboundEnabled: mocks.whatsappOutboundEnabled,
  WHATSAPP_OUTBOUND_DISABLED: "WHATSAPP_OUTBOUND_DISABLED",
}));

import { cronSecretMatches, requireCronSecret } from "@/lib/auth/cron-secret";
import { updateSession } from "@/lib/supabase/middleware";
import { proxy } from "@/proxy";
import { POST as adminDiscrepancies } from "@/app/api/cron/admin-discrepancies-email/route";
import { POST as backupFreshness } from "@/app/api/cron/backup-freshness/route";
import { POST as cleanupProofs } from "@/app/api/cron/cleanup-payout-proofs/route";
import { POST as matchReminders } from "@/app/api/cron/match-reminders/route";
import { POST as telegramLoginBotProfile } from "@/app/api/cron/telegram-login-bot-profile/route";

const SECRET = "test-cron-secret-0123456789";
const ORIGINAL_SECRET = process.env.CRON_SECRET;

const handlers = [
  ["admin-discrepancies-email", adminDiscrepancies],
  ["backup-freshness", backupFreshness],
  ["cleanup-payout-proofs", cleanupProofs],
  ["match-reminders", matchReminders],
  ["telegram-login-bot-profile", telegramLoginBotProfile],
] as const;

function cronRequest(name: string, authorization?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== undefined) headers.Authorization = authorization;
  return new NextRequest(`http://localhost/api/cron/${name}`, { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.whatsappOutboundEnabled.mockReturnValue(false);
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("middleware: /api/cron/ se autentica solo", () => {
  it.each(handlers.map(([name]) => name))(
    "no redirige ni consulta la sesión en /api/cron/%s",
    async (name) => {
      const response = await updateSession(cronRequest(name));
      expect(response.status).not.toBe(307);
      expect(response.headers.get("location")).toBeNull();
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );

  it("el proxy raíz tampoco redirige /api/cron/*", async () => {
    const response = await proxy(
      new NextRequest("https://lapollacolombiana.com/api/cron/match-reminders", {
        method: "POST",
        headers: { host: "lapollacolombiana.com" },
      }),
    );
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    "/api/cron",
    "/api/cronologia",
    "/api/cronjobs/x",
    "/api/cron/%2e%2e/pollas/demo",
    "/casa",
    "/casa/demo/pagar",
    "/casa/admin",
    "/api/casa/pollas/demo/otra-cosa",
  ])("sigue protegiendo %s con el gate de sesión", async (path) => {
    const response = await updateSession(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?returnTo=");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("conserva la exención JSON de match-picks", async () => {
    const response = await updateSession(
      new NextRequest("http://localhost/api/casa/pollas/demo/match-picks?match=x"),
    );
    expect(response.status).not.toBe(307);
  });
});

describe("requireCronSecret en los handlers", () => {
  describe.each(handlers)("%s", (_name, handler) => {
    it.each([
      ["sin header", undefined],
      ["header vacío", ""],
      ["secreto sin Bearer", SECRET],
      ["bearer en minúscula", `bearer ${SECRET}`],
      ["doble espacio", `Bearer  ${SECRET}`],
      ["secreto incorrecto", "Bearer otro-secreto"],
      ["prefijo del secreto", `Bearer ${SECRET.slice(0, -1)}`],
      ["secreto con sufijo", `Bearer ${SECRET}x`],
      ["otro esquema", `Basic ${SECRET}`],
    ])("responde 403 con %s", async (_label, authorization) => {
      const response = await handler(cronRequest(_name, authorization));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
      expect(mocks.collectPollaHealth).not.toHaveBeenCalled();
    });

    it("responde 500 si falta CRON_SECRET, aun con header", async () => {
      delete process.env.CRON_SECRET;
      const response = await handler(cronRequest(_name, `Bearer ${SECRET}`));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "CRON_SECRET not configured" });
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("responde 500 si CRON_SECRET está vacío", async () => {
      process.env.CRON_SECRET = "  ";
      const response = await handler(cronRequest(_name, "Bearer   "));
      expect(response.status).toBe(500);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });
  });

  it("deja pasar el secreto correcto (match-reminders con WhatsApp apagado)", async () => {
    const response = await matchReminders(cronRequest("match-reminders", `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, disabled: true, sent: 0 });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("cronSecretMatches / requireCronSecret", () => {
  it("compara exacto y falla cerrado sin CRON_SECRET", () => {
    expect(cronSecretMatches(SECRET)).toBe(true);
    expect(cronSecretMatches(`${SECRET} `)).toBe(false);
    expect(cronSecretMatches("")).toBe(false);
    expect(cronSecretMatches(null)).toBe(false);
    delete process.env.CRON_SECRET;
    expect(cronSecretMatches(SECRET)).toBe(false);
    expect(cronSecretMatches("")).toBe(false);
  });

  it("devuelve null solo con Bearer + secreto correcto", () => {
    const ok = new Request("http://localhost/api/cron/x", {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(requireCronSecret(ok)).toBeNull();
    const bad = requireCronSecret(new Request("http://localhost/api/cron/x"));
    expect(bad?.status).toBe(403);
    expect(bad?.headers.get("cache-control")).toBe("no-store");
  });
});

describe("guard estático: toda ruta de app/api/cron exige el secreto", () => {
  const root = join(process.cwd(), "app", "api", "cron");

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return routeFiles(full);
      return /^route\.(ts|tsx|js|mjs)$/.test(entry) ? [full] : [];
    });
  }

  const files = routeFiles(root);

  it("encuentra las rutas de cron", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.some((file) => /telegram-login-bot-profile[\\/]route\.ts$/.test(file))).toBe(true);
    expect(files.some((file) => /backup-freshness[\\/]route\.ts$/.test(file))).toBe(true);
  });

  it.each(files.map((file) => [file.slice(root.length + 1), file]))(
    "%s llama requireCronSecret(request) en cada handler",
    (_label, file) => {
      const source = readFileSync(file, "utf8");
      const handlers = source.match(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g) ?? [];
      const guards = source.match(/requireCronSecret\(request\)/g) ?? [];
      expect(handlers.length).toBeGreaterThan(0);
      expect(guards.length).toBeGreaterThanOrEqual(handlers.length);
      expect(source).not.toMatch(/Bearer \$\{expected\}/);
    },
  );
});
