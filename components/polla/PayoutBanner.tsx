// components/polla/PayoutBanner.tsx — Banner pinned arriba del Inicio o
// del detail de la polla. Aparece para los participantes que dijeron
// "Pagar después" en el LoserPayoutModal — recordatorio sin modal.
"use client";

import { Banknote, ChevronRight } from "lucide-react";

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

interface Props {
  pollaName: string;
  amountOwed: number;
  winnerName: string;
  /** Optional secondary owed (when there are 2+ winners). Stays compact. */
  extraWinnerCount?: number;
  onTap: () => void;
}

export default function PayoutBanner({
  pollaName,
  amountOwed,
  winnerName,
  extraWinnerCount = 0,
  onTap,
}: Props) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 bg-amber/10 border border-amber/30 hover:bg-amber/15 transition-colors text-left"
    >
      <span className="w-8 h-8 rounded-full bg-amber/15 border border-amber/40 flex items-center justify-center shrink-0">
        <Banknote className="w-4 h-4 text-amber" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-text-primary truncate">
          Pendiente · {pollaName}
        </span>
        <span className="block text-[11px] text-text-secondary truncate">
          Pagale {fmtCOP(amountOwed)} a {winnerName}
          {extraWinnerCount > 0 ? ` y ${extraWinnerCount} más` : ""}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
    </button>
  );
}
