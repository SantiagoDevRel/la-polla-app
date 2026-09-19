// tests/font-scale.test.ts — «Tamaño del texto» escala UNA vez (2026-09-19).
//
// El bug: applyScale ponía el font-size de <html> y enseguida el barrido de
// estilos inline lo encontraba y lo volvía a multiplicar: «+60 %» daba 40,96 px
// (2,56×) y «−30 %» 7,84 px (0,49×). El entorno de pruebas es node, así que el
// DOM es un doble mínimo con lo único que usa lib/font-scale.ts.
//
// Segundo caso: en el teléfono el navegador obedece `text-size-adjust` y el
// control lo usa para agrandar también las clases en px; ahí la raíz y los px
// inline se quedan en su valor base (si no, sería escalar dos veces).
import { afterEach, describe, expect, it, vi } from "vitest";

// La sonda se mide una vez por carga del módulo: cada prueba lo carga de nuevo.
async function load() {
  vi.resetModules();
  return import("@/lib/font-scale");
}

function fakeElement(fontSize = "") {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    style: {
      fontSize,
      zoom: "",
      cssText: "",
      setProperty: (k: string, v: string) => { props.set(k, v); },
      getPropertyValue: (k: string) => props.get(k) ?? "",
    },
    textContent: "",
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => { attrs.set(k, v); },
    hasAttribute: (k: string) => attrs.has(k),
    removeAttribute: (k: string) => { attrs.delete(k); },
  };
}

// `honored`: el navegador de mentira obedece text-size-adjust (la sonda al
// 200 % mide el doble), como Chrome y Safari en el teléfono.
function fakeDocument(honored = false) {
  const html = fakeElement();
  const inline = fakeElement("14px");
  const relative = fakeElement("1.2em");
  const body = { ...fakeElement(), appendChild: () => undefined };
  (globalThis as { document?: unknown }).document = {
    documentElement: html,
    body,
    createElement: () => {
      const el = fakeElement();
      return {
        ...el,
        remove: () => undefined,
        getBoundingClientRect: () => ({ width: honored && el.style.cssText.includes("text-size-adjust:200%") ? 168 : 84 }),
      };
    },
    // El selector real es `[style*="font-size"], [data-lp-fs]`: <html> entra en
    // cuanto applyScale le pone su font-size inline.
    querySelectorAll: () => [html, inline, relative].filter((el) => el.style.fontSize || el.hasAttribute("data-lp-fs")),
  };
  return { html, inline, relative };
}

afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe("tamaño del texto", () => {
  it("+60 % es 1,6× en la raíz, no 2,56×", async () => {
    const { applyScale, scaleInlineFontSizes } = await load();
    const { html, inline } = fakeDocument();
    applyScale("lg");
    expect(html.style.fontSize).toBe("25.6px");
    expect(inline.style.fontSize).toBe("22.40px");
    // Volver a aplicar (MutationObserver, otra pestaña) no acumula.
    applyScale("lg");
    scaleInlineFontSizes(1.6);
    expect(html.style.fontSize).toBe("25.6px");
    expect(inline.style.fontSize).toBe("22.40px");
    expect(html.hasAttribute("data-lp-fs")).toBe(false);
  });

  it("−30 % es 0,7× y volver a normal restaura los valores originales", async () => {
    const { applyScale } = await load();
    const { html, inline, relative } = fakeDocument();
    applyScale("sm");
    expect(html.style.fontSize).toBe("11.2px");
    expect(inline.style.fontSize).toBe("9.80px");
    applyScale("md");
    expect(html.style.fontSize).toBe("16px");
    expect(inline.style.fontSize).toBe("14.00px");
    // em/rem ya siguen a la raíz: no se tocan.
    expect(relative.style.fontSize).toBe("1.2em");
  });

  it("limpia la marca que dejó la versión con el bug", async () => {
    const { applyScale } = await load();
    const { html } = fakeDocument();
    html.style.fontSize = "25.6px";
    html.setAttribute("data-lp-fs", "25.6");
    applyScale("lg");
    expect(html.style.fontSize).toBe("25.6px");
    expect(html.hasAttribute("data-lp-fs")).toBe(false);
  });

  it("en el teléfono escala con text-size-adjust y no toca raíz ni px inline", async () => {
    const { applyScale, scaleInlineFontSizes } = await load();
    const { html, inline } = fakeDocument(true);
    applyScale("lg");
    expect(html.style.getPropertyValue("text-size-adjust")).toBe("160%");
    expect(html.style.getPropertyValue("-webkit-text-size-adjust")).toBe("160%");
    expect(html.style.fontSize).toBe("16px");
    expect(inline.style.fontSize).toBe("14.00px");
    // El observador vuelve a pasar con 1,6: sigue sin multiplicar.
    scaleInlineFontSizes(1.6);
    expect(inline.style.fontSize).toBe("14.00px");
    applyScale("sm");
    expect(html.style.getPropertyValue("text-size-adjust")).toBe("70%");
    expect(html.style.fontSize).toBe("16px");
  });
});
