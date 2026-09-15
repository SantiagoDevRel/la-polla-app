import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The payout dialog is a client island with its own fetches; the rules text is what is under test.
vi.mock("@/components/casa/PayoutAccountButton", () => ({ PayoutAccountButton: () => null }));

import { PollaInfo, type FixedPrizeThreshold } from "@/components/casa/PollaInfo";
import { ScoringModeBadge } from "@/components/casa/ScoringModeBadge";
import { TournamentIdentity } from "@/components/casa/TournamentIdentity";

type Rules = Parameters<typeof PollaInfo>[0]["polla"];
const base: Rules = {
  kind: "partidos", scoring_mode: "1x2", points_exact: 3, points_one_team: 1, points_result: 3,
  prize_kind: "pozo", prize_object: null, description: null, draw_method: null,
  pot_mode: "fijo", fixed_prize_cop: 1_000_000, house_cut_pct: 50,
};
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
// OFIGOLAZO (2026-09-15, migración 125): entrada $20.000, premio $1.000.000, casa 50 %.
// 50 personas cubren el premio; el pozo crece desde la persona 101.
const info = (polla: Partial<Rules> = {}, threshold: FixedPrizeThreshold | null = { entriesToCover: 50, entriesToGrow: 100, entryPrizeCop: 10_000 }) =>
  renderToStaticMarkup(createElement(PollaInfo, { polla: { ...base, ...polla }, threshold }));

describe("PollaInfo (2026-09-13: desplegables con viñetas cortas)", () => {
  it("renders every rule as a collapsed <details> with a list", () => {
    const html = info();
    const details = html.match(/<details[^>]*>/g) ?? [];
    expect(details).toHaveLength(7);
    expect(details.every((tag) => !/\sopen/.test(tag))).toBe(true);
    expect(html).toContain("<ul");
  });

  it("explains the fixed prize by the double threshold, with amounts computed in SQL", () => {
    expect(text(info())).toContain("Premio mínimo garantizado: $1.000.000.");
    expect(text(info())).toContain("Si más de 100 personas se inscriben, el pozo crece $10.000 por cada persona adicional.");
    expect(text(info())).not.toContain("Si más de 50 personas");
    expect(text(info({}, { entriesToCover: 1, entriesToGrow: 1, entryPrizeCop: 7_000 }))).toContain("Si más de 1 persona se inscribe, el pozo crece $7.000");
    expect(text(info())).not.toContain("% de cada nueva entrada");
  });

  it("omits the growth line when the pot cannot grow or the threshold is unknown", () => {
    expect(text(info({ house_cut_pct: 100 }, { entriesToCover: 50, entriesToGrow: 100, entryPrizeCop: 0 }))).not.toContain("Si más de");
    expect(text(info({}, { entriesToCover: null, entriesToGrow: null, entryPrizeCop: 10_000 }))).not.toContain("Si más de");
    // Without migration 125 the preview has no entries_to_grow: say nothing rather than the old threshold.
    expect(text(info({}, { entriesToCover: 50, entriesToGrow: null, entryPrizeCop: 10_000 }))).not.toContain("Si más de");
    expect(text(info({}, null))).not.toContain("Si más de");
    expect(text(info({ pot_mode: "proporcional", fixed_prize_cop: null }))).not.toContain("Premio mínimo garantizado");
  });

  it("describes only the configured scoring mode", () => {
    expect(text(info())).toContain("Si aciertas: 3 puntos.");
    const marcador = text(info({ scoring_mode: "marcador" }));
    expect(marcador).toContain("Marcador exacto: 3 puntos.");
    expect(marcador).toContain("Goles de un solo equipo: 1 punto.");
    expect(marcador).not.toContain("Si aciertas");
  });
});

describe("ScoringModeBadge", () => {
  it("names what has to be predicted; null is 1X2 like the picks board", () => {
    expect(text(renderToStaticMarkup(createElement(ScoringModeBadge, { mode: "marcador" })))).toBe("Acierta marcador exacto");
    expect(text(renderToStaticMarkup(createElement(ScoringModeBadge, { mode: "1x2" })))).toBe("Acierta ganador del partido");
    expect(text(renderToStaticMarkup(createElement(ScoringModeBadge, { mode: null })))).toBe("Acierta ganador del partido");
  });
});

describe("TournamentIdentity", () => {
  it("shows logos only: tournament names stay for screen readers", () => {
    for (const size of ["sm", "lg"] as const) {
      const html = renderToStaticMarkup(createElement(TournamentIdentity, { tournaments: ["laliga_2025", "premier_2025"], kind: "partidos", size }));
      expect(html.match(/<img/g)).toHaveLength(2);
      const visibleNames = html.match(/<span(?![^>]*sr-only)[^>]*>(La Liga|LaLiga|Premier League)<\/span>/g);
      expect(visibleNames).toBeNull();
      expect(html).toMatch(/class="sr-only">[^<]+<\/span>/);
    }
  });
});
