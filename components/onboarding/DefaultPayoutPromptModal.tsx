// components/onboarding/DefaultPayoutPromptModal.tsx
// Modal "agregá tu cuenta para cobrar" mostrado a TODOS los users que
// aún no tienen un default. Saltable. Cuando lo guardan queda en
// users.default_payout_method/account/account_name y al ganar pollas
// se pre-llena solo.
//
// Reglas por método (alineadas al verifier AI):
//   - nequi:        celular (sin nombre).
//   - bancolombia:  cuenta + nombre completo (Sonnet usa el nombre
//                   para verificar screenshots).
//   - otro:         cuenta + nombre completo.
"use client";

import { useState } from "react";
import { CreditCard, X } from "lucide-react";

export type PayoutMethod = "nequi" | "bancolombia" | "otro";

const METHOD_OPTIONS: Array<{
  id: PayoutMethod;
  label: string;
  accountPlaceholder: string;
  needsName: boolean;
}> = [
  { id: "nequi", label: "Nequi", accountPlaceholder: "Número de celular", needsName: false },
  { id: "bancolombia", label: "Bancolombia", accountPlaceholder: "Número de cuenta", needsName: true },
  { id: "otro", label: "Otro", accountPlaceholder: "Banco + tipo + número", needsName: true },
];

interface Props {
  open: boolean;
  initialMethod?: PayoutMethod;
  initialAccount?: string;
  initialAccountName?: string;
  onSubmit: (
    method: PayoutMethod,
    account: string,
    accountName: string | null,
  ) => Promise<void> | void;
  onSkip: () => void;
}

export default function DefaultPayoutPromptModal({
  open,
  initialMethod,
  initialAccount,
  initialAccountName,
  onSubmit,
  onSkip,
}: Props) {
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [accountName, setAccountName] = useState(initialAccountName ?? "");
  const [saving, setSaving] = useState(false);

  if (!open) return null;
  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;
  const needsName = cur.needsName;
  const canSave =
    !!account.trim() && !saving && (!needsName || accountName.trim().length >= 2);

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      const finalName = needsName ? accountName.trim() : null;
      await onSubmit(method, account.trim(), finalName);
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
            Cuando ganes una polla, todos te pagarán directamente a esta cuenta.
          </p>
        </div>

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

        <input
          type="text"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder={cur.accountPlaceholder}
          className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 mb-2"
          autoFocus
        />

        {needsName ? (
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Nombre completo como aparece en la cuenta"
            className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 mb-2"
          />
        ) : null}

        <p className="text-[11px] text-text-muted text-center mb-3">
          {needsName
            ? "El nombre tiene que ser EXACTAMENTE como aparece en tu cuenta."
            : "Nequi solo se identifica por celular."}
          {" "}Solo lo ven los participantes de pollas donde ganes.
        </p>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSave}
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
