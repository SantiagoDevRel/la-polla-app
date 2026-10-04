import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// El título del desempate permanece visible; la regla completa y el ejemplo
// se abren al pulsar, también antes de inscribirse y en el enlace compartido.
import { AvisoDesempate } from "@/components/casa/AvisoDesempate";

const html = renderToStaticMarkup(createElement(AvisoDesempate));
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("aviso de desempate", () => {
  it("dice la regla completa", () => {
    expect(text).toContain("En caso de empate, el premio se le dará a la persona que se haya registrado primero en esta polla");
  });

  it("explica con el ejemplo de las horas, en letra pequeña", () => {
    expect(text).toContain("9:00 a. m.");
    expect(text).toContain("10:00 a. m.");
    expect(text).toContain("Solo en caso de empate");
    expect(html).toMatch(/text-\[13px\][^"]*"[^>]*>\s*(\{?\/\*|Si alguien)/);
  });

  it.each([false, true])("empieza colapsado con título y flecha (compact=%s)", (compact) => {
    const markup = renderToStaticMarkup(createElement(AvisoDesempate, { compact }));
    const details = markup.match(/^<details\b[^>]*>/)?.[0];
    const summary = markup.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1];

    expect(details).toBeDefined();
    expect(details).not.toMatch(/\sopen(?:\s|=|>)/);
    expect(summary).toContain("Si hay empate, gana quien se registró primero en esta polla");
    expect(summary).toContain("lucide-chevron-down");
    expect(summary).not.toContain("Si alguien se registró");
  });

  it("no mete el nombre del premio en la frase", () => {
    // «DOS ENTRADAS … ( ORIENTAL O SUR)» en minúsculas dentro de la oración
    // quedaba ilegible; la frase habla de «el premio».
    expect(text.toLowerCase()).not.toContain("entradas nacional");
  });
});
