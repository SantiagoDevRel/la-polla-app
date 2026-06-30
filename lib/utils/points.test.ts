import { describe, it, expect } from "vitest";
import {
  calculatePoints,
  calculatePointsGolesV2,
  phaseScoreMultiplier,
  effectiveResult,
  effectiveAdvancer,
  advanceBonus,
  type MatchOutcome,
  type KnockoutScoring,
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

// Modo "120' + avance" por polla (migración 077). Debe quedar 1:1 con
// public.score_match / public.rescore_polla.
const CUTOFF = "2026-06-30T00:00:00Z";
const AFTER = "2026-07-04T18:00:00Z"; // knockout posterior al cutoff
const BEFORE = "2026-06-20T18:00:00Z"; // partido previo al cutoff

describe("effectiveResult (score_120)", () => {
  const ko: MatchOutcome = {
    homeScore: 1, // 90'
    awayScore: 1,
    fulltimeHome: 2, // 120' (alargue)
    fulltimeAway: 1,
    scheduledAt: AFTER,
    phase: "quarter_finals",
  };

  it("score_120 OFF → usa el 90'", () => {
    expect(effectiveResult(ko, { score120: false, kcModeChangedAt: CUTOFF })).toEqual({
      homeScore: 1,
      awayScore: 1,
    });
  });

  it("score_120 ON + después del cutoff → usa el 120'", () => {
    expect(effectiveResult(ko, { score120: true, kcModeChangedAt: CUTOFF })).toEqual({
      homeScore: 2,
      awayScore: 1,
    });
  });

  it("score_120 ON pero ANTES del cutoff → usa el 90' (no retroactivo)", () => {
    const pre = { ...ko, scheduledAt: BEFORE };
    expect(effectiveResult(pre, { score120: true, kcModeChangedAt: CUTOFF })).toEqual({
      homeScore: 1,
      awayScore: 1,
    });
  });

  it("score_120 ON sin captura del 120' → COALESCE al 90'", () => {
    const noFt = { ...ko, fulltimeHome: null, fulltimeAway: null };
    expect(effectiveResult(noFt, { score120: true, kcModeChangedAt: CUTOFF })).toEqual({
      homeScore: 1,
      awayScore: 1,
    });
  });

  it("fase de grupos → siempre 90' aunque score_120 esté ON", () => {
    const group = { ...ko, phase: "group_stage" };
    expect(effectiveResult(group, { score120: true, kcModeChangedAt: CUTOFF })).toEqual({
      homeScore: 1,
      awayScore: 1,
    });
  });
});

describe("effectiveAdvancer", () => {
  it("usa la captura (matches.advancer) cuando existe", () => {
    expect(
      effectiveAdvancer({ homeScore: 1, awayScore: 1, advancer: "away" }),
    ).toBe("away");
  });

  it("deriva del 120' decisivo si no hay captura", () => {
    expect(
      effectiveAdvancer({ homeScore: 1, awayScore: 1, fulltimeHome: 2, fulltimeAway: 1 }),
    ).toBe("home");
  });

  it("deriva del 90' decisivo si no hay 120' ni captura", () => {
    expect(effectiveAdvancer({ homeScore: 0, awayScore: 2 })).toBe("away");
  });

  it("empate a 120' sin captura → null (penales, ganador desconocido)", () => {
    expect(
      effectiveAdvancer({ homeScore: 1, awayScore: 1, fulltimeHome: 1, fulltimeAway: 1 }),
    ).toBeNull();
  });
});

describe("advanceBonus (+1 plano)", () => {
  const kc: KnockoutScoring = { advanceBonus: true, advanceBonusFrom: CUTOFF };
  const ko: MatchOutcome = {
    homeScore: 1,
    awayScore: 1,
    fulltimeHome: 1,
    fulltimeAway: 1,
    advancer: "home", // ganó por penales
    scheduledAt: AFTER,
    phase: "round_of_16",
  };

  it("acertó quién avanza → +1", () => {
    expect(advanceBonus("home", ko, kc)).toBe(1);
  });

  it("erró quién avanza → 0", () => {
    expect(advanceBonus("away", ko, kc)).toBe(0);
  });

  it("sin pick → 0", () => {
    expect(advanceBonus(null, ko, kc)).toBe(0);
  });

  it("polla sin advance_bonus → 0", () => {
    expect(advanceBonus("home", ko, { advanceBonus: false, advanceBonusFrom: CUTOFF })).toBe(0);
  });

  it("antes del cutoff → 0 (no retroactivo)", () => {
    expect(advanceBonus("home", { ...ko, scheduledAt: BEFORE }, kc)).toBe(0);
  });

  it("fase de grupos → 0 (solo knockouts 16vos+)", () => {
    expect(advanceBonus("home", { ...ko, phase: "group_stage" }, kc)).toBe(0);
  });

  it("16vos (round_of_32) SÍ aplica → +1", () => {
    expect(advanceBonus("home", { ...ko, phase: "round_of_32" }, kc)).toBe(1);
  });

  it("final SÍ aplica (campeón) → +1", () => {
    expect(advanceBonus("home", { ...ko, phase: "final" }, kc)).toBe(1);
  });

  it("respeta su PROPIO cutoff (advance_bonus_from), distinto del de 120'", () => {
    // Cutoffs separados: 120' desde 30-jun, avance desde 02-jul.
    const kcSplit: KnockoutScoring = {
      advanceBonus: true,
      kcModeChangedAt: "2026-06-30T00:00:00Z",
      advanceBonusFrom: "2026-07-02T00:00:00Z",
    };
    // Partido el 01-jul (entre ambos cutoffs): el bonus AÚN no aplica.
    expect(advanceBonus("home", { ...ko, scheduledAt: "2026-07-01T18:00:00Z" }, kcSplit)).toBe(0);
    // Partido el 03-jul (después del cutoff del avance): sí aplica.
    expect(advanceBonus("home", { ...ko, scheduledAt: "2026-07-03T18:00:00Z" }, kcSplit)).toBe(1);
  });
});

// Composición completa estilo "La Polla de Carvalho": goles_v2 + x2 octavos
// + score_120 + advance_bonus. El +1 va POR FUERA del x2 (plano).
describe("composición Carvalho (goles_v2 + x2 + 120' + avance)", () => {
  const kc: KnockoutScoring = {
    score120: true,
    advanceBonus: true,
    kcModeChangedAt: CUTOFF,
    advanceBonusFrom: CUTOFF,
  };
  // Cuartos que se fue a alargue: 90' = 1-1, 120' = 2-1, avanzó el local.
  const ko: MatchOutcome = {
    homeScore: 1,
    awayScore: 1,
    fulltimeHome: 2,
    fulltimeAway: 1,
    advancer: "home",
    scheduledAt: AFTER,
    phase: "quarter_finals",
  };

  function total(pred: { homeScore: number; awayScore: number }, advancePick: "home" | "away" | null) {
    const base = calculatePoints(pred, effectiveResult(ko, kc), undefined, "goles_v2");
    return base * phaseScoreMultiplier(ko.phase, true) + advanceBonus(advancePick, ko, kc);
  }

  it("exacto al 120' (2-1) + acertó avance en cuartos → 5*2 + 1 = 11", () => {
    expect(total({ homeScore: 2, awayScore: 1 }, "home")).toBe(11);
  });

  it("el +1 NO se dobla: exacto 120' sin acertar avance → 5*2 = 10", () => {
    expect(total({ homeScore: 2, awayScore: 1 }, "away")).toBe(10);
  });

  it("si se puntuara por 90' (1-1), el pronóstico 2-1 valdría mucho menos", () => {
    // Contraste: con score_120 OFF, 2-1 vs 1-1 en goles_v2 = 1 (un marcador,
    // ganador errado) * 2 = 2, + avance 1 = 3. El 120' premia el acierto real.
    const base90 = calculatePoints(
      { homeScore: 2, awayScore: 1 },
      effectiveResult(ko, { ...kc, score120: false }),
      undefined,
      "goles_v2",
    );
    expect(base90 * phaseScoreMultiplier(ko.phase, true) + advanceBonus("home", ko, kc)).toBe(3);
  });
});
