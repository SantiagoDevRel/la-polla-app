import { formatCop } from "@/lib/casa/format";

/**
 * Premio que se puede anunciar al compartir. Solo cuando ya se conoce: pozo
 * fijo (la cifra sale de casa_polla_pot, nunca se calcula aquí) u objeto.
 * Pozo proporcional → null: depende de cuántos entren y solo se anuncia la entrada.
 */
export type PremioCompartir = { cop: number } | { objeto: string } | null;

/** (2026-09-14) Pedido del dueño: «Únete, entrada 20 mil, premio 1 millón». */
export function textoCompartir({
  nombre,
  entradaCop,
  premio,
  english = false,
}: {
  nombre: string;
  entradaCop: number;
  premio: PremioCompartir;
  english?: boolean;
}): string {
  if (english) {
    const entry = `Entry: ${formatCop(entradaCop)} COP`;
    const prize = !premio ? "" : "cop" in premio ? ` · Prize: ${formatCop(premio.cop)} COP` : ` · Prize: ${premio.objeto}`;
    return `Join ${nombre} on Chicken Picks.\n${entry}${prize}`;
  }
  const entrada = `Entrada: ${formatCop(entradaCop)}`;
  const extra = !premio ? "" : "cop" in premio ? ` · Premio: ${formatCop(premio.cop)}` : ` · Premio: ${premio.objeto}`;
  return `Únete a ${nombre} en La Polla Colombiana.\n${entrada}${extra}`;
}
