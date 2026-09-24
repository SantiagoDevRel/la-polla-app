import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchPicks } from "@/components/casa/MatchPicks";

describe("match prediction summary before opening the list", () => {
  it("shows the prediction distribution while participants remain collapsed", () => {
    const summary = "14 de 77 pusieron 2-1 (18%)";
    const html = renderToStaticMarkup(createElement(MatchPicks, {
      slug: "polla-regalo", matchId: "match", scoringMode: "marcador",
      home: "Dinamarca", away: "Macedonia del Norte", count: 77, summary,
    }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(summary);
    expect(html.indexOf(summary)).toBeGreaterThan(html.indexOf("</button>"));
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Cargando pronósticos");
  });
});
