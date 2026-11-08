// tests/rifas-lds-story.test.ts — rifas con Los Del Sur: escudo y plantillas de la barra.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";
import { LDS_STORY_TEMPLATE_LIST, STORY_TEMPLATE_LIST, getStoryTemplate, type StoryData } from "../lib/rifas/story-templates";
import { PARTNER_RIFAS, rifaPartner, rifaPartnerBySlug } from "../lib/rifas/partner";
import { STORY_CLUBS, STORY_TEMPLATE_OPTIONS, storyTemplateOptions } from "../lib/rifas/shared";

const LA_IGUANA = { id: "495aa5b1-767c-47bb-8487-15223ab44f63", slug: "rifa-solidaria-la-iguana-camiseta" };
const file = (path: string, mime: string) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const fonts = [
  { name: "Bebas", data: readFileSync("assets/fonts/BebasNeue-latin.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Outfit", data: readFileSync("assets/fonts/Outfit-SemiBold-latin.ttf"), weight: 600 as const, style: "normal" as const },
];
const r: StoryData = {
  slug: LA_IGUANA.slug, name: "Rifa solidaria La Iguaná", prize_kind: "texto", prize_cop: null,
  prize_text: "Camiseta firmada por Franco Armani y René Higuita", number_count: 100, price_cop: 30_000,
  lottery_name: "Lotería de Medellín", draw_at: "2026-11-14T03:30:00Z", status: "abierta", winning_number: null, taken: [3, 7, 90],
};
const props = (template: (typeof LDS_STORY_TEMPLATE_LIST)[number]) => ({
  r, club: STORY_CLUBS[0], appHost: "lapollacolombiana.com",
  logo: file("assets/rifas-story/logo.png", "image/png"),
  pollito: file(`assets/rifas-story/lds/pollito-${template.pollito}.png`, "image/png"),
  partner: {
    escudo: file("assets/rifas-story/lds/escudo.png", "image/png"),
    trapo: file("assets/rifas-story/lds/trapo.png", "image/png"),
    background: file(`assets/rifas-story/lds/fondo-${template.background}.jpg`, "image/jpeg"),
  },
  prizeImage: file("assets/rifas-story/premios/armani-frente.png", "image/png"),
});

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
  it("6 propias y exclusivas: la rifa de la barra no ve las de La Polla, ni al revés", () => {
    expect(new Set(LDS_STORY_TEMPLATE_LIST.map((t) => t.key)).size).toBe(6);
    expect(new Set(LDS_STORY_TEMPLATE_LIST.map((t) => t.background)).size).toBe(6);
    expect(storyTemplateOptions("lds").map((t) => t.key)).toEqual(LDS_STORY_TEMPLATE_LIST.map((t) => t.key));
    expect(storyTemplateOptions(null)).toBe(STORY_TEMPLATE_OPTIONS);
    expect(getStoryTemplate("neutra", "lds").key).toBe("lds-tribuna");
    expect(getStoryTemplate("lds-humo", null).key).toBe("neutra");
    expect(getStoryTemplate("lds-humo", "lds").key).toBe("lds-humo");
    expect(STORY_TEMPLATE_LIST.some((t) => t.key.startsWith("lds-"))).toBe(false);
  });
  it.each(LDS_STORY_TEMPLATE_LIST)("$key: arte local, miniatura y datos públicos completos", (template) => {
    // Las seis van sobre una foto real de la barra (scripts/bake-rifa-lds-fondos.py), cada una distinta.
    for (const path of [`assets/rifas-story/lds/pollito-${template.pollito}.png`, `public/plantillas-rifa/${template.key}.webp`,
      `assets/rifas-story/lds/fondo-${template.background}.jpg`]) expect(existsSync(path)).toBe(true);
    const p = props(template);
    const html = renderToStaticMarkup(template.render({ ...p, r: { ...r, buyer_phone: "PRIVADO" } as StoryData }));
    expect(html).not.toContain("PRIVADO");
    expect(html).toContain("LOS DEL SUR");
    // Lema: «barrismo social» en tres, el de los combos en las otras; nunca «barra brava».
    const lideres = ["lds-humo", "lds-escudo", "lds-sombrillas"].includes(template.key);
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
    const template = LDS_STORY_TEMPLATE_LIST[0];
    const html = renderToStaticMarkup(template.render({ ...props(template), prizeImage: null }));
    expect(html).not.toContain("rgba(190,165,255");
    expect(html).toContain("Armani");
  });
  it.each(LDS_STORY_TEMPLATE_LIST)("$key genera PNG 1080×1920", async (template) => {
    const png = Buffer.from(await new ImageResponse(template.render(props(template)), { width: 1080, height: 1920, fonts }).arrayBuffer());
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
  }, 30_000);
});
