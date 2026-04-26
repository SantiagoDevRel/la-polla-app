// components/polla/PrizeDistributionView.tsx
// Read-only view of the prize distribution. Shown to all participants
// inside the Tabla tab. Admins see the editable PrizeDistributionEditor
// in the same slot instead.
"use client";

import { Trophy } from "lucide-react";
import type { PrizeDistribution } from "@/components/polla/PrizeDistributionForm";

interface Props {
  pot: number;
  distribution: PrizeDistribution | null;
}

const ORDINAL_ES = ["1°", "2°", "3°", "4°", "5°", "6°", "7°", "8°", "9°", "10°"];
function ordinal(p: number): string {
  return ORDINAL_ES[p - 1] ?? `${p}°`;
}

function fmtCOP(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function PrizeDistributionView({ pot, distribution }: Props) {
  return (
    <section className="rounded-2xl p-5 lp-card space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5 text-gold flex-shrink-0" />
        <h3 className="text-sm font-bold text-text-primary">Premios</h3>
      </div>

      {!distribution || distribution.prizes.length === 0 ? (
        <p className="text-xs text-text-muted">
          El organizador aún no definió la distribución de premios.
        </p>
      ) : (
        <ul className="space-y-2">
          {distribution.prizes.map((p) => {
            const cop =
              distribution.mode === "percentage"
                ? (pot * p.value) / 100
                : p.value;
            const showCopPreview = distribution.mode === "percentage" && pot > 0;
            return (
              <li
                key={p.position}
                className="flex items-center gap-3 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle"
              >
                <span
                  className="font-display text-[20px] text-gold w-10 text-center"
                  style={{ fontFeatureSettings: '"tnum"' }}
                >
                  {ordinal(p.position)}
                </span>
                <div className="flex-1 flex items-baseline gap-2">
                  <span className="text-base font-semibold text-text-primary">
                    {distribution.mode === "percentage"
                      ? `${p.value}%`
                      : fmtCOP(p.value)}
                  </span>
                  {showCopPreview && (
                    <span className="text-[11px] text-text-muted">
                      ≈ {fmtCOP(cop)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
