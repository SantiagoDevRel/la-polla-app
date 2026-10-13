// tests/casa-pagada.test.ts — (2026-10-13, pedido del dueño) 12 horas después
// de que una polla se acaba, el jugador la ve «Pagada» y en Terminadas de
// Inicio, sin esperar a que el administrador registre el reparto o el pago.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getPollaEndings } from "@/lib/casa/queries";
import { pagadaDesde, pagadaLabel, pollaFinishedAt, recentFirst, type CasaPolla } from "@/lib/casa/types";

const AHORA = Date.parse("2026-10-13T20:00:00Z");
const HORA = 3_600_000;
const hace = (horas: number) => new Date(AHORA - horas * HORA).toISOString();

const polla = (extra: Partial<CasaPolla> = {}) => ({
  status: "abierta",
  closes_at: hace(72),
  settled_at: null,
  settlement_outcome: null,
  draw_pending: false,
  ...extra,
}) as CasaPolla;

describe("cuándo se acabó una polla de partidos", () => {
  it("es el último resultado verificado", () => {
    expect(pollaFinishedAt([
      { final_verified_at: hace(30), voided_at: null },
      { final_verified_at: hace(20), voided_at: null },
    ])).toBe(hace(20));
  });

  it("no se acaba mientras a un partido vivo le falte el resultado", () => {
    expect(pollaFinishedAt([
      { final_verified_at: hace(30), voided_at: null },
      { final_verified_at: null, voided_at: null },
    ])).toBeNull();
  });

  it("un partido anulado cuenta como resuelto, en la hora en que se anuló", () => {
    expect(pollaFinishedAt([
      { final_verified_at: hace(30), voided_at: null },
      { final_verified_at: null, voided_at: hace(14) },
    ])).toBe(hace(14));
  });

  it("sin partidos vivos (todos anulados o ninguno) no hay final", () => {
    expect(pollaFinishedAt([{ final_verified_at: null, voided_at: hace(40) }])).toBeNull();
    expect(pollaFinishedAt([])).toBeNull();
  });
});

describe("«Pagada» 12 horas después de acabarse", () => {
  it("aparece a las 12 horas, no antes", () => {
    expect(pagadaDesde(polla(), hace(11.99), AHORA)).toBeNull();
    expect(pagadaDesde(polla(), hace(12), AHORA)).toBe(hace(12));
  });

  it("no espera al reparto: aplica también a una polla abierta o cerrada sin registrar", () => {
    expect(pagadaDesde(polla({ status: "cerrada" }), hace(13), AHORA)).toBe(hace(13));
  });

  it("una polla resuelta sin partidos (preguntas, rifa) cuenta desde el reparto", () => {
    expect(pagadaDesde(polla({ status: "resuelta", settled_at: hace(5) }), null, AHORA)).toBeNull();
    expect(pagadaDesde(polla({ status: "resuelta", settled_at: hace(15) }), null, AHORA)).toBe(hace(15));
  });

  it("una polla sin terminar nunca sale «Pagada»", () => {
    expect(pagadaDesde(polla(), null, AHORA)).toBeNull();
    expect(pagadaDesde(polla({ status: "cerrada", settled_at: hace(40) }), null, AHORA)).toBeNull();
  });

  it("no aplica a anuladas, desempates pendientes ni pollas donde nadie sumó puntos", () => {
    expect(pagadaDesde(polla({ status: "anulada" }), hace(40), AHORA)).toBeNull();
    expect(pagadaDesde(polla({ status: "cerrada", draw_pending: true }), hace(40), AHORA)).toBeNull();
    expect(pagadaDesde(polla({ status: "resuelta", settled_at: hace(30), settlement_outcome: "house_retained_zero_points" }), hace(40), AHORA)).toBeNull();
  });

  it("no aplica mientras sigan abiertas las inscripciones", () => {
    expect(pagadaDesde(polla({ closes_at: new Date(AHORA + HORA).toISOString() }), hace(40), AHORA)).toBeNull();
  });
});

describe("orden de Terminadas (2026-10-13, pedido del dueño)", () => {
  const p = (id: string, closes: number, settled: number | null = null) =>
    ({ id, closes_at: hace(closes), settled_at: settled === null ? null : hace(settled) }) as CasaPolla;

  it("la más reciente primero, por cuándo se acabó", () => {
    const vieja = p("vieja", 400), nueva = p("nueva", 300);
    expect(recentFirst([vieja, nueva], { vieja: hace(200), nueva: hace(100) }).map((x) => x.id)).toEqual(["nueva", "vieja"]);
  });

  it("sin final cae al reparto y después al cierre de inscripciones", () => {
    const repartida = p("repartida", 500, 50), enJuego = p("en-juego", 20), terminada = p("terminada", 300);
    expect(recentFirst([terminada, repartida, enJuego], { terminada: hace(100) }).map((x) => x.id))
      .toEqual(["en-juego", "repartida", "terminada"]);
  });

  it("no cambia la lista original", () => {
    const lista = [p("a", 300), p("b", 100)];
    recentFirst(lista, {});
    expect(lista.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("etiqueta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AHORA));
  });
  afterEach(() => vi.useRealTimers());

  it("dice Pagada y la fecha en Colombia, en verde", () => {
    // 11-oct 01:05 UTC = 10-oct 20:05 en Colombia.
    expect(pagadaLabel("2026-10-11T01:05:02Z")).toEqual({ text: "Pagada 10 oct", tone: "live" });
  });

  it("lleva el año solo si no es el actual", () => {
    expect(pagadaLabel("2025-12-20T18:00:00Z").text).toBe("Pagada 20 dic 2025");
  });
});

describe("getPollaEndings", () => {
  /** Simula PostgREST: filtra por polla, ordena y corta en la página pedida. */
  function fakeDb(rows: Array<{ polla_id: string; match_id: string; voided_at: string | null; final: string | null }>) {
    const calls: Array<{ ids: string[]; from: number; to: number }> = [];
    const db = {
      from: () => {
        let ids: string[] = [];
        const q = {
          select: () => q,
          in: (_column: string, values: string[]) => { ids = values; return q; },
          order: () => q,
          range: (from: number, to: number) => {
            calls.push({ ids, from, to });
            const data = rows
              .filter((row) => ids.includes(row.polla_id))
              .sort((a, b) => a.polla_id.localeCompare(b.polla_id) || a.match_id.localeCompare(b.match_id))
              .slice(from, to + 1)
              .map((row) => ({ polla_id: row.polla_id, match_id: row.match_id, voided_at: row.voided_at, match: { final_verified_at: row.final } }));
            return Promise.resolve({ data, error: null });
          },
        };
        return q;
      },
    };
    return { db, calls };
  }

  it("devuelve el final solo de las pollas terminadas", async () => {
    const { db } = fakeDb([
      { polla_id: "a", match_id: "1", voided_at: null, final: hace(20) },
      { polla_id: "a", match_id: "2", voided_at: null, final: hace(14) },
      { polla_id: "b", match_id: "3", voided_at: null, final: hace(20) },
      { polla_id: "b", match_id: "4", voided_at: null, final: null },
    ]);
    mocks.createAdminClient.mockReturnValue(db);
    await expect(getPollaEndings(["a", "b", "a"])).resolves.toEqual({ a: hace(14) });
  });

  it("pagina pasadas las 1000 filas: un partido sin resultado en la fila 1001 mantiene la polla en juego", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      polla_id: "grande", match_id: String(i).padStart(5, "0"), voided_at: null, final: i < 1000 ? hace(20) : null,
    }));
    const { db, calls } = fakeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);
    await expect(getPollaEndings(["grande"])).resolves.toEqual({});
    expect(calls.map((c) => c.from)).toEqual([0, 1000]);
  });

  it("consulta en lotes de 20 pollas", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `p${i}`);
    const { db, calls } = fakeDb([]);
    mocks.createAdminClient.mockReturnValue(db);
    await getPollaEndings(ids);
    expect(calls.map((c) => c.ids.length)).toEqual([20, 1]);
  });
});
