// tests/cron-admin-discrepancies-email.test.ts — El cron del email diario no
// puede quedar en verde si Resend rechazó el envío. En resend 6.x,
// emails.send() no lanza: devuelve { data: null, error }. Sin revisar ese
// error, la ruta respondía 200 {ok:true, sent:true} y el workflow de GitHub
// Actions confirmaba un correo que nunca salió.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  collectPollaHealth: vi.fn(),
  matchesEnJuego: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
vi.mock("@/lib/admin/polla-health", () => ({ collectPollaHealth: mocks.collectPollaHealth }));
vi.mock("@/lib/matches/en-juego", () => ({ matchesEnJuego: mocks.matchesEnJuego }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/cron/admin-discrepancies-email/route";

const SECRET = "test-cron-secret-0123456789";
const ENV_KEYS = ["CRON_SECRET", "ADMIN_ALERT_EMAIL", "RESEND_API_KEY", "RESEND_FROM_EMAIL"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function authorizedRequest() {
  return new NextRequest("http://localhost/api/cron/admin-discrepancies-email", {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  process.env.RESEND_API_KEY = "re_test_dummy";
  delete process.env.RESEND_FROM_EMAIL;
  mocks.createAdminClient.mockReturnValue({});
  mocks.collectPollaHealth.mockResolvedValue({
    stuckPollas: [{ name: "Polla demo", slug: "polla-demo", participantCount: 3 }],
    endedNoPayouts: [],
  });
  mocks.matchesEnJuego.mockResolvedValue({ filas: [] });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("POST /api/cron/admin-discrepancies-email", () => {
  it.each([
    ["403 de Resend", { name: "validation_error", statusCode: 403, message: "domain example.org is not verified" }],
    ["422 de Resend", { name: "invalid_parameter", statusCode: 422, message: "Invalid `to` field" }],
    ["fallo de red", { name: "application_error", statusCode: null, message: "Unable to fetch data." }],
  ])("responde 502 sin ok:true cuando Resend devuelve error (%s)", async (_label, error) => {
    mocks.send.mockResolvedValue({ data: null, error, headers: {} });

    const response = await POST(authorizedRequest());
    const body = await response.json();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "email send failed" });
    // El log del workflow es público: nada del proveedor en el body.
    expect(JSON.stringify(body)).not.toContain(error.message);
  });

  it("responde 200 sent:true solo cuando Resend confirma el envío", async () => {
    mocks.send.mockResolvedValue({ data: { id: "email-id" }, error: null, headers: {} });

    const response = await POST(authorizedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      sent: true,
      counts: { stuckPollas: 1, endedNoPayouts: 0, matchDiscrepancies: 0 },
    });
  });

  it("no llama a Resend cuando no hay nada que reportar", async () => {
    mocks.collectPollaHealth.mockResolvedValue({ stuckPollas: [], endedNoPayouts: [] });

    const response = await POST(authorizedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sent: false, reason: "no items" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
