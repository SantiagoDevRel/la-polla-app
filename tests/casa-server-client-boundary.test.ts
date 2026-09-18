import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * (2026-09-18) `/polla/[slug]/page.tsx` es un Server Component y llamaba
 * `faltanTexto()`, exportada por `components/casa/Participaciones.tsx`, que es
 * "use client". Next lo rechaza en RUNTIME, no en el build:
 *
 *   Attempted to call faltanTexto() from the server but faltanTexto is on the
 *   client. It's not possible to invoke a client function from the server.
 *
 * Solo reventaba para quien estaba inscrito, con un cupo y pronósticos
 * pendientes — a esa persona la polla entera se le caía en «Se nos enredó la
 * cancha», y el build seguía verde. Este test cubre lo que el build no ve.
 */
const page = readFileSync(new URL("../app/(app)/polla/[slug]/page.tsx", import.meta.url), "utf8");

/** Lo que el Server Component importa de cada módulo, por ruta. */
function importedFrom(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const [, names, from] of source.matchAll(re)) {
    const list = names.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    out.set(from, [...(out.get(from) ?? []), ...list]);
  }
  return out;
}

function isClientModule(spec: string): boolean {
  if (!spec.startsWith("@/")) return false;
  for (const ext of [".tsx", ".ts"]) {
    try {
      return readFileSync(new URL(`../${spec.slice(2)}${ext}`, import.meta.url), "utf8")
        .trimStart().startsWith('"use client"');
    } catch { /* probar la otra extensión */ }
  }
  return false;
}

/** Un componente se RENDERIZA desde el servidor; una función se LLAMA. */
const esComponente = (nombre: string) => /^[A-Z]/.test(nombre);

describe("frontera servidor/cliente en /polla/[slug]", () => {
  it("no importa funciones (no componentes) desde módulos \"use client\"", () => {
    const ofensas: string[] = [];
    for (const [from, names] of importedFrom(page)) {
      if (!isClientModule(from)) continue;
      for (const name of names) if (!esComponente(name)) ofensas.push(`${name} ← ${from}`);
    }
    expect(ofensas).toEqual([]);
  });

  it("faltanTexto vive en un módulo sin \"use client\"", () => {
    expect(page).toContain('import { faltanTexto } from "@/lib/casa/participaciones-texto"');
    const modulo = readFileSync(new URL("../lib/casa/participaciones-texto.ts", import.meta.url), "utf8");
    expect(modulo.trimStart().startsWith('"use client"')).toBe(false);
    expect(modulo).toContain("faltanTexto");
  });
});
