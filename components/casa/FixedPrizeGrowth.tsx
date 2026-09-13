import { formatCop } from "@/lib/casa/format";

/** Punto de equilibrio del premio fijo, calculado en SQL por getFixedPrizeThreshold. */
export interface FixedPrizeThreshold { entriesToCover: number | null; entryPrizeCop: number }

/**
 * (2026-09-13) Pedido del dueño: explicar cuándo crece un premio fijo con
 * personas y pesos, no con el porcentaje de cada entrada. Ambas cifras vienen de
 * SQL; si falta alguna o el pozo no crece, no se dice nada.
 */
export function fixedPrizeGrows(threshold: FixedPrizeThreshold | null | undefined): threshold is { entriesToCover: number; entryPrizeCop: number } {
  return threshold?.entriesToCover != null && threshold.entryPrizeCop > 0;
}

export function FixedPrizeGrowth({ threshold }: { threshold: FixedPrizeThreshold | null | undefined }) {
  if (!fixedPrizeGrows(threshold)) return null;
  const n = threshold.entriesToCover;
  return <>
    Si más de {n} {n === 1 ? "persona se inscribe" : "personas se inscriben"}, el pozo crece{" "}
    <strong className="font-semibold text-text-primary">{formatCop(threshold.entryPrizeCop)}</strong> por cada persona adicional.
  </>;
}
