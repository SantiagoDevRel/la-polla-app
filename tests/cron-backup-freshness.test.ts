// tests/cron-backup-freshness.test.ts — alerta de backup atrasado.
//
// La ruta lee public.backup_runs (migración 117) y escribe al admin si el
// último backup bueno tiene más de 7 h o la última verificación buena más de
// 30 h. Casos: al día, atrasado → correo, sin filas → correo, Resend falla →
// 502, sin secreto → 403 sin tocar la DB.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { BackupRunRow } from "@/lib/backup/freshness";

type Filters = Record<string, string>;
type Resolver = (filters: Filters) => { data: BackupRunRow | null; error: { code?: string } | null };

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  resolver: { current: null as unknown as Resolver },
  calls: [] as Array<{ table: string; columns: string; filters: Filters; order?: string }>,
  createAdminClient: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/cron/backup-freshness/route";
import {
  ageHours,
  buildBackupAlertEmail,
  evaluateFreshness,
  parseMaxAgeHours,
} from "@/lib/backup/freshness";

function fakeAdmin() {
  return {
    from(table: string) {
      const call = { table, columns: "", filters: {} as Filters, order: undefined as string | undefined };
      mocks.calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: string) {
          call.filters[column] = value;
          return builder;
        },
        order(column: string, opts: { ascending: boolean }) {
          call.order = `${column}:${opts.ascending ? "asc" : "desc"}`;
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => mocks.resolver.current(call.filters),
      };
      return builder;
    },
  };
}

const NOW = new Date("2026-09-13T20:00:00Z");
const SECRET = "test-cron-secret-0123456789";
const ENV_KEYS = [
  "CRON_SECRET",
  "ADMIN_ALERT_EMAIL",
  "FEEDBACK_NOTIFY_EMAIL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "BACKUP_MAX_AGE_HOURS",
  "BACKUP_VERIFY_MAX_AGE_HOURS",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function run(overrides: Partial<BackupRunRow> & Pick<BackupRunRow, "kind" | "status" | "finished_at">): BackupRunRow {
  return {
    started_at: overrides.finished_at,
    snapshot_name: overrides.kind === "backup" ? "2026-09-13-17-10.tar.zst.gpg" : null,
    bytes: null,
    tables: 58,
    rows: 40452,
    auth_users: 297,
    storage_objects: 119,
    runner_commit: "e88580a1b2c3",
    error: null,
    ...overrides,
  };
}

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** Tabla en memoria: la última fila por (kind, status) y la última por kind. */
function table(rows: BackupRunRow[]): Resolver {
  return (filters) => {
    const match = rows
      .filter((r) => r.kind === filters.kind && (!filters.status || r.status === filters.status))
      .sort((a, b) => b.finished_at.localeCompare(a.finished_at));
    return { data: match[0] ?? null, error: null };
  };
}

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== undefined) headers.Authorization = authorization;
  return new NextRequest("http://localhost/api/cron/backup-freshness", { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.calls.length = 0;
  mocks.createAdminClient.mockImplementation(fakeAdmin);
  mocks.send.mockResolvedValue({ data: { id: "email-id" }, error: null, headers: {} });
  process.env.CRON_SECRET = SECRET;
  process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  process.env.RESEND_API_KEY = "re_test_dummy";
  delete process.env.FEEDBACK_NOTIFY_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.BACKUP_MAX_AGE_HOURS;
  delete process.env.BACKUP_VERIFY_MAX_AGE_HOURS;
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("POST /api/cron/backup-freshness", () => {
  it("al día: 200 stale:false y no manda correo", async () => {
    mocks.resolver.current = table([
      run({ kind: "backup", status: "ok", finished_at: hoursAgo(2) }),
      run({ kind: "verify", status: "ok", finished_at: hoursAgo(10) }),
    ]);

    const response = await POST(cronRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      stale: false,
      age_hours: 2,
      verify_stale: false,
      verify_age_hours: 10,
      sent: false,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    // Columnas explícitas y orden por finished_at desc.
    for (const call of mocks.calls) {
      expect(call.table).toBe("backup_runs");
      expect(call.columns).not.toContain("*");
      expect(call.columns).toContain("finished_at");
      expect(call.order).toBe("finished_at:desc");
    }
    expect(mocks.calls.map((c) => c.filters)).toEqual(
      expect.arrayContaining([
        { kind: "backup", status: "ok" },
        { kind: "backup" },
        { kind: "verify", status: "ok" },
        { kind: "verify" },
      ]),
    );
  });

  it("backup viejo (> 7 h): correo con el último fallo y 200 stale:true", async () => {
    mocks.resolver.current = table([
      run({ kind: "backup", status: "ok", finished_at: hoursAgo(8.44) }),
      run({
        kind: "backup",
        status: "failed",
        finished_at: hoursAgo(2),
        snapshot_name: null,
        error: "fase preflight: archivo de entorno inválido",
      }),
      run({ kind: "verify", status: "ok", finished_at: hoursAgo(5) }),
    ]);

    const response = await POST(cronRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      stale: true,
      age_hours: 8.4,
      verify_stale: false,
      verify_age_hours: 5,
      sent: true,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const email = mocks.send.mock.calls[0][0];
    expect(email.to).toBe("admin@example.com");
    expect(email.subject).toBe("Backup de La Polla atrasado");
    expect(email.text).toContain("Backup cifrado (cada 6 h en el DGX): ATRASADO");
    expect(email.text).toContain("fase preflight: archivo de entorno inválido");
    expect(email.text).toContain("Verificación de snapshots (una vez al día): al día");
  });

  it("verificación vieja (> 30 h) también avisa, en el mismo correo", async () => {
    mocks.resolver.current = table([
      run({ kind: "backup", status: "ok", finished_at: hoursAgo(1) }),
      run({ kind: "verify", status: "ok", finished_at: hoursAgo(31) }),
    ]);

    const response = await POST(cronRequest(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, stale: false, verify_stale: true, verify_age_hours: 31, sent: true });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].text).toContain("Verificación de snapshots (una vez al día): ATRASADO");
  });

  it("sin filas: correo a FEEDBACK_NOTIFY_EMAIL si falta ADMIN_ALERT_EMAIL", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    process.env.FEEDBACK_NOTIFY_EMAIL = "feedback@example.com";
    mocks.resolver.current = table([]);

    const response = await POST(cronRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      stale: true,
      age_hours: null,
      verify_stale: true,
      verify_age_hours: null,
      sent: true,
    });
    const email = mocks.send.mock.calls[0][0];
    expect(email.to).toBe("feedback@example.com");
    expect(email.text).toContain("No hay ninguna corrida buena registrada.");
    expect(email.text).toContain("el runner no está escribiendo en backup_runs");
  });

  it("respeta BACKUP_MAX_AGE_HOURS", async () => {
    process.env.BACKUP_MAX_AGE_HOURS = "12";
    mocks.resolver.current = table([
      run({ kind: "backup", status: "ok", finished_at: hoursAgo(8) }),
      run({ kind: "verify", status: "ok", finished_at: hoursAgo(8) }),
    ]);

    const response = await POST(cronRequest(`Bearer ${SECRET}`));

    expect(await response.json()).toMatchObject({ stale: false, age_hours: 8, sent: false });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["403 de Resend", { name: "validation_error", statusCode: 403, message: "domain example.org is not verified" }],
    ["fallo de red", { name: "application_error", statusCode: null, message: "Unable to fetch data." }],
  ])("Resend devuelve error (%s) → 502 sin ok:true", async (_label, error) => {
    mocks.resolver.current = table([]);
    mocks.send.mockResolvedValue({ data: null, error, headers: {} });

    const response = await POST(cronRequest(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "email send failed" });
    expect(JSON.stringify(body)).not.toContain(error.message);
  });

  it("error de la DB (p. ej. migración sin aplicar) → 500 sin detalle y sin correo", async () => {
    mocks.resolver.current = () => ({ data: null, error: { code: "42P01" } });

    const response = await POST(cronRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "backup_runs query failed" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sin destinatario configurado → 500 antes de tocar la DB", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    delete process.env.FEEDBACK_NOTIFY_EMAIL;

    const response = await POST(cronRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "alert email not configured" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["sin header", undefined],
    ["secreto incorrecto", "Bearer otro-secreto"],
    ["secreto sin Bearer", SECRET],
  ])("%s → 403 sin tocar la DB ni Resend", async (_label, authorization) => {
    const response = await POST(cronRequest(authorization));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.calls).toHaveLength(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("lib/backup/freshness", () => {
  it("parseMaxAgeHours acepta números positivos razonables", () => {
    expect(parseMaxAgeHours(undefined, 7)).toBe(7);
    expect(parseMaxAgeHours("", 7)).toBe(7);
    expect(parseMaxAgeHours("9.5", 7)).toBe(9.5);
    expect(parseMaxAgeHours("0", 7)).toBe(7);
    expect(parseMaxAgeHours("-3", 7)).toBe(7);
    expect(parseMaxAgeHours("abc", 7)).toBe(7);
    expect(parseMaxAgeHours("100000", 7)).toBe(7);
  });

  it("ageHours redondea a un decimal y no da horas negativas", () => {
    expect(ageHours(hoursAgo(7.04), NOW)).toBe(7);
    expect(ageHours(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe(0);
    expect(ageHours(null, NOW)).toBeNull();
    expect(ageHours("no es fecha", NOW)).toBeNull();
  });

  it("el límite es estricto: exactamente 7 h sigue al día", () => {
    const row = run({ kind: "backup", status: "ok", finished_at: hoursAgo(7) });
    expect(evaluateFreshness(row, row, 7, NOW).stale).toBe(false);
    const older = run({ kind: "backup", status: "ok", finished_at: hoursAgo(7.2) });
    expect(evaluateFreshness(older, older, 7, NOW).stale).toBe(true);
  });

  it("el correo no trae emojis ni voseo", () => {
    const empty = evaluateFreshness(null, null, 7, NOW);
    const { text } = buildBackupAlertEmail(empty, evaluateFreshness(null, null, 30, NOW));
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/\b(revisá|encendelo|sacá|corré|tenés|podés)\b/i);
  });
});
