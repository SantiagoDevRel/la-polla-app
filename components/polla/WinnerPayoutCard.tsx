// components/polla/WinnerPayoutCard.tsx — Card que va arriba de la
// Tabla cuando la polla terminó. Muestra cada ganador (1°, 2°, 3°…),
// el monto y la cuenta con botón Copiar. Si el ganador todavía no llenó
// su info de pago, muestra un placeholder "Esperando que indique cómo
// cobrar".
"use client";

import { Trophy } from "lucide-react";
import { CopyAccountButton } from "./WinnerPayoutModal";

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

const METHOD_LABEL: Record<string, string> = {
  nequi: "Nequi",
  daviplata: "Daviplata",
  bancolombia: "Bancolombia",
  transfiya: "Transfiya",
  otro: "Otro",
};

export interface WinnerRow {
  position: number;
  display_name: string;
  prize_amount: number;
  payout_method: string | null;
  payout_account: string | null;
  /** True when this card represents the current viewer. */
  isMe?: boolean;
  paid_count?: number;
  total_to_collect?: number;
}

const ORD = ["1°", "2°", "3°", "4°", "5°"];
function ordinal(p: number): string {
  return ORD[p - 1] ?? `${p}°`;
}

interface Props {
  winners: WinnerRow[];
}

export default function WinnerPayoutCard({ winners }: Props) {
  if (winners.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 lp-card border border-gold/25 shadow-[0_0_20px_rgba(255,215,0,0.08)] space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4 text-gold" />
        <h3 className="font-display text-[14px] tracking-[0.06em] text-gold uppercase">
          Cómo pagarle a los ganadores
        </h3>
      </div>
      <ul className="space-y-2">
        {winners.map((w) => (
          <li
            key={w.position}
            className="rounded-xl px-3 py-3 bg-bg-elevated border border-border-subtle"
          >
            <div className="flex items-center gap-2">
              <span className="font-display text-[18px] text-gold tabular-nums w-9 text-center" style={{ fontFeatureSettings: '"tnum"' }}>
                {ordinal(w.position)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-text-primary truncate">
                  {w.display_name}
                  {w.isMe ? <span className="text-[10px] text-gold ml-1">(tú)</span> : null}
                </p>
                {w.payout_account ? (
                  <p className="text-[12px] text-text-secondary truncate tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                    {METHOD_LABEL[w.payout_method!] ?? w.payout_method} · {w.payout_account}
                  </p>
                ) : (
                  <p className="text-[12px] text-text-muted truncate">
                    Esperando que indique cómo cobrar…
                  </p>
                )}
              </div>
              <span className="font-display text-[16px] text-gold tabular-nums shrink-0" style={{ fontFeatureSettings: '"tnum"' }}>
                {fmtCOP(w.prize_amount)}
              </span>
              {w.payout_account ? <CopyAccountButton value={w.payout_account} /> : null}
            </div>
            {w.isMe && w.total_to_collect !== undefined && w.paid_count !== undefined ? (
              <p className="mt-2 text-[11px] text-text-secondary">
                {w.paid_count} de {w.total_to_collect} ya te pagaron.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
