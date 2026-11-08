// tests/rifas-lds-story.test.ts — rifas con Los Del Sur: escudo y plantillas de la barra.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";
import { LDS_STORY_TEMPLATE_LIST, STORY_TEMPLATE_LIST, getStoryTemplate, storyFormat, storySize, type StoryData,
  type StoryFormat } from "../lib/rifas/story-templates";
import { drawDayLabel, headlineSizes, prizeCaption } from "../lib/rifas/story-templates/designs-lds-tablero";
import { PARTNER_RIFAS, rifaPartner, rifaPartnerBySlug } from "../lib/rifas/partner";
import { STORY_CLUBS, STORY_TEMPLATE_OPTIONS, storyTemplateOptions } from "../lib/rifas/shared";

const LA_IGUANA = { id: "495aa5b1-767c-47bb-8487-15223ab44f63", slug: "rifa-solidaria-la-iguana-camiseta" };
const file = (path: string, mime: string) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const fonts = [
  { name: "Bebas", data: readFileSync("assets/fonts/BebasNeue-latin.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Outfit", data: readFileSync("assets/fonts/Outfit-SemiBold-latin.ttf"), weight: 600 as const, style: "normal" as const },
  { name: "Outfit", data: readFileSync("assets/fonts/Outfit-Bold-latin.ttf"), weight: 700 as const, style: "normal" as const },
];
const TABLERO = "lds-tablero";
/** El tablero tiene una foto recortada por formato; las demás, una sola. */
const background = (template: (typeof LDS_STORY_TEMPLATE_LIST)[number], format: StoryFormat = "vertical") =>
  `assets/rifas-story/lds/fondo-${template.key === TABLERO ? `${template.background}-${format}` : template.background}.jpg`;
const HEADLINE = [{ text: "RIFA SOLIDARIA" }, { text: "POR UNA FAMILIA", accent: true }, { text: "DAMNIFICADA EN LA IGUANÁ" }];
const r: StoryData = {
  slug: LA_IGUANA.slug, name: "Rifa solidaria La Iguaná", prize_kind: "texto", prize_cop: null,
  prize_text: "Camiseta firmada por Franco Armani y René Higuita", number_count: 100, price_cop: 30_000,
  lottery_name: "Lotería de Medellín", draw_at: "2026-11-14T03:30:00Z", status: "abierta", winning_number: null, taken: [3, 7, 90],
};
const props = (template: (typeof LDS_STORY_TEMPLATE_LIST)[number], format: StoryFormat = "vertical") => ({
  r, club: STORY_CLUBS[0], appHost: "lapollacolombiana.com",
  logo: file("assets/rifas-story/logo.png", "image/png"),
  pollito: file(`assets/rifas-story/lds/pollito-${template.pollito}.png`, "image/png"),
  partner: {
    escudo: file("assets/rifas-story/lds/escudo.png", "image/png"),
    trapo: file("assets/rifas-story/lds/trapo.png", "image/png"),
    background: file(background(template, format), "image/jpeg"),
  },
  prizeImage: file(template.key === TABLERO ? "assets/rifas-story/premios/armani-frente-hd.png" : "assets/rifas-story/premios/armani-frente.png", "image/png"),
  format, headline: HEADLINE,
});
const tablero = LDS_STORY_TEMPLATE_LIST.find((t) => t.key === TABLERO)!;

describe("rifaPartner", () => {
  it("la rifa solidaria La Iguaná es de Los Del Sur por uuid y por slug", () => {
    expect(rifaPartner(LA_IGUANA.id)?.key).toBe("lds");
    expect(rifaPartnerBySlug(LA_IGUANA.slug)?.key).toBe("lds");
    expect(rifaPartner("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(rifaPartnerBySlug("mwrikpci")).toBeNull();
  });
  it("cada escudo público existe", () => {
    for (const { partner } of PARTNER_RIFAS) expect(existsSync(join("public", partner.escudo))).toBe(true);
  });
});

describe("plantillas de Los Del Sur", () => {
  it("7 propias y exclusivas, el tablero primero: la rifa de la barra no ve las de La Polla, ni al revés", () => {
    expect(new Set(LDS_STORY_TEMPLATE_LIST.map((t) => t.key)).size).toBe(7);
    expect(new Set(LDS_STORY_TEMPLATE_LIST.map((t) => t.background)).size).toBe(7);
    expect(storyTemplateOptions("lds").map((t) => t.key)).toEqual(LDS_STORY_TEMPLATE_LIST.map((t) => t.key));
    expect(storyTemplateOptions("lds")[0].key).toBe(TABLERO);
    expect(storyTemplateOptions(null)).toBe(STORY_TEMPLATE_OPTIONS);
    // Sin plantilla o con una ajena, sale el tablero.
    expect(getStoryTemplate(null, "lds").key).toBe(TABLERO);
    expect(getStoryTemplate("neutra", "lds").key).toBe(TABLERO);
    expect(getStoryTemplate("lds-humo", null).key).toBe("neutra");
    expect(getStoryTemplate("lds-humo", "lds").key).toBe("lds-humo");
    expect(STORY_TEMPLATE_LIST.some((t) => t.key.startsWith("lds-"))).toBe(false);
  });
  it.each(LDS_STORY_TEMPLATE_LIST)("$key: arte local, miniatura y datos públicos completos", (template) => {
    // Las siete van sobre una foto real de la barra (scripts/bake-rifa-lds-fondos.py), cada una distinta.
    for (const path of [`assets/rifas-story/lds/pollito-${template.pollito}.png`, `public/plantillas-rifa/${template.key}.webp`,
      background(template, "vertical"), background(template, "cuadrada")]) expect(existsSync(path)).toBe(true);
    const p = props(template);
    const html = renderToStaticMarkup(template.render({ ...p, r: { ...r, buyer_phone: "PRIVADO" } as StoryData }));
    expect(html).not.toContain("PRIVADO");
    expect(html).toContain("LOS DEL SUR");
    // Lema: «barrismo social» en tres, el de los combos en las otras; nunca «barra brava».
    const lideres = [TABLERO, "lds-humo", "lds-escudo", "lds-sombrillas"].includes(template.key);
    expect(html).toContain(lideres ? "LÍDERES DEL BARRISMO SOCIAL" : "LA BARRA Y SUS COMBOS");
    expect(html.toLowerCase()).not.toContain("barra brava");
    // La Polla solo en el pie: logo pequeño + dominio, sin el encabezado «LA POLLA».
    expect(html).not.toContain(">LA POLLA<");
    expect(html).toContain(">lapollacolombiana.com<");
    expect(html.includes(p.pollito)).toBe(true);
    expect(html.includes(p.partner.escudo)).toBe(true);
    expect(html.includes(p.partner.background)).toBe(true);
    // (2026-11-08) La camiseta de frente va al lado del premio.
    expect(html.includes(p.prizeImage)).toBe(true);
    expect(html).toContain("Armani");
    expect(html).toContain("René Higuita");
    expect([...html.matchAll(/data-number="(\d+)"/g)]).toHaveLength(100);
    expect(html.match(/data-taken="true"/g)).toHaveLength(3);
    expect(html.match(/#FFD700/g)?.length ?? 0).toBeLessThanOrEqual(3);
  });
  it("sin foto del premio no aparece el recuadro de la camiseta", () => {
    const template = LDS_STORY_TEMPLATE_LIST.find((t) => t.key === "lds-tribuna")!;
    const html = renderToStaticMarkup(template.render({ ...props(template), prizeImage: null }));
    expect(html).not.toContain("rgba(190,165,255");
    expect(html).toContain("Armani");
    const board = renderToStaticMarkup(tablero.render({ ...props(tablero), prizeImage: null }));
    expect(board).not.toContain('width="300" height="386"');
    expect(board).toContain("René Higuita");
  });
  it.each(LDS_STORY_TEMPLATE_LIST.flatMap((t) => (t.key === TABLERO ? (["cuadrada", "vertical"] as const) : (["vertical"] as const))
    .map((format) => ({ template: t, key: t.key, format }))))("$key ($format) genera PNG del tamaño de su formato", async ({ template, format }) => {
    const size = storySize(template.key, format);
    expect(size).toEqual({ width: 1080, height: template.key === TABLERO && format === "cuadrada" ? 1350 : 1920 });
    const png = Buffer.from(await new ImageResponse(template.render(props(template, format)), { ...size, fonts }).arrayBuffer());
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(size.width);
    expect(png.readUInt32BE(20)).toBe(size.height);
  }, 30_000);
});

describe("tablero de Los Del Sur", () => {
  it("formato: cuadrada por defecto; solo el tablero tiene dos", () => {
    expect(storyFormat(TABLERO, null)).toBe("cuadrada");
    expect(storyFormat(TABLERO, "vertical")).toBe("vertical");
    expect(storyFormat(TABLERO, "panorámica")).toBe("cuadrada");
    expect(storyFormat("lds-tribuna", "cuadrada")).toBe("vertical");
    expect(storySize("lds-tribuna", "cuadrada")).toEqual({ width: 1080, height: 1920 });
  });
  it("copia el diseño aprobado: titular, camiseta grande, pastillas y «Compra tu boleta en»", () => {
    const html = renderToStaticMarkup(tablero.render(props(tablero, "cuadrada")));
    for (const text of ["RIFA SOLIDARIA", "POR UNA FAMILIA", "DAMNIFICADA EN LA IGUANÁ", "Camiseta firmada por", "Franco Armani",
      "René Higuita", "$30.000", " la boleta", "00 al 99", "Vie 13 nov · ", "Lotería de Medellín", "Compra tu boleta en ", "La Polla"]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('width="300" height="386"');
    expect(html).not.toContain("Participa");
  });
  it("vertical = el mismo cuadrado 285 px más abajo", () => {
    const tops = (format: StoryFormat) => [...renderToStaticMarkup(tablero.render(props(tablero, format)))
      .matchAll(/position:absolute;[^"]*?top:(\d+)px/g)].map((m) => Number(m[1]));
    const square = tops("cuadrada");
    const vertical = tops("vertical");
    expect(vertical).toHaveLength(square.length);
    expect(square.length).toBeGreaterThan(5);
    // Lo que va dentro del cuadrado baja 285; la foto, su sombra y lo de adentro de cada bloque no se mueven.
    const moved = vertical.filter((top, i) => top - square[i] === 285).length;
    expect(moved).toBeGreaterThanOrEqual(6);
    vertical.forEach((top, i) => expect([0, 285]).toContain(top - square[i]));
  });
  it("tacha los tomados en vivo, sin nombres ni celulares", () => {
    const html = renderToStaticMarkup(tablero.render({ ...props(tablero), r: { ...r, taken: [0, 45, 99], buyer_name: "Pepe" } as StoryData }));
    expect(html.match(/data-taken="true"/g)).toHaveLength(3);
    for (const n of [0, 45, 99]) expect(html).toContain(`data-number="${n}" data-taken="true"`);
    expect(html.match(/<svg/g)).toHaveLength(3);
    expect(html).not.toContain("Pepe");
  });
  it("resuelta: la casilla ganadora en oro y la pastilla dice el número", () => {
    const html = renderToStaticMarkup(tablero.render({ ...props(tablero), r: { ...r, status: "resuelta", winning_number: 7 } }));
    expect(html).toContain('data-number="7" data-taken="true" data-winner="true"');
    expect(html).toContain("Ganador 07");
    expect(html).not.toContain("00 al 99");
    expect(html.match(/#FFD700/g)?.length ?? 0).toBeLessThanOrEqual(3);
  });
  it("sin titular configurado se arma con el nombre; una lotería larga achica las pastillas", () => {
    const html = renderToStaticMarkup(tablero.render({ ...props(tablero), headline: null,
      r: { ...r, name: "Camiseta de Higuita para el combo", lottery_name: "Lotería Extraordinaria de Colombia del Valle" } }));
    expect(html).toContain("RIFA SUREÑA");
    expect(html).toContain("CAMISETA DE HIGUITA");
    expect(html).toContain("Lotería Extraordinaria de Colombia del Valle");
    expect(html).not.toMatch(/font-size:30px;line-height:1.25/);
  });
  it("titular justificado a 600 px sin pasar el tope ni el alto disponible", () => {
    const { sizes, height } = headlineSizes(HEADLINE.map((l) => l.text), 312);
    expect(sizes.every((s) => s > 60 && s <= 130)).toBe(true);
    expect(height).toBeLessThanOrEqual(312);
    expect(headlineSizes(["RIFA"], 312).sizes[0]).toBe(130);
    expect(headlineSizes(["UNO", "DOS", "TRES", "CUATRO"], 200).height).toBeLessThanOrEqual(200);
  });
  it("premio en tres líneas con los nombres en verde; fecha corta de Colombia", () => {
    expect(prizeCaption("Camiseta firmada por Franco Armani y René Higuita")).toEqual([
      [{ text: "Camiseta firmada por" }], [{ text: "Franco Armani", accent: true }, { text: " y" }], [{ text: "René Higuita", accent: true }],
    ]);
    expect(prizeCaption("Balón oficial")).toBeNull();
    // 03:30 UTC del 14 = viernes 13 a las 10:30 p. m. en Colombia.
    expect(drawDayLabel("2026-11-14T03:30:00Z")).toBe("Vie 13 nov");
  });
});
