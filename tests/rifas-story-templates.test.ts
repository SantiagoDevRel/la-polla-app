import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageResponse } from "next/og";
import { describe, expect, it, vi } from "vitest";
import { boardLayout } from "../lib/rifas/story-templates/layout";
import { BOARD_H, BOARD_W, fitLines, localStoryText } from "../lib/rifas/story-templates/common";
import { STORY_TEMPLATE_LIST, getStoryTemplate, renderStory, type StoryData } from "../lib/rifas/story-templates";
import { STORY_CLUBS, STORY_TEMPLATES } from "../lib/rifas/shared";
import { storyElement } from "../lib/rifas/story";

const fonts = [
  { name: "Bebas", data: readFileSync("assets/fonts/BebasNeue-latin.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Outfit", data: readFileSync("assets/fonts/Outfit-SemiBold-latin.ttf"), weight: 600 as const, style: "normal" as const },
];
const png = (name: string) => `data:image/png;base64,${readFileSync(`assets/rifas-story/${name}.png`).toString("base64")}`;
const props = {
  r: { slug: "abcd2345", name: "Rifa de la comunidad", prize_kind: "dinero", prize_cop: 2_000_000, prize_text: null,
    number_count: 100, price_cop: 20_000, lottery_name: "Lotería de Medellín", draw_at: "2026-10-04T03:30:00Z",
    status: "resuelta", winning_number: 7, taken: [0, 7, 99] } satisfies StoryData,
  club: STORY_CLUBS[0], appHost: "lapollacolombiana.com", logo: png("logo"), pollito: png("pollito_verde"),
};

describe("boardLayout", () => {
  it.each([2, 7, 10, 25, 33, 50, 99, 100])("%i números caben con casillas legibles", (n) => {
    const b = boardLayout(n, BOARD_W, BOARD_H);
    expect(b.width).toBeLessThanOrEqual(BOARD_W);
    expect(b.height).toBeLessThanOrEqual(BOARD_H);
    expect(b.cellSize).toBeGreaterThanOrEqual(70);
    expect(b.rowCounts.reduce((sum, count) => sum + count, 0)).toBe(n);
    expect(b.rowCounts.length).toBe(b.rows);
  });
  it.each([[10, 4, 3], [25, 5, 5], [50, 10, 5], [100, 10, 10]])("%i => %ix%i", (n, columns, rows) => {
    expect(boardLayout(n, BOARD_W, BOARD_H)).toMatchObject({ columns, rows });
  });
  it("todos los N, en tres cajas: no hay última fila de uno ni overflow", () => {
    for (const [w, h] of [[920, 820], [880, 880], [800, 900]]) for (let n = 2; n <= 100; n++) {
      const b = boardLayout(n, w, h);
      expect(b.width).toBeLessThanOrEqual(w);
      expect(b.height).toBeLessThanOrEqual(h);
      expect(Math.min(...b.rowCounts)).toBeGreaterThanOrEqual(2);
    }
  });
  it("rechaza N inválido y cajas imposibles sin ocultar el error", () => {
    for (const n of [0, 1, 101, 3.5, NaN]) expect(() => boardLayout(n, 920, 820)).toThrow(RangeError);
    expect(() => boardLayout(100, 100, 100)).toThrow(RangeError);
    expect(() => boardLayout(2, Infinity, 820)).toThrow(RangeError);
  });
  it.each([10, 25])("%i: maximiza casillas dentro de ambos ejes, hasta 200 px", (n) => {
    for (const [w, h] of [[920, 820], [1100, 1100]]) {
      const b = boardLayout(n, w, h);
      expect(b.cellSize).toBe(Math.floor(Math.min(
        (w - b.gap * (b.columns - 1)) / b.columns,
        (h - b.gap * (b.rows - 1)) / b.rows, 200,
      )));
    }
  });
});

describe("registro y privacidad", () => {
  it("12 claves únicas y sincronizadas; respaldo neutro y clubes explícitos", () => {
    expect(STORY_TEMPLATE_LIST.map((t) => t.key)).toEqual(STORY_TEMPLATES);
    expect(new Set(STORY_TEMPLATES).size).toBe(12);
    expect(getStoryTemplate("__proto__").key).toBe("neutra");
    expect(getStoryTemplate(null).key).toBe("neutra");
    expect(STORY_TEMPLATE_LIST.filter((t) => t.usesClub).map((t) => t.key)).toEqual(["club", "camiseta"]);
    for (const template of ["neutra", "club"] as const) {
      expect(renderToStaticMarkup(storyElement({ ...props, template }))).toBe(renderToStaticMarkup(renderStory(template, props)));
    }
  });
  it.each(STORY_TEMPLATE_LIST)("$key: datos públicos completos, marcas y orden", (template) => {
    const html = renderToStaticMarkup(template.render({ ...props,
      r: { ...props.r, buyer_name: "PRIVADO_NOMBRE", buyer_phone: "PRIVADO_CELULAR" } as StoryData,
    }));
    expect(html).not.toContain("PRIVADO");
    expect(html).toContain("LA POLLA");
    expect(html).toContain("GANADOR 07");
    expect(html).toContain("lapollacolombiana.com/rifa/abcd2345");
    expect([...html.matchAll(/data-number="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(html.match(/data-taken="true"/g)).toHaveLength(3);
    expect(html.match(/data-winner="true"/g)).toHaveLength(1);
    expect(html.match(/#FFD700/g)?.length ?? 0).toBeLessThanOrEqual(3);
    expect(html).not.toContain("display:grid");
    expect(html.includes(props.pollito)).toBe(template.usesClub);
  });
  it("no anuncia ganador de una rifa abierta o desierta", () => {
    for (const status of ["abierta", "desierta"]) {
      const html = renderToStaticMarkup(renderStory("neutra", { ...props, r: { ...props.r, status } }));
      expect(html).not.toContain("GANADOR");
      expect(html).not.toContain('data-winner="true"');
    }
  });
  it("ajusta textos límite, incluso palabras sin espacios, sin perder contenido", () => {
    for (const [text, w, h, size, family] of [
      ["W".repeat(80), 700, 110, 56, "Bebas"],
      ["W".repeat(120), 872, 136, 44, "Outfit"],
      ["W".repeat(60), 352, 76, 42, "Bebas"],
    ] as const) {
      const result = fitLines(text, w, h, size, family);
      expect(result.lines.join("")).toBe(text);
      expect(result.lines.length * result.fontSize * 1.12).toBeLessThanOrEqual(h);
    }
  });
  it("conserva tildes y normaliza puntuación sin pedir fuentes externas", () => {
    expect(localStoryText('“Rifa” — Medelli\u0301n…')).toBe('"Rifa" - Medellín...');
    expect(localStoryText("Premio 🎁 東京")).toBe("Premio ? ??");
  });
  it.each(["3 DE OCTUBRE", "LOTERÍA DE CUNDINAMARCA"])("%s: solo corta por espacios, incluso en columnas estrechas", (text) => {
    for (const width of [120, 180, 260, 352]) {
      const result = fitLines(text, width, 76, 42, "Bebas", false);
      expect(result.lines.join(" ")).toBe(text);
      expect(result.lines.flatMap((line) => line.split(" "))).toEqual(text.split(" "));
      expect(result.lines.length * result.fontSize * 1.12).toBeLessThanOrEqual(76);
    }
  });
  it("una lotería de 60 caracteres sin espacios reduce la fuente y conserva la palabra", () => {
    expect(fitLines("W".repeat(60), 352, 76, 42, "Bebas", false).lines).toEqual(["W".repeat(60)]);
  });
});

describe("next/og real con fuentes y PNG locales", () => {
  it("no hace fetch incluso con glifos que los TTF latinos no incluyen", async () => {
    const originalFetch = globalThis.fetch;
    const external: string[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      // Satori initializes its bundled WASM via a data URI: that is not network.
      if (url.startsWith("data:")) return originalFetch(input, init);
      external.push(url);
      throw new Error(`Unexpected network request: ${url}`);
    });
    try {
      const element = renderStory("neutra", { ...props, r: { ...props.r, name: "Rifa 🎁 東京", prize_kind: "texto", prize_text: 'Un televisor “especial” — edición limitada' } });
      const result = new ImageResponse(element, { width: 1080, height: 1920, fonts });
      expect((await result.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      expect(external).toEqual([]);
    } finally { fetch.mockRestore(); }
  }, 30_000);
  it.each(STORY_TEMPLATE_LIST)("$key genera PNG, no solo JSX", async (template) => {
    const result = new ImageResponse(template.render(props), { width: 1080, height: 1920, fonts });
    const png = Buffer.from(await result.arrayBuffer());
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
  }, 30_000);
});
