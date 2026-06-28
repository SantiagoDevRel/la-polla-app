import { describe, it, expect } from "vitest";
import {
  calculatePoints,
  calculatePointsGolesV2,
  phaseScoreMultiplier,
} from "./points";

// 5-tier scoring contract:
//   1) exact score → 5
//   2) correct winner + same goal diff → 3
//   3) correct winner only → 2
//   4) one team's score exact (wrong winner) → 1
//   5) nothing → 0

describe("calculatePoints", () => {
  it("tier 1: returns 5 for exact match", () => {
    expect(
      calculatePoints({ homeScore: 2, awayScore: 1 }, { homeScore: 2, awayScore: 1 }),
    ).toBe(5);
  });

  it("tier 1 also fires for 0-0", () => {
    expect(
      calculatePoints({ homeScore: 0, awayScore: 0 }, { homeScore: 0, awayScore: 0 }),
    ).toBe(5);
  });

  it("tier 2: correct winner + same goal diff → 3", () => {
    // Predicted home wins by 1, actual home wins by 1, scores differ.
    expect(
      calculatePoints({ homeScore: 3, awayScore: 2 }, { homeScore: 2, awayScore: 1 }),
    ).toBe(3);
  });

  it("tier 3: correct winner with different goal diff → 2", () => {
    // Predicted home wins by 2, actual home wins by 3.
    expect(
      calculatePoints({ homeScore: 2, awayScore: 0 }, { homeScore: 3, awayScore: 0 }),
    ).toBe(2);
  });

  it("tier 4: wrong winner but home score exact → 1", () => {
    // Predicted home win 2-0, actual away win 2-3. home matches.
    expect(
      calculatePoints({ homeScore: 2, awayScore: 0 }, { homeScore: 2, awayScore: 3 }),
    ).toBe(1);
  });

  it("tier 4: wrong winner but away score exact → 1", () => {
    expect(
      calculatePoints({ homeScore: 0, awayScore: 2 }, { homeScore: 3, awayScore: 2 }),
    ).toBe(1);
  });

  it("tier 5: completely wrong → 0", () => {
    expect(
      calculatePoints({ homeScore: 1, awayScore: 0 }, { homeScore: 0, awayScore: 3 }),
    ).toBe(0);
  });

  it("draw correct + same goal diff (0 vs 0) → tier 2 (3 pts)", () => {
    // Predicted 1-1, actual 2-2: both draw, diff=0, scores differ → tier 2.
    expect(
      calculatePoints({ homeScore: 1, awayScore: 1 }, { homeScore: 2, awayScore: 2 }),
    ).toBe(3);
  });

  it("respects custom scoring overrides", () => {
    expect(
      calculatePoints(
        { homeScore: 2, awayScore: 1 },
        { homeScore: 2, awayScore: 1 },
        { pointsExact: 10 },
      ),
    ).toBe(10);
  });
});

// goles_v2 ladder (Polla Mundialista de Pipe, migración 072):
//   5 exacto · 4 ganador+dif · 3 ganador+marcador · 2 ganador solo
//   1 marcador (ganador errado) · 0 nada
describe("calculatePointsGolesV2", () => {
  const v2 = calculatePointsGolesV2;

  it("5: marcador exacto", () => {
    expect(v2({ homeScore: 2, awayScore: 1 }, { homeScore: 2, awayScore: 1 })).toBe(5);
    expect(v2({ homeScore: 0, awayScore: 0 }, { homeScore: 0, awayScore: 0 })).toBe(5);
  });

  it("4: ganador + misma diferencia (no exacto)", () => {
    // local gana por 1 en ambos, marcador distinto
    expect(v2({ homeScore: 3, awayScore: 2 }, { homeScore: 2, awayScore: 1 })).toBe(4);
    // empate predicho = empate real, dif 0=0
    expect(v2({ homeScore: 1, awayScore: 1 }, { homeScore: 2, awayScore: 2 })).toBe(4);
  });

  it("3: ganador correcto + acertó el marcador de un equipo (dif distinta)", () => {
    // 2-0 vs 2-1: gana local ambos, home 2=2, dif 2≠1
    expect(v2({ homeScore: 2, awayScore: 0 }, { homeScore: 2, awayScore: 1 })).toBe(3);
    // away: 0-2 vs 1-2: gana visitante ambos, away 2=2, dif distinta
    expect(v2({ homeScore: 0, awayScore: 2 }, { homeScore: 1, awayScore: 2 })).toBe(3);
  });

  it("2: ganador solo (ni diferencia ni marcador)", () => {
    // 3-0 vs 2-1: gana local ambos, dif 3≠1, ningún marcador coincide
    expect(v2({ homeScore: 3, awayScore: 0 }, { homeScore: 2, awayScore: 1 })).toBe(2);
  });

  it("1: acertó un marcador pero erró el ganador", () => {
    // 2-3 (gana visitante) vs 2-1 (gana local): home 2=2
    expect(v2({ homeScore: 2, awayScore: 3 }, { homeScore: 2, awayScore: 1 })).toBe(1);
  });

  it("0: nada", () => {
    expect(v2({ homeScore: 0, awayScore: 3 }, { homeScore: 2, awayScore: 1 })).toBe(0);
  });

  it("calculatePoints(mode='goles_v2') delega en la escalera v2", () => {
    // ganador+dif: classic da 3, v2 da 4
    const pred = { homeScore: 3, awayScore: 2 };
    const res = { homeScore: 2, awayScore: 1 };
    expect(calculatePoints(pred, res)).toBe(3);
    expect(calculatePoints(pred, res, undefined, "goles_v2")).toBe(4);
  });
});

// "Puntos dobles desde octavos" (migración 074). El multiplicador envuelve
// el scorer base: octavos+ = base x2 si la polla aprobó el doble. Debe
// quedar 1:1 con public.score_match / public.rescore_polla.
describe("phaseScoreMultiplier", () => {
  it("sin doble activo → siempre x1 (cualquier fase)", () => {
    expect(phaseScoreMultiplier("round_of_16", false)).toBe(1);
    expect(phaseScoreMultiplier("final", false)).toBe(1);
    expect(phaseScoreMultiplier("round_of_16", null)).toBe(1);
    expect(phaseScoreMultiplier("final", undefined)).toBe(1);
  });

  it("con doble activo → x2 SOLO de octavos en adelante", () => {
    expect(phaseScoreMultiplier("round_of_16", true)).toBe(2); // octavos
    expect(phaseScoreMultiplier("quarter_finals", true)).toBe(2);
    expect(phaseScoreMultiplier("semi_finals", true)).toBe(2);
    expect(phaseScoreMultiplier("third_place", true)).toBe(2);
    expect(phaseScoreMultiplier("final", true)).toBe(2);
  });

  it("con doble activo → 16vos y grupos NO se doblan (x1)", () => {
    expect(phaseScoreMultiplier("round_of_32", true)).toBe(1); // dieciseisavos
    expect(phaseScoreMultiplier("group_stage", true)).toBe(1);
  });

  it("fase null/desconocida → x1 aunque el doble esté activo", () => {
    expect(phaseScoreMultiplier(null, true)).toBe(1);
    expect(phaseScoreMultiplier("", true)).toBe(1);
    expect(phaseScoreMultiplier("league_stage", true)).toBe(1);
  });

  it("composición base x multiplicador: marcador exacto en octavos 5 → 10", () => {
    const pred = { homeScore: 2, awayScore: 1 };
    const res = { homeScore: 2, awayScore: 1 };
    const base = calculatePoints(pred, res); // 5
    expect(base * phaseScoreMultiplier("round_of_16", true)).toBe(10);
    // mismo marcador en 16vos: sigue 5 (no se dobla)
    expect(base * phaseScoreMultiplier("round_of_32", true)).toBe(5);
  });

  it("composición con goles_v2: ganador+dif en cuartos 4 → 8", () => {
    const pred = { homeScore: 3, awayScore: 2 };
    const res = { homeScore: 2, awayScore: 1 };
    const base = calculatePoints(pred, res, undefined, "goles_v2"); // 4
    expect(base * phaseScoreMultiplier("quarter_finals", true)).toBe(8);
  });
});
