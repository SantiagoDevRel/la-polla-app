// components/polla/WinnerPayoutModal.tsx — Modal full-screen para que
// el ganador deje su método de pago al cerrar la polla. Video de
// celebración de fondo. Server-side se llama post-cierre cuando el
// viewer es ganador y todavía no llenó payout_account.
"use client";

import { useState } from "react";
import { Trophy, Copy, X } from "lucide-react";

export type PayoutMethod = "nequi" | "daviplata" | "bancolombia" | "transfiya" | "otro";

const METHOD_OPTIONS: Array<{ id: PayoutMethod; label: string; placeholder: string }> = [
  { id: "nequi", label: "Nequi", placeholder: "Número de celular (ej: 311 314 7831)" },
  { id: "daviplata", label: "Daviplata", placeholder: "Número de celular" },
  { id: "bancolombia", label: "Bancolombia", placeholder: "Número de cuenta de ahorros" },
  { id: "transfiya", label: "Transfiya", placeholder: "Llave (celular o usuario)" },
  { id: "otro", label: "Otro", placeholder: "Banco + tipo + número (ej: Davivienda 0011-...)" },
];

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

interface Props {
  open: boolean;
  pollaName: string;
  position: number; // 1, 2, 3...
  prizeAmount: number;
  /** Pre-fill from user profile if they had set a default. */
  initialMethod?: PayoutMethod;
  initialAccount?: string;
  onSubmit: (method: PayoutMethod, account: string) => Promise<void> | void;
  onClose?: () => void;
}

export default function WinnerPayoutModal({
  open,
  pollaName,
  position,
  prizeAmount,
  initialMethod,
  initialAccount,
  onSubmit,
  onClose,
}: Props) {
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;
  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;
  const ord = position === 1 ? "1°" : position === 2 ? "2°" : position === 3 ? "3°" : `${position}°`;

  async function submit() {
    if (!account.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(method, account.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      {/* Video background. The celebration clip is short + loops; lite
          mp4 keeps the bandwidth bounded. Poster used while loading. */}
      <video
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        poster="/videos/la-polla-celebration-poster.webp"
      >
        <source src="/videos/la-polla-celebration.webm" type="video/webm" />
        <source src="/videos/la-polla-celebration-lite.mp4" type="video/mp4" />
      </video>
      {/* Dim + gold gradient over the video for legibility. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(8,12,16,0.45) 0%, rgba(8,12,16,0.85) 100%)",
        }}
      />
      {/* Content */}
      <div className="relative w-full sm:max-w-md p-5 pb-8 sm:rounded-2xl rounded-t-3xl bg-bg-card/85 backdrop-blur-md border-t sm:border border-gold/25 shadow-[0_0_40px_rgba(255,215,0,0.18)] animate-fade-in">
        {onClose && (
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
          <div className="w-14 h-14 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center shadow-[0_0_24px_rgba(255,215,0,0.25)] mb-2">
            <Trophy className="w-7 h-7 text-gold" />
          </div>
          <h2 className="font-display text-[26px] tracking-[0.04em] text-gold uppercase">
            ¡Ganaste!
          </h2>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {ord} puesto en <span className="font-semibold text-text-primary">{pollaName}</span>
          </p>
          <p className="font-display text-[36px] tracking-[0.04em] text-gold mt-1 tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
            {fmtCOP(prizeAmount)}
          </p>
          <p className="text-[12px] text-text-secondary mt-1.5 max-w-[90%]">
            El parche te tiene que pagar. Decinos cómo.
          </p>
        </div>

        {/* Method picker */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {METHOD_OPTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                method === m.id
                  ? "bg-gold text-bg-base border-gold"
                  : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-gold/40"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Account input */}
        <input
          type="text"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder={cur.placeholder}
          className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 mb-4"
          autoFocus
        />

        <button
          type="button"
          onClick={submit}
          disabled={!account.trim() || submitting}
          className="w-full bg-gold text-bg-base font-display text-lg tracking-wide py-3.5 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 shadow-[0_0_24px_rgba(255,215,0,0.25)]"
        >
          {submitting ? "GUARDANDO…" : "DECIRLE AL PARCHE"}
        </button>

        <p className="text-[11px] text-text-muted text-center mt-3">
          Solo los participantes de {pollaName} verán esta info.
        </p>
      </div>
    </div>
  );
}

// Helper utilitario reutilizable por otras vistas (Tabla post-ended).
export function CopyAccountButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold transition-colors"
    >
      <Copy className="w-3 h-3" /> {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
