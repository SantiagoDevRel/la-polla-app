// tests/whatsapp-avisos.test.ts — Piezas puras de los avisos de WhatsApp
// (lib/whatsapp/avisos.ts): baja/alta, saludo, tiempo al cierre y limpieza de
// parámetros que Meta rechazaría.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  cleanParam,
  firstNameFor,
  formatTimeLeft,
  isOptInText,
  isOptOutText,
  selectAllPages,
} from "@/lib/whatsapp/avisos";

describe("isOptOutText / isOptInText", () => {
  it.each(["BAJA", "baja", " Baja. ", "bajá", "STOP", "stop!", "darme de baja"])("«%s» da de baja", (text) => {
    expect(isOptOutText(text)).toBe(true);
    expect(isOptInText(text)).toBe(false);
  });

  it.each(["ALTA", "alta", "Alta!"])("«%s» vuelve a activar", (text) => {
    expect(isOptInText(text)).toBe(true);
    expect(isOptOutText(text)).toBe(false);
  });

  it.each(["hola", "la tabla baja mucho", "no quiero bajar", "2-1", "menu", ""])("«%s» no cambia nada", (text) => {
    expect(isOptOutText(text)).toBe(false);
    expect(isOptInText(text)).toBe(false);
  });
});

describe("firstNameFor", () => {
  it("usa el primer nombre", () => expect(firstNameFor("  Carlos  Andrés Pérez")).toBe("Carlos"));
  it("nunca devuelve vacío", () => {
    expect(firstNameFor(null)).toBe("hola");
    expect(firstNameFor("   ")).toBe("hola");
  });
});

describe("formatTimeLeft", () => {
  const min = 60_000;
  it.each([
    [30 * 1000, "1 minuto"],
    [40 * min, "40 minutos"],
    [59 * min, "59 minutos"],
    [60 * min, "1 hora"],
    [89 * min, "1 hora"],
    [95 * min, "2 horas"],
    [3 * 60 * min, "3 horas"],
  ])("%d ms → %s", (ms, text) => expect(formatTimeLeft(ms)).toBe(text));
});

describe("cleanParam", () => {
  it("quita saltos de línea, tabs y espacios repetidos", () => {
    expect(cleanParam("POLLA\nGOL\t 2026    final")).toBe("POLLA GOL 2026 final");
  });
  it("corta nombres muy largos", () => expect(cleanParam("x".repeat(100))).toHaveLength(60));
});

describe("selectAllPages", () => {
  it("sigue pidiendo mientras la página venga llena", async () => {
    const all = Array.from({ length: 5 }, (_, i) => i);
    const calls: Array<[number, number]> = [];
    const rows = await selectAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    }, 2);
    expect(rows).toEqual(all);
    expect(calls).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it("propaga el error de la consulta", async () => {
    await expect(selectAllPages(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
