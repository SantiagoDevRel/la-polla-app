import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PicksBoard } from "@/components/casa/PicksBoard";
import { QuestionsBoard } from "@/components/casa/QuestionsBoard";
import type { CasaQuestion } from "@/lib/casa/types";

const match = {
  id: "30000000-0000-4000-8000-000000000001",
  home_team: "SSR Home", away_team: "SSR Away", home_team_flag: null, away_team_flag: null,
  scheduled_at: "2099-01-01T12:00:00Z", scheduled_at_confirmed: true,
  status: "scheduled", home_score: null, away_score: null, final_verified_at: null,
};
const common = { slug: "hydration-fixture", initialPicks: {}, distribution: { resultado: {}, marcador: {}, preguntas: {} }, canEdit: true };

describe("prediction controls before client readiness", () => {
  it("canonicalizes WebKit's day-period whitespace to the same server-rendered kickoff text", () => {
    const DateTimeFormat = Intl.DateTimeFormat;
    const formatterMock = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      const formatter = new DateTimeFormat(locales, options);
      const originalFormat = formatter.format;
      Object.defineProperty(formatter, "format", {
        value: (date?: Date | number) => originalFormat(date).replace(/([ap])\. m\./g, "$1.\u00a0m."),
      });
      return formatter;
    });
    try {
      const html = renderToStaticMarkup(createElement(PicksBoard, { ...common, matches: [match], scoringMode: "marcador", canViewOthers: false }));
      expect(html).toContain("7:00 a. m.");
      expect(html).not.toContain("7:00 a.\u00a0m.");
    } finally { formatterMock.mockRestore(); }
  });

  it("does not accept native score edits while the server-rendered draft waits for hydration", () => {
    const html = renderToStaticMarkup(createElement(PicksBoard, { ...common, matches: [match], scoringMode: "marcador", canViewOthers: false }));
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs.every(input => input.includes('disabled=""'))).toBe(true);
    expect(inputs.every(input => input.includes('type="text"') && input.includes('inputMode="numeric"') && input.includes('maxLength="2"'))).toBe(true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Cargando tus pronósticos");
    expect(html).not.toContain("Esta polla ya cerró.");
  });

  it("does not accept 1X2 choice clicks before the draft is ready", () => {
    const html = renderToStaticMarkup(createElement(PicksBoard, { ...common, matches: [match], scoringMode: "1x2", canViewOthers: false }));
    const choices = (html.match(/<button\b[^>]*>/g) ?? []).filter(button => /aria-label="(?:Gana SSR Home|Gana SSR Away|Empate)"/.test(button));
    expect(choices).toHaveLength(3);
    expect(choices.every(button => button.includes('disabled=""'))).toBe(true);
  });

  it("keeps manual text and option answers disabled without pretending the pool closed", () => {
    const questions = [
      { id: "text", prompt: "SSR text answer", input_kind: "texto", points: 3, resolved_at: null },
      { id: "option", prompt: "SSR option answer", input_kind: "opciones", points: 3, resolved_at: null, options: [{ id: "choice", label: "SSR choice" }] },
    ] as CasaQuestion[];
    const html = renderToStaticMarkup(createElement(QuestionsBoard, { ...common, questions }));
    expect(html.match(/<input\b[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html.match(/<button\b[^>]*aria-pressed="false"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Cargando tus respuestas");
    expect(html).not.toContain("Esta polla ya cerró.");
  });
});
