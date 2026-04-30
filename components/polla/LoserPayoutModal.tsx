// components/polla/LoserPayoutModal.tsx — Modal post-cierre para los
// que NO ganaron. Muestra el ganador, el monto que deben pagar, y la
// info de pago (método + cuenta) ya rellenada por el ganador. Acciones:
// "Ya pagué" (marca payment_status=settled del lado del que paga) o
// "Pagar después" (cierra el modal pero sigue mostrando el banner pinned
// hasta que confirmen). Video de fondo: la-polla-triste para subrayar
// que les toca pagar — sin culpa, en tono parcero.
"use client";

import { useState } from "react";
import { Banknote, X } from "lucide-react";
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

interface Winner {
  display_name: string;
  payout_method: string | null;
  payout_account: string | null;
}

interface Props {
  open: boolean;
  pollaName: string;
  amountOwed: number;
  winners: Winner[];
  /** When true, hide "Pagar después" — used for the recurring nag. */
  forceAction?: boolean;
  onMarkPaid: () => Promise<void> | void;
  onLater?: () => void;
  onClose?: () => void;
}

export default function LoserPayoutModal({
  open,
  pollaName,
  amountOwed,
  winners,
  forceAction = false,
  onMarkPaid,
  onLater,
  onClose,
}: Props) {
  const [paying, setPaying] = useState(false);
  if (!open) return null;

  const allReady = winners.every((w) => w.payout_method && w.payout_account);

  async function pay() {
    if (paying) return;
    setPaying(true);
    try {
      await onMarkPaid();
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
      <video
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        poster="/videos/la-polla-triste-poster.webp"
      >
        <source src="/videos/la-polla-triste.webm" type="video/webm" />
        <source src="/videos/la-polla-triste-lite.mp4" type="video/mp4" />
      </video>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(8,12,16,0.12) 0%, rgba(8,12,16,0.6) 100%)",
        }}
      />
      <div className="relative w-full max-w-sm p-5 pb-7 rounded-2xl bg-bg-card/72 backdrop-blur-xl border border-amber/35 shadow-[0_0_30px_rgba(255,159,28,0.22)] animate-fade-in">
        {onClose && !forceAction && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors p-1"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <div className="flex flex-col items-center text-center mb-4">
          <div className="w-12 h-12 rounded-full bg-amber/15 border border-amber/40 flex items-center justify-center mb-2">
            <Banknote className="w-6 h-6 text-amber" />
          </div>
          <h2 className="font-display text-[22px] tracking-[0.04em] text-text-primary uppercase">
            Hay que pagar
          </h2>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {pollaName} terminó.{" "}
            {winners.length === 1 ? `Ganó ${winners[0].display_name}` : `Ganaron ${winners.length} jugadores`}.
          </p>
          <p className="font-display text-[32px] tracking-[0.04em] text-amber mt-2 tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
            {fmtCOP(amountOwed)}
          </p>
          <p className="text-[11px] text-text-muted">tu parte</p>
        </div>

        {/* Winner accounts */}
        {allReady ? (
          <ul className="space-y-2 mb-4">
            {winners.map((w, i) => (
              <li
                key={i}
                className="rounded-xl px-3 py-2.5 bg-bg-elevated border border-border-subtle flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-text-primary truncate">{w.display_name}</p>
                  <p className="text-[12px] text-text-secondary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                    {METHOD_LABEL[w.payout_method!] ?? w.payout_method} · {w.payout_account}
                  </p>
                </div>
                <CopyAccountButton value={w.payout_account!} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl px-3 py-3 bg-bg-elevated border border-border-subtle text-center mb-4">
            <p className="text-[12px] text-text-secondary">
              Esperando que{" "}
              {winners
                .filter((w) => !w.payout_account)
                .map((w) => w.display_name)
                .join(", ")}{" "}
              indique{winners.length > 1 ? "n" : ""} cómo cobrar.
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              Pegale un toque por WhatsApp para que abra la app.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {onLater && !forceAction && (
            <button
              type="button"
              onClick={onLater}
              className="flex-1 px-3 py-3 rounded-xl border border-border-subtle text-text-secondary text-sm hover:border-text-secondary/40 transition-colors"
            >
              Pagar después
            </button>
          )}
          <button
            type="button"
            onClick={pay}
            disabled={paying || !allReady}
            className="flex-1 bg-gold text-bg-base font-display text-base tracking-wide py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
          >
            {paying ? "GUARDANDO…" : "YA PAGUÉ"}
          </button>
        </div>
      </div>
    </div>
  );
}
