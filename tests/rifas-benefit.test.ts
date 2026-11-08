// tests/rifas-benefit.test.ts — portada de las rifas sin ánimo de lucro.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { rifaBenefit, rifaStoryArt, rifaStoryPrize } = await import("@/lib/rifas/benefit");
const { PARTNER_RIFAS } = await import("@/lib/rifas/partner");

const LA_IGUANA_1 = "495aa5b1-767c-47bb-8487-15223ab44f63";

describe("rifaBenefit", () => {
  it("la rifa solidaria de La Iguaná dice para quién es la plata y qué compra", () => {
    const b = rifaBenefit(LA_IGUANA_1);
    expect(b?.cause).toBe("una familia damnificada en La Iguaná");
    expect(b?.detail).toMatch(/camas, colchones, cobijas y almohadas/);
  });

  it("una rifa cualquiera conserva la portada normal", () => {
    expect(rifaBenefit("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("la camiseta que gira apunta a archivos que existen en public/", () => {
    const media = rifaBenefit(LA_IGUANA_1)?.jersey?.media;
    expect(media).toBeTruthy();
    const pages = Array.from({ length: 24 }, (_, page) => page.toString().padStart(2, "0"));
    for (const src of [media!.front, media!.back, media!.poster!, media!.video, media!.animation,
      ...pages.flatMap(page => [`${media!.turntable!.small}${page}.webp`, `${media!.turntable!.large}${page}.webp`])]) {
      expect(existsSync(join(process.cwd(), "public", src)), src).toBe(true);
    }
  });

  it("gira la camiseta firmada por Armani e Higuita y trae sus dos fotos originales", () => {
    const jersey = rifaBenefit(LA_IGUANA_1)?.jersey;
    expect(jersey?.media.front).toMatch(/\/prizes\/armani-[0-9a-f]{12}\/armani-v2-front\.png$/);
    expect(jersey?.label).toMatch(/Franco Armani y René Higuita/);
    expect(jersey?.photos.map(photo => photo.label)).toEqual(["Frente y autógrafos", "Espalda"]);
    for (const photo of jersey!.photos) expect(existsSync(join(process.cwd(), "public", photo.src)), photo.src).toBe(true);
  });

  it("la imagen de historia lleva la camiseta de frente, por el slug de la misma rifa", () => {
    const slug = PARTNER_RIFAS.find((p) => p.id === LA_IGUANA_1)?.slug;
    expect(slug).toBe("rifa-solidaria-la-iguana-camiseta");
    const path = rifaStoryPrize(slug!);
    expect(path).toBe("assets/rifas-story/premios/armani-frente.png");
    expect(existsSync(join(process.cwd(), path!))).toBe(true);
    expect(rifaStoryPrize("mwrikpci")).toBeNull();
  });

  it("el tablero lleva la camiseta en alta y el titular aprobado", () => {
    const art = rifaStoryArt("rifa-solidaria-la-iguana-camiseta");
    expect(art?.prizeLarge).toBe("assets/rifas-story/premios/armani-frente-hd.png");
    expect(existsSync(join(process.cwd(), art!.prizeLarge))).toBe(true);
    expect(art?.headline.map((line) => line.text)).toEqual(["RIFA SOLIDARIA", "POR UNA FAMILIA", "DAMNIFICADA EN LA IGUANÁ"]);
    expect(art?.headline.filter((line) => line.accent).map((line) => line.text)).toEqual(["POR UNA FAMILIA"]);
    expect(rifaStoryArt("mwrikpci")).toBeNull();
  });

  it("la carpeta de la camiseta tiene caché immutable como las demás versionadas", async () => {
    const { readFileSync } = await import("node:fs");
    const base = rifaBenefit(LA_IGUANA_1)!.jersey!.media.front.split("/").slice(0, 3).join("/");
    expect(readFileSync(join(process.cwd(), "next.config.mjs"), "utf8")).toContain(`source: "${base}/:path*"`);
  });
});
