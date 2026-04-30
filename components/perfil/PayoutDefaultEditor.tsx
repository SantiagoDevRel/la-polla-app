// components/perfil/PayoutDefaultEditor.tsx — Sección en /perfil para
// guardar un método+cuenta+nombre de pago default. Cuando un user
// gana una polla, el WinnerPayoutModal pre-llena con esto y solo
// confirma con un tap.
//
// Reglas por método (alineadas al verifier AI):
//   - nequi:        celular. NO se pide nombre (Nequi solo identifica
//                   por celular).
//   - bancolombia:  número de cuenta + nombre como aparece en el
//                   banco. Sonnet usa el nombre para verificar
//                   screenshots.
//   - otro:         número/llave + nombre como aparece. Mismo motivo.
//
// Comportamiento:
//   - Si ya hay cuenta seteada → modo VIEW: muestra resumen + lápiz.
//   - Si NO hay → modo EDIT: editor completo.
//   - Después de guardar → vuelve a modo VIEW automáticamente.
"use client";

import { useEffect, useState } from "react";
import { CreditCard, Pencil, Check } from "lucide-react";

export type PayoutMethod = "nequi" | "bancolombia" | "otro";

const METHOD_OPTIONS: Array<{
  id: PayoutMethod;
  label: string;
  accountPlaceholder: string;
  needsName: boolean;
  helper: string;
}> = [
  {
    id: "nequi",
    label: "Nequi",
    accountPlaceholder: "Número de celular (ej: 311 314 7831)",
    needsName: false,
    helper: "Nequi se identifica solo por celular.",
  },
  {
    id: "bancolombia",
    label: "Bancolombia",
    accountPlaceholder: "Número de cuenta",
    needsName: true,
    helper: "El nombre debe ser EXACTAMENTE como aparece en la cuenta del banco — lo usamos para validar el screenshot del pago.",
  },
  {
    id: "otro",
    label: "Otro",
    accountPlaceholder: "Banco + tipo + número",
    needsName: true,
    helper: "El nombre debe ser EXACTAMENTE como aparece en la cuenta — lo usamos para validar el screenshot del pago.",
  },
];

const METHOD_LABEL: Record<PayoutMethod, string> = {
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  otro: "Otro",
};

interface Props {
  initialMethod?: PayoutMethod | null;
  initialAccount?: string | null;
  initialAccountName?: string | null;
  onSave: (
    method: PayoutMethod,
    account: string,
    accountName: string | null,
  ) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
}

export default function PayoutDefaultEditor({
  initialMethod,
  initialAccount,
  initialAccountName,
  onSave,
  onClear,
}: Props) {
  const hasInitial = !!(initialMethod && initialAccount);
  const [mode, setMode] = useState<"view" | "edit">(hasInitial ? "view" : "edit");
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [accountName, setAccountName] = useState(initialAccountName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "edit" && saving === false) return;
    setMethod(initialMethod ?? "nequi");
    setAccount(initialAccount ?? "");
    setAccountName(initialAccountName ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMethod, initialAccount, initialAccountName]);

  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;
  const needsName = cur.needsName;
  const canSave =
    !!account.trim() && !saving && (!needsName || accountName.trim().length >= 2);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const finalName = needsName ? accountName.trim() : null;
      await onSave(method, account.trim(), finalName);
      setMode("view");
    } finally {
      setSaving(false);
    }
  }

  function startEdit() {
    setMode("edit");
  }

  async function clearAccount() {
    if (!onClear) return;
    await onClear();
    setMethod("nequi");
    setAccount("");
    setAccountName("");
    setMode("edit");
  }

  // ── VIEW MODE ───────────────────────────────────────────────────────
  if (mode === "view" && hasInitial) {
    return (
      <section className="rounded-2xl p-4 lp-card flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-gold flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">
            Cuenta para cobrar
          </p>
          <p
            className="text-sm font-semibold text-text-primary truncate tabular-nums"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {METHOD_LABEL[initialMethod!]} · {initialAccount}
          </p>
          {initialAccountName ? (
            <p className="text-[11px] text-text-muted truncate">
              A nombre de {initialAccountName}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={startEdit}
          aria-label="Editar cuenta"
          className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-border-subtle hover:border-gold/50 hover:bg-gold/5 transition-colors"
        >
          <Pencil className="w-4 h-4 text-text-secondary" />
        </button>
      </section>
    );
  }

  // ── EDIT MODE ───────────────────────────────────────────────────────
  return (
    <section className="rounded-2xl p-5 lp-card space-y-3">
      <div className="flex items-start gap-3">
        <CreditCard className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Cuenta para cobrar</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Cuando ganes una polla, todos te pagarán directamente a esta cuenta.
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
        placeholder={cur.accountPlaceholder}
        className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
      />

      {needsName ? (
        <div>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Nombre completo como aparece en la cuenta"
            className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
          />
          <p className="text-[11px] text-text-muted mt-1.5">{cur.helper}</p>
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">{cur.helper}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {saving ? "Guardando…" : (<><Check className="w-4 h-4" /> Guardar</>)}
        </button>
        {hasInitial ? (
          <button
            type="button"
            onClick={() => {
              setMethod(initialMethod ?? "nequi");
              setAccount(initialAccount ?? "");
              setAccountName(initialAccountName ?? "");
              setMode("view");
            }}
            className="px-3 py-2 rounded-xl border border-border-subtle text-text-secondary text-sm hover:border-text-secondary/40 transition-colors"
          >
            Cancelar
          </button>
        ) : null}
        {hasInitial && onClear ? (
          <button
            type="button"
            onClick={clearAccount}
            className="px-3 py-2 rounded-xl border border-border-subtle text-text-muted text-sm hover:border-red-alert/40 hover:text-red-alert transition-colors"
          >
            Borrar
          </button>
        ) : null}
      </div>
    </section>
  );
}
