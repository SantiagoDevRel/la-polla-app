import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * (2026-09-18) Pedido del dueño: la regla del desempate va resaltada en amarillo
 * en la mitad de la polla, con el peso de «Ya estás dentro», no en la letra
 * menuda de la Info. El empate arriba es el caso normal en modo marcador —
 * OFIGOLAZO, con 43 inscritos, terminó con tres personas empatadas.
 */
import { AvisoDesempate } from "@/components/casa/AvisoDesempate";

const html = renderToStaticMarkup(createElement(AvisoDesempate));
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("aviso de desempate", () => {
  it("dice la regla completa", () => {
    expect(text).toContain("En caso de empate, el premio se le dará a la persona que se haya registrado antes en esta polla");
  });

  it("explica con el ejemplo de las horas, en letra pequeña", () => {
    expect(text).toContain("9:00 a. m.");
    expect(text).toContain("10:00 a. m.");
    expect(text).toContain("Solo en caso de empate");
    expect(html).toMatch(/text-\[13px\][^"]*"[^>]*>\s*(\{?\/\*|Si alguien)/);
  });

  it("va en amarillo y se anuncia como nota, no como alerta", () => {
    expect(html).toContain('role="note"');
    expect(html).toContain("text-gold");
    expect(html).toContain("bg-gold/10");
  });

  it("no mete el nombre del premio en la frase", () => {
    // «DOS ENTRADAS … ( ORIENTAL O SUR)» en minúsculas dentro de la oración
    // quedaba ilegible; la frase habla de «el premio».
    expect(text.toLowerCase()).not.toContain("entradas nacional");
  });
});
