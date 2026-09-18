import { formatCop } from "@/lib/casa/format";

/**
 * Premio que se puede anunciar al compartir. Solo cuando ya se conoce: pozo
 * fijo (la cifra sale de casa_polla_pot, nunca se calcula aquí) u objeto.
 * Pozo proporcional → null: depende de cuántos entren y solo se anuncia la entrada.
 */
export type PremioCompartir = { cop: number } | { objeto: string } | null;

/** El premio anunciable de una polla; `prizeCop` sale de casa_polla_pot. */
export function premioCompartir(
  polla: { prize_kind?: string | null; prize_object?: string | null; pot_mode?: string | null },
  prizeCop: number,
): PremioCompartir {
  if (polla.prize_kind === "objeto") return polla.prize_object ? { objeto: polla.prize_object } : null;
  return polla.pot_mode === "fijo" ? { cop: prizeCop } : null;
}

/**
 * (2026-09-14) Pedido del dueño: «Únete, entrada 20 mil, premio 1 millón».
 * (2026-09-17) Con `codigo`, el mensaje lleva el código de invitación: si la
 * persona entra a la página sin el enlace, igual puede escribirlo al pagar.
 */
export function textoCompartir({
  nombre,
  entradaCop,
  premio,
  codigo = null,
  english = false,
}: {
  nombre: string;
  entradaCop: number;
  premio: PremioCompartir;
  codigo?: string | null;
  english?: boolean;
}): string {
  if (english) {
    const entry = entradaCop === 0 ? "Entry: free" : `Entry: ${formatCop(entradaCop)} COP`;
    const prize = !premio ? "" : "cop" in premio ? ` · Prize: ${formatCop(premio.cop)} COP` : ` · Prize: ${premio.objeto}`;
    return `Join ${nombre} on Chicken Picks.\n${entry}${prize}${codigo ? `\nUse my code ${codigo} when you join.` : ""}`;
  }
  // Compartir una polla gratis decía «Entrada: $0» (migración 143).
  const entrada = entradaCop === 0 ? "Entrada: gratis" : `Entrada: ${formatCop(entradaCop)}`;
  const extra = !premio ? "" : "cop" in premio ? ` · Premio: ${formatCop(premio.cop)}` : ` · Premio: ${premio.objeto}`;
  return `Únete a ${nombre} en La Polla Colombiana.\n${entrada}${extra}${codigo ? `\nUsa mi código ${codigo} al inscribirte.` : ""}`;
}
