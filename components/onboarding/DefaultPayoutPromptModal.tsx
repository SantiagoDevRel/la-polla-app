// components/onboarding/DefaultPayoutPromptModal.tsx
// Modal "agregá tu cuenta para cobrar" que se le muestra a TODOS los
// users la primera vez que entran a /inicio sin tener un default
// guardado en perfil. Cuando lo guardan, queda en
// users.default_payout_method/account y al ganar cualquier polla se
// pre-llena solo — sin nag.
//
// Diseño:
//   - Centrado, full-screen-mobile-bottomsheet desktop, gold border.
//   - "Saltar por ahora" disponible — no bloquea el uso de la app.
//   - Una vez saltado, se mantiene una flag en sessionStorage para
//     no nag-ear varias veces en la misma visita. Al próximo session
//     vuelve a aparecer hasta que lo guarden o lo descarten en perfil.
"use client";

import { useState } from "react";
import { CreditCard, X } from "lucide-react";

export type PayoutMethod = "nequi" | "daviplata" | "bancolombia" | "transfiya" | "otro";

const METHOD_OPTIONS: Array<{ id: PayoutMethod; label: string; placeholder: string }> = [
  { id: "nequi", label: "Nequi", placeholder: "Número de celular" },
  { id: "daviplata", label: "Daviplata", placeholder: "Número de celular" },
  { id: "bancolombia", label: "Bancolombia", placeholder: "Número de cuenta" },
  { id: "transfiya", label: "Transfiya", placeholder: "Llave (celular o usuario)" },
  { id: "otro", label: "Otro", placeholder: "Banco + tipo + número" },
];

interface Props {
  open: boolean;
  initialMethod?: PayoutMethod;
  initialAccount?: string;
  onSubmit: (method: PayoutMethod, account: string) => Promise<void> | void;
  onSkip: () => void;
}

export default function DefaultPayoutPromptModal({
  open,
  initialMethod,
  initialAccount,
  onSubmit,
  onSkip,
}: Props) {
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [saving, setSaving] = useState(false);

  if (!open) return null;
  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;

  async function handleSubmit() {
    if (!account.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(method, account.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 bg-black/55 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-sm bg-bg-card border border-gold/30 rounded-2xl p-5 shadow-[0_0_40px_rgba(255,215,0,0.18)] animate-fade-in">
        <button
          type="button"
          onClick={onSkip}
          className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors p-1"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center mb-4 pr-2">
          <div className="w-14 h-14 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center shadow-[0_0_24px_rgba(255,215,0,0.18)] mb-2">
            <CreditCard className="w-7 h-7 text-gold" />
          </div>
          <h2 className="font-display text-[22px] tracking-[0.04em] text-gold uppercase">
            Tu cuenta para cobrar
          </h2>
          <p className="text-[13px] text-text-secondary mt-1.5 leading-snug">
            Dejá tu Nequi, Bancolombia o lo que uses. Cuando ganes una polla, el parche te paga directo a esa cuenta.
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
          className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 mb-2"
          autoFocus
        />

        <p className="text-[11px] text-text-muted text-center mb-3">
          Solo lo ven los participantes de pollas donde ganes. Lo podés borrar o cambiar en /perfil.
        </p>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!account.trim() || saving}
          className="w-full bg-gold text-bg-base font-display text-base tracking-wide py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(255,215,0,0.2)]"
        >
          {saving ? "GUARDANDO…" : "GUARDAR"}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors py-2"
        >
          Saltar por ahora
        </button>
      </div>
    </div>
  );
}
