import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * (2026-09-18, migración 143) POLLA REGALO no cuesta nada y el flujo pedía
 * transferir y subir el pantallazo: dos personas subieron el comprobante de una
 * transferencia de $0 y un administrador los aprobó a mano.
 *
 * Con entrada gratis no se nombra comprobante ni transferencia en ninguna
 * superficie — ni la app, ni el bot, ni el texto que se comparte.
 */
vi.mock("@/components/casa/PayoutAccountButton", () => ({ PayoutAccountButton: () => null }));

import { PollaInfo } from "@/components/casa/PollaInfo";
import { entryPriceLabel } from "@/lib/casa/format";
import { textoCompartir } from "@/lib/casa/share-text";

type Rules = Parameters<typeof PollaInfo>[0]["polla"];
const base: Rules = {
  kind: "partidos", scoring_mode: "marcador", points_exact: 3, points_one_team: 0, points_result: 3,
  prize_kind: "objeto", prize_object: "DOS ENTRADAS", description: null, draw_method: null,
  pot_mode: "proporcional", fixed_prize_cop: null, house_cut_pct: 100,
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const info = (polla: Partial<Rules>) =>
  text(renderToStaticMarkup(createElement(PollaInfo, { polla: { ...base, ...polla }, threshold: null })));

describe("entrada gratis", () => {
  it("la Info explica que se entra con un toque y sin comprobante", () => {
    const html = info({ entry_price_cop: 0 });
    expect(html).toContain("Entrar es gratis.");
    expect(html).toContain("quedas registrado");
    // La única mención al comprobante es para descartarlo; nunca se pide.
    expect(html).toContain("No transfieres nada ni subes comprobante");
    expect(html).not.toContain("Subes la foto del comprobante");
    expect(html).not.toContain("Transfieres ");
    expect(html).not.toContain("Cómo se paga la entrada");
  });

  it("una polla con entrada conserva el flujo de transferencia y comprobante", () => {
    const html = info({ entry_price_cop: 20_000 });
    expect(html).toContain("Cómo se paga la entrada");
    expect(html).toContain("Transfieres");
    expect(html).toContain("comprobante");
  });

  it("el precio se lee «Gratis», nunca «$0»", () => {
    expect(entryPriceLabel(0)).toBe("Gratis");
    expect(entryPriceLabel(20_000)).toBe("$20.000");
  });

  it("el texto que se comparte no ofrece una entrada de $0", () => {
    const compartido = textoCompartir({ nombre: "POLLA REGALO", entradaCop: 0, premio: { objeto: "DOS ENTRADAS" } });
    expect(compartido).toContain("Entrada: gratis");
    expect(compartido).not.toContain("$0");
  });
});
