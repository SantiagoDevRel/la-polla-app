// tests/rifas-shared.test.ts — formato, cookie del embudo, plantillas y
// contrato estructural de las rifas de creadores (migración 157).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  displayPhone, rifaNumber, rifaShareText, STORY_CLUBS, storyClub, whatsappChatUrl, whatsappShareUrl,
} from "@/lib/rifas/shared";
import { parseRifaLinkCookie, RIFA_PAGE_RE, rifaLinkCookieValue } from "@/lib/rifas/link-cookie";
import { rifaErrorMessage, rifaErrorStatus } from "@/lib/rifas/errors";
import { RifaBoard } from "@/components/rifas/RifaBoard";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("formato", () => {
  it("números a dos cifras", () => {
    expect(rifaNumber(0)).toBe("00");
    expect(rifaNumber(7)).toBe("07");
    expect(rifaNumber(99)).toBe("99");
  });
  it("celular para mostrar", () => {
    expect(displayPhone("573001234567")).toBe("+57 300 123 4567");
    expect(displayPhone("+573001234567")).toBe("+57 300 123 4567");
    expect(displayPhone("+14155550100")).toBe("+14155550100");
    expect(displayPhone(null)).toBe("");
  });
  it("WhatsApp: compartir abre los contactos del creador; escribirle al ganador abre su chat", () => {
    const text = rifaShareText({ name: "Boleta Sur", price_cop: 6000, lottery_name: "Astro Sol" }, "https://lapollacolombiana.com/rifa/abcd2345", "$6.000");
    expect(whatsappShareUrl(text)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(whatsappShareUrl(text).split("text=")[1])).toContain("https://lapollacolombiana.com/rifa/abcd2345");
    expect(whatsappChatUrl("+573001234567", "Hola")).toBe("https://wa.me/573001234567?text=Hola");
    expect(whatsappChatUrl("123", "Hola")).toBeNull();
  });
});

describe("cookie lp_rifa (embudo rifa → cuenta)", () => {
  it("ida y vuelta", () => {
    const value = rifaLinkCookieValue("abcd2345", 1790000000000)!;
    expect(parseRifaLinkCookie(value)).toEqual({ slug: "abcd2345", firstSeen: new Date(1790000000000) });
  });
  it("rechaza valores forjados", () => {
    expect(rifaLinkCookieValue("../etc")).toBeNull();
    expect(parseRifaLinkCookie("abcd2345.notanumber")).toBeNull();
    expect(parseRifaLinkCookie("ABCD2345.1790000000000")).toBeNull();
    expect(parseRifaLinkCookie(undefined)).toBeNull();
  });
  it("solo la página pública de la rifa, no la gestión", () => {
    expect(RIFA_PAGE_RE.test("/rifa/abcd2345")).toBe(true);
    expect(RIFA_PAGE_RE.test("/rifa/abcd2345/gestionar")).toBe(false);
  });
});

describe("errores", () => {
  it("códigos de permiso → 403; no encontrado → 404; conocidos → 409; desconocidos → 500", () => {
    expect(rifaErrorStatus({ message: "CREATOR_ONLY" })).toBe(403);
    expect(rifaErrorStatus({ message: "ADMIN_REQUIRED" })).toBe(403);
    expect(rifaErrorStatus({ message: "RIFA_NOT_FOUND" })).toBe(404);
    expect(rifaErrorStatus({ message: "NUMBER_TAKEN" })).toBe(409);
    expect(rifaErrorStatus({ message: "whatever" })).toBe(500);
  });
  it("mensajes con detalle solo para los códigos que SQL redacta", () => {
    expect(rifaErrorMessage({ message: "NUMBER_TAKEN", details: "El 07 ya lo tomó otra persona. Elige otro número." }))
      .toBe("El 07 ya lo tomó otra persona. Elige otro número.");
    expect(rifaErrorMessage({ message: "CREATOR_ONLY", details: "texto interno" })).toBe("Solo quien creó la rifa puede hacer esto.");
  });
  it("tono: sin palabras vetadas ni voseo", () => {
    const source = read("lib/rifas/errors.ts") + read("components/rifas/RifaComprador.tsx") + read("components/rifas/RifaGestion.tsx")
      + read("components/rifas/RifaForm.tsx") + read("components/rifas/RifasTab.tsx");
    for (const word of [/\bparce\b/i, /\bplata\b/i, /pantallazo/i, /\bpilas\b/i, /\bbacano\b/i, /\btenés\b/i, /\bpodés\b/i]) {
      expect(source).not.toMatch(word);
    }
  });
});

describe("plantillas de historia", () => {
  it("cada club tiene su pollito en el catálogo (sin camisetas inventadas)", () => {
    for (const club of STORY_CLUBS) {
      expect(existsSync(join(root, `public/pollitos/pollito_${club.key}_lider.webp`)), club.key).toBe(true);
      // PNG horneado para next/og (satori no decodifica WebP).
      expect(existsSync(join(root, `assets/rifas-story/pollito_${club.key}.png`)), `${club.key}.png`).toBe(true);
    }
    expect(storyClub("no-existe").key).toBe(STORY_CLUBS[0].key);
  });
  it("las fuentes de la marca existen para next/og", () => {
    expect(existsSync(join(root, "assets/fonts/BebasNeue-latin.ttf"))).toBe(true);
    expect(existsSync(join(root, "assets/fonts/Outfit-SemiBold-latin.ttf"))).toBe(true);
  });
});

describe("tablero", () => {
  it("cada estado se anuncia con palabra, no solo con color", () => {
    const html = renderToStaticMarkup(createElement(RifaBoard, {
      label: "Tablero", cells: [{ n: 0, state: "libre" }, { n: 7, state: "reservado" }, { n: 8, state: "pagado", mine: true }],
      winningNumber: 8,
    }));
    expect(html).toContain('aria-label="00, libre"');
    expect(html).toContain('aria-label="07, reservado"');
    expect(html).toContain('aria-label="08, pagado, tuyo, ganador"');
    expect(html).toContain("lp-rifa-reservado");
    expect(html).toContain("lp-rifa-ganador");
  });
});

describe("contrato estructural", () => {
  const migration = read("supabase/migrations/157_rifas_creadores.sql");
  it("toda tabla nueva tiene RLS y deny-all para clientes (salvo la lectura de rifas visibles)", () => {
    const tables = [...migration.matchAll(/CREATE TABLE public\.(rifa[a-z_]*) \(/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThanOrEqual(11);
    for (const t of tables) expect(migration).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toMatch(/REVOKE ALL ON public\.rifa_settings[\s\S]*FROM PUBLIC, anon, authenticated;/);
    expect(migration).toContain("GRANT SELECT ON public.rifas TO authenticated;");
  });
  it("todas las RPC de rifas se ejecutan solo desde el servidor", () => {
    expect(migration).toMatch(/proname LIKE 'rifa\\_%'[\s\S]*REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated[\s\S]*GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });
  it("la reserva bloquea la rifa y hay índice único de números vivos", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX rifa_tickets_live_number ON public.rifa_tickets (rifa_id, number) WHERE state <> 'liberado';");
    expect(migration).toMatch(/FUNCTION public\.rifa_lock[\s\S]*FOR UPDATE/);
  });
  it("la página pública es solo /rifa/<slug>; la gestión sigue con sesión", () => {
    const mw = read("lib/supabase/middleware.ts");
    expect(mw).toContain("const isRifaPublica = /^\\/rifa\\/[a-z0-9]{8}$/.test(path);");
  });
  it("el service worker nunca cachea rifas", () => {
    expect(read("app/sw.ts")).toContain("/^\\/rifas?(\\/|$)/");
  });
  it("sin next/image en las rifas (free tier)", () => {
    for (const f of ["components/rifas/RifaComprador.tsx", "components/rifas/RifaGestion.tsx", "components/rifas/RifaBoard.tsx"]) {
      expect(read(f)).not.toMatch(/from "next\/image"/);
    }
  });
});
