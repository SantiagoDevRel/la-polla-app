// components/perfil/PayoutDefaultEditor.tsx — Sección en /perfil para
// guardar un método+cuenta de pago default. Cuando un user gana una
// polla, el WinnerPayoutModal pre-llena con esto y solo confirma con
// un tap.
//
// Comportamiento:
//   - Si ya hay cuenta seteada → modo VIEW: muestra "Bancolombia · 0123"
//     y un botón con lápiz para editar.
//   - Si NO hay → modo EDIT: editor completo con chips + input.
//   - Después de guardar → vuelve a modo VIEW automáticamente.
"use client";

import { useEffect, useState } from "react";
import { CreditCard, Pencil, Check } from "lucide-react";

export type PayoutMethod = "nequi" | "daviplata" | "bancolombia" | "transfiya" | "otro";

const METHOD_OPTIONS: Array<{ id: PayoutMethod; label: string; placeholder: string }> = [
  { id: "nequi", label: "Nequi", placeholder: "Número de celular (ej: 311 314 7831)" },
  { id: "daviplata", label: "Daviplata", placeholder: "Número de celular" },
  { id: "bancolombia", label: "Bancolombia", placeholder: "Número de cuenta" },
  { id: "transfiya", label: "Transfiya", placeholder: "Llave (celular o usuario)" },
  { id: "otro", label: "Otro", placeholder: "Banco + tipo + número" },
];

const METHOD_LABEL: Record<PayoutMethod, string> = {
  nequi: "Nequi",
  daviplata: "Daviplata",
  bancolombia: "Bancolombia",
  transfiya: "Transfiya",
  otro: "Otro",
};

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
  const hasInitial = !!(initialMethod && initialAccount);
  const [mode, setMode] = useState<"view" | "edit">(hasInitial ? "view" : "edit");
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [saving, setSaving] = useState(false);

  // Mantener sincronía si el padre cambia los initials (ej. después de
  // refetch). Si el user está editando activamente NO pisamos sus
  // cambios — solo cuando volvemos a entrar a la página.
  useEffect(() => {
    if (mode === "edit" && saving === false) return; // no override mid-edit
    setMethod(initialMethod ?? "nequi");
    setAccount(initialAccount ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMethod, initialAccount]);

  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;

  async function save() {
    if (!account.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(method, account.trim());
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
          {saving ? "Guardando…" : (<><Check className="w-4 h-4" /> Guardar</>)}
        </button>
        {hasInitial ? (
          <button
            type="button"
            onClick={() => {
              setMethod(initialMethod ?? "nequi");
              setAccount(initialAccount ?? "");
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
