// tests/discrepancias-desde-ofigolazo.test.ts — Lo anterior a OFIGOLAZO
// (13-sep-2026) no cuenta como discrepancia. Sin este corte, el email diario
// repetía para siempre las 38 pollas P2P del Mundial que quedaron `ended` sin
// filas en `polla_payouts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISCREPANCIAS_DESDE } from "@/lib/admin/discrepancy-cutoff";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  matchesEnJuego: vi.fn(),
  isCurrentUserAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/matches/en-juego", () => ({ matchesEnJuego: mocks.matchesEnJuego }));
vi.mock("@/lib/auth/admin", () => ({ isCurrentUserAdmin: mocks.isCurrentUserAdmin }));
vi.mock("@/lib/matches/af-cached-result", () => ({ cachedApiFootballResult: vi.fn() }));
vi.mock("@/lib/api-football/results", () => ({ readFinalResult: vi.fn() }));

import { collectPollaHealth } from "@/lib/admin/polla-health";
import { GET as discrepanciesGet } from "@/app/api/admin/discrepancies/route";

type Call = [string, ...unknown[]];

/** Builder de PostgREST que anota cada filtro y resuelve vacío. */
function recordingQuery(calls: Call[]) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "gte", "gt", "in", "not", "order"]) {
    q[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return q;
    };
  }
  q.then = (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) =>
    resolve({ data: [], count: 0, error: null });
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("corte de discrepancias en OFIGOLAZO", () => {
  it("es el 13-sep-2026 a las 00:00 de Colombia", () => {
    expect(new Date(DISCREPANCIAS_DESDE).toISOString()).toBe("2026-09-13T05:00:00.000Z");
  });

  it("polla-health solo mira pollas creadas desde el corte", async () => {
    const porTabla: Record<string, Call[][]> = {};
    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => {
        const calls: Call[] = [];
        (porTabla[table] ??= []).push(calls);
        return recordingQuery(calls);
      },
    });

    await expect(collectPollaHealth()).resolves.toEqual({ stuckPollas: [], endedNoPayouts: [] });

    const consultas = porTabla.pollas ?? [];
    expect(consultas).toHaveLength(2);
    for (const calls of consultas) {
      expect(calls).toContainEqual(["gte", "created_at", DISCREPANCIAS_DESDE]);
    }
  });

  it("/api/admin/discrepancies solo lista partidos desde el corte", async () => {
    mocks.isCurrentUserAdmin.mockResolvedValue(true);
    mocks.createAdminClient.mockReturnValue({});
    mocks.matchesEnJuego.mockResolvedValue({ filas: [], errores: [] });

    const response = await discrepanciesGet();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matches: [] });
    const filtros = mocks.matchesEnJuego.mock.calls[0][2] as (q: unknown) => unknown;
    const calls: Call[] = [];
    filtros(recordingQuery(calls));
    expect(calls).toContainEqual(["gte", "scheduled_at", DISCREPANCIAS_DESDE]);
  });
});
