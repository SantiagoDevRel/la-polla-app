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

import { useEffect, useMemo, useState } from "react";
import { CreditCard, Pencil, Check } from "lucide-react";
import { useTranslations } from "next-intl";

export type PayoutMethod = "nequi" | "bancolombia" | "otro";
export type PayoutAccountType = "ahorros" | "corriente";

interface Props {
  initialMethod?: PayoutMethod | null;
  initialAccount?: string | null;
  initialAccountName?: string | null;
  initialAccountType?: PayoutAccountType | null;
  onSave: (
    method: PayoutMethod,
    account: string,
    accountName: string | null,
    accountType: PayoutAccountType | null,
  ) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
}

export default function PayoutDefaultEditor({
  initialMethod,
  initialAccount,
  initialAccountName,
  initialAccountType,
  onSave,
  onClear,
}: Props) {
  const t = useTranslations("Payout");
  const tCommon = useTranslations("Common");
  const METHOD_OPTIONS = useMemo<Array<{
    id: PayoutMethod;
    label: string;
    accountPlaceholder: string;
    needsName: boolean;
    needsAccountType: boolean;
  }>>(
    () => [
      {
        id: "nequi",
        label: t("methodNequi"),
        accountPlaceholder: t("placeholderPhoneExample"),
        needsName: false,
        needsAccountType: false,
      },
      {
        id: "bancolombia",
        label: t("methodBancolombia"),
        accountPlaceholder: t("placeholderAccount"),
        needsName: true,
        needsAccountType: true,
      },
      {
        id: "otro",
        label: t("methodOtro"),
        accountPlaceholder: t("placeholderBankCombo"),
        needsName: true,
        needsAccountType: true,
      },
    ],
    [t],
  );
  const METHOD_LABEL: Record<PayoutMethod, string> = useMemo(
    () => ({
      nequi: t("methodNequi"),
      bancolombia: t("methodBancolombia"),
      otro: t("methodOtro"),
    }),
    [t],
  );
  const ACCOUNT_TYPE_LABEL: Record<PayoutAccountType, string> = useMemo(
    () => ({
      ahorros: t("accountTypeAhorros"),
      corriente: t("accountTypeCorriente"),
    }),
    [t],
  );

  const hasInitial = !!(initialMethod && initialAccount);
  const [mode, setMode] = useState<"view" | "edit">(hasInitial ? "view" : "edit");
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "nequi");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [accountName, setAccountName] = useState(initialAccountName ?? "");
  const [accountType, setAccountType] = useState<PayoutAccountType | null>(
    initialAccountType ?? null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "edit" && saving === false) return;
    setMethod(initialMethod ?? "nequi");
    setAccount(initialAccount ?? "");
    setAccountName(initialAccountName ?? "");
    setAccountType(initialAccountType ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMethod, initialAccount, initialAccountName, initialAccountType]);

  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;
  const needsName = cur.needsName;
  const needsAccountType = cur.needsAccountType;
  const canSave =
    !!account.trim() &&
    !saving &&
    (!needsName || accountName.trim().length >= 2) &&
    (!needsAccountType || accountType !== null);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const finalName = needsName ? accountName.trim() : null;
      const finalType = needsAccountType ? accountType : null;
      await onSave(method, account.trim(), finalName, finalType);
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
    setAccountType(null);
    setMode("edit");
  }

  // ── VIEW MODE ───────────────────────────────────────────────────────
  if (mode === "view" && hasInitial) {
    return (
      <section className="rounded-2xl p-4 lp-card flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-gold flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">
            {t("editorTitle")}
          </p>
          <p
            className="text-sm font-semibold text-text-primary truncate tabular-nums"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {initialAccount}
          </p>
          <p className="text-[11px] text-text-muted truncate">
            {initialAccountType ? `${ACCOUNT_TYPE_LABEL[initialAccountType]} ` : ""}
            {METHOD_LABEL[initialMethod!]}
            {initialAccountName ? ` · ${initialAccountName}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={startEdit}
          aria-label={t("editorAriaEdit")}
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
      <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-gold" /> {t("editorTitle")}
      </h3>

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

      {needsAccountType ? (
        <div className="flex flex-wrap gap-1.5">
          {(["ahorros", "corriente"] as const).map((accType) => (
            <button
              key={accType}
              type="button"
              onClick={() => setAccountType(accType)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                accountType === accType
                  ? "bg-gold text-bg-base border-gold"
                  : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-gold/40"
              }`}
            >
              {ACCOUNT_TYPE_LABEL[accType]}
            </button>
          ))}
        </div>
      ) : null}

      {needsName ? (
        <input
          type="text"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder={t("placeholderNameSimple")}
          className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
        />
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {saving ? t("savingShort") : (<><Check className="w-4 h-4" /> {t("saveShort")}</>)}
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
            {tCommon("cancel")}
          </button>
        ) : null}
        {hasInitial && onClear ? (
          <button
            type="button"
            onClick={clearAccount}
            className="px-3 py-2 rounded-xl border border-border-subtle text-text-muted text-sm hover:border-red-alert/40 hover:text-red-alert transition-colors"
          >
            {t("delete")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
