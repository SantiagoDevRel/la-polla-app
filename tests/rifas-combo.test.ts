import { describe, expect, it } from "vitest";
import { comboAnswerSchema, comboKey, summarizeCombos } from "../lib/rifas/combo-shared";

describe("comboAnswerSchema", () => {
  it("acepta no ser de un combo sin nombre", () => {
    expect(comboAnswerSchema.parse({ in_combo: false })).toEqual({ in_combo: false });
  });
  it("limpia espacios del combo", () => {
    expect(comboAnswerSchema.parse({ in_combo: true, combo: "  La   45 " })).toEqual({ in_combo: true, combo: "La 45" });
  });
  it("exige el nombre si es de un combo", () => {
    expect(comboAnswerSchema.safeParse({ in_combo: true, combo: " a " }).success).toBe(false);
    expect(comboAnswerSchema.safeParse({ in_combo: true }).success).toBe(false);
    expect(comboAnswerSchema.safeParse({ in_combo: true, combo: "x".repeat(81) }).success).toBe(false);
    expect(comboAnswerSchema.safeParse({ in_combo: "si", combo: "La 45" }).success).toBe(false);
  });
});

describe("summarizeCombos", () => {
  it("agrupa el mismo combo escrito distinto y cuenta a quien no es de combo", () => {
    expect(comboKey("Rosales  ")).toBe(comboKey("rosáles"));
    const s = summarizeCombos([
      { name: "Ana", in_combo: true, combo: "Rosales" },
      { name: "Beto", in_combo: true, combo: "rosales" },
      { name: "Caro", in_combo: true, combo: "Rosales" },
      { name: "Dani", in_combo: true, combo: "La Iguaná" },
      { name: "Eli", in_combo: false, combo: null },
      { name: null, in_combo: true, combo: "la iguana" },
    ]);
    expect(s.answered).toBe(6);
    expect(s.inCombo).toBe(5);
    expect(s.groups).toEqual([
      { combo: "Rosales", people: ["Ana", "Beto", "Caro"] },
      { combo: "La Iguaná", people: ["Dani", "Sin nombre"] },
    ]);
  });
});
