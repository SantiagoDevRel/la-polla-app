// tests/rifas-benefit.test.ts — portada de las rifas sin ánimo de lucro.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { rifaBenefit } = await import("@/lib/rifas/benefit");

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
    for (const src of [media!.front, media!.back, media!.poster!, `${media!.turntable!.small}00.webp`, `${media!.turntable!.large}00.webp`]) {
      expect(existsSync(join(process.cwd(), "public", src)), src).toBe(true);
    }
  });
});
