// components/perfil/PayoutDefaultEditor.tsx — Sección opcional en el
// perfil para guardar un método/cuenta de pago por default. Cuando un
// user gana una polla, el WinnerPayoutModal lo pre-llena con esto y
// solo necesita un tap para confirmar. Si nunca lo llenan, igual
// funciona el flow — solo tienen que tipear más.
"use client";

import { useState } from "react";
import { CreditCard, Check } from "lucide-react";

export type PayoutMethod = "nequi" | "daviplata" | "bancolombia" | "transfiya" | "otro";

const METHOD_OPTIONS: Array<{ id: PayoutMethod; label: string; placeholder: string }> = [
  { id: "nequi", label: "Nequi", placeholder: "Número de celular (ej: 311 314 7831)" },
  { id: "daviplata", label: "Daviplata", placeholder: "Número de celular" },
  { id: "bancolombia", label: "Bancolombia", placeholder: "Número de cuenta" },
  { id: "transfiya", label: "Transfiya", placeholder: "Llave (celular o usuario)" },
  { id: "otro", label: "Otro", placeholder: "Banco + tipo + número" },
];

interface Props {
  initialMethod?: PayoutMethod | null;
  initialAccount?: string | null;
  onSave: (method: PayoutMethod, account: string) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
}

export default function PayoutDefaultEditor({
  initialMethod,
  initialAccount,
  onSave,
  onClear,
}: Props) {
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;
  const hasAny = !!(initialMethod && initialAccount);

  async function save() {
    if (!account.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(method, account.trim());
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl p-5 lp-card space-y-3">
      <div className="flex items-start gap-3">
        <CreditCard className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Cuenta para cobrar</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Opcional. Si llenás esto, cuando ganes una polla solo confirmás con un tap.
            Solo se le muestra al parche cuando ganes.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
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
        placeholder={cur.placeholder}
        className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!account.trim() || saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {saving ? "Guardando…" : savedAt > 0 ? (<><Check className="w-4 h-4" /> Guardado</>) : "Guardar"}
        </button>
        {hasAny && onClear ? (
          <button
            type="button"
            onClick={() => { void onClear(); }}
            className="px-3 py-2 rounded-xl border border-border-subtle text-text-muted text-sm hover:border-red-alert/40 hover:text-red-alert transition-colors"
          >
            Borrar
          </button>
        ) : null}
      </div>
    </section>
  );
}
