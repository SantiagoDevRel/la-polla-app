import { formatCop } from "@/lib/casa/format";

/** Umbrales del premio fijo, calculados en SQL por getFixedPrizeThreshold. */
export interface FixedPrizeThreshold { entriesToCover: number | null; entriesToGrow: number | null; entryPrizeCop: number }

/**
 * (2026-09-13) Pedido del dueño: explicar cuándo crece un premio fijo con
 * personas y pesos, no con el porcentaje de cada entrada. Ambas cifras vienen de
 * SQL; si falta alguna o el pozo no crece, no se dice nada.
 * (2026-09-15, migración 125) El pozo crece desde que lo recaudado pasa el DOBLE
 * del premio: la cifra de personas es entriesToGrow, no entriesToCover.
 */
export function fixedPrizeGrows(threshold: FixedPrizeThreshold | null | undefined): threshold is FixedPrizeThreshold & { entriesToGrow: number } {
  return threshold?.entriesToGrow != null && threshold.entryPrizeCop > 0;
}

export function FixedPrizeGrowth({ threshold }: { threshold: FixedPrizeThreshold | null | undefined }) {
  if (!fixedPrizeGrows(threshold)) return null;
  const n = threshold.entriesToGrow;
  const amount = <strong className="font-semibold text-text-primary">{formatCop(threshold.entryPrizeCop)}</strong>;
  // (migración 126) n = entradas que no hacen crecer el pozo; 0 si una sola entrada ya pasa el doble.
  if (n === 0) return <>El pozo crece {amount} por cada persona que se inscribe.</>;
  return <>
    Si más de {n} {n === 1 ? "persona se inscribe" : "personas se inscriben"}, el pozo crece {amount} por cada persona adicional.
  </>;
}
