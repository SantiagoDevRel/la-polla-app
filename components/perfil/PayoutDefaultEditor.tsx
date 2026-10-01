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
//   - llave:        llave Bre-B (letras, números y @). Sin nombre.
//   - otro:         banco + cuenta, dos campos alfanuméricos que se
//                   guardan juntos («Banco · cuenta», ver
//                   lib/payout/account-format.ts).
//
// Comportamiento:
//   - Si ya hay cuenta seteada → modo VIEW: muestra resumen + lápiz.
//   - Si NO hay → modo EDIT: editor completo.
//   - Después de guardar → vuelve a modo VIEW automáticamente.
"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Banknote, Pencil, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import ProfileSectionHeading from "./ProfileSectionHeading";
import {
  joinOtherBank,
  onlyDigits,
  payoutAccountError,
  sanitizeBankAccount,
  sanitizeBankName,
  sanitizeLlave,
  splitOtherBank,
  type PayoutMethodId,
} from "@/lib/payout/account-format";

export type PayoutMethod = PayoutMethodId;
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
  allowedMethods?: readonly PayoutMethod[];
}

export default function PayoutDefaultEditor({
  initialMethod,
  initialAccount,
  initialAccountName,
  initialAccountType,
  onSave,
  onClear,
  allowedMethods,
}: Props) {
  const id = useId();
  const t = useTranslations("Payout");
  const tCommon = useTranslations("Common");
  const tProfile = useTranslations("Profile");
  const METHOD_OPTIONS = useMemo<Array<{
    id: PayoutMethod;
    label: string;
    accountPlaceholder: string;
    needsName: boolean;
    needsAccountType: boolean;
  }>>(
    () => [
      {
        id: "bancolombia",
        label: t("methodBancolombia"),
        accountPlaceholder: t("placeholderAccount"),
        needsName: true,
        needsAccountType: true,
      },
      {
        id: "nequi",
        label: t("methodNequi"),
        accountPlaceholder: t("placeholderPhoneExample"),
        needsName: false,
        needsAccountType: false,
      },
      {
        id: "llave",
        label: t("methodLlave"),
        accountPlaceholder: t("placeholderLlave"),
        needsName: false,
        needsAccountType: false,
      },
      {
        id: "otro",
        label: t("methodOtro"),
        accountPlaceholder: t("placeholderOtherAccount"),
        needsName: false,
        needsAccountType: false,
      },
    ],
    [t],
  );
  const METHOD_LABEL: Record<PayoutMethod, string> = useMemo(
    () => ({
      nequi: t("methodNequi"),
      bancolombia: t("methodBancolombia"),
      llave: t("methodLlave"),
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
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "bancolombia");
  const initialOther = splitOtherBank(initialMethod === "otro" ? initialAccount : null);
  const [account, setAccount] = useState(initialMethod === "otro" ? initialOther.account : initialAccount ?? "");
  const [bank, setBank] = useState(initialOther.bank);
  const [accountName, setAccountName] = useState(initialAccountName ?? "");
  const [accountType, setAccountType] = useState<PayoutAccountType | null>(
    initialAccountType ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && saving === false) return;
    resetToInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMethod, initialAccount, initialAccountName, initialAccountType]);

  function resetToInitial() {
    const other = splitOtherBank(initialMethod === "otro" ? initialAccount : null);
    setMethod(initialMethod ?? "bancolombia");
    setAccount(initialMethod === "otro" ? other.account : initialAccount ?? "");
    setBank(other.bank);
    setAccountName(initialAccountName ?? "");
    setAccountType(initialAccountType ?? null);
  }

  function changeMethod(next: PayoutMethod) {
    if (next === method) return;
    setMethod(next);
    // Cada método tiene su propio formato: no arrastrar lo escrito.
    setAccount("");
    setBank("");
  }

  function sanitizeAccount(value: string): string {
    if (method === "nequi" || method === "bancolombia") return onlyDigits(value);
    if (method === "llave") return sanitizeLlave(value);
    return sanitizeBankAccount(value);
  }

  const cur = METHOD_OPTIONS.find((m) => m.id === method)!;
  const needsName = cur.needsName;
  const needsAccountType = cur.needsAccountType;
  const finalAccount = method === "otro" ? joinOtherBank(bank, account) : account.trim();
  const formatError = account.trim() ? payoutAccountError(method, finalAccount) : null;
  const canSave =
    !!account.trim() &&
    !formatError &&
    !saving &&
    (!needsName || accountName.trim().length >= 2) &&
    (!needsAccountType || accountType !== null);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const finalName = needsName ? accountName.trim() : null;
      const finalType = needsAccountType ? accountType : null;
      await onSave(method, finalAccount, finalName, finalType);
      setMode("view");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tProfile("errSavePayout"));
    } finally {
      setSaving(false);
    }
  }

  function startEdit() {
    if (allowedMethods && !allowedMethods.includes(method)) setMethod(allowedMethods[0] ?? "bancolombia");
    setMode("edit");
  }

  async function clearAccount() {
    if (!onClear) return;
    await onClear();
    setMethod("bancolombia");
    setAccount("");
    setBank("");
    setAccountName("");
    setAccountType(null);
    setMode("edit");
  }

  // ── VIEW MODE ───────────────────────────────────────────────────────
  if (mode === "view" && hasInitial) {
    return (
      <section className="rounded-2xl border-gold/20 p-4 lp-card space-y-3 hover:border-gold/40">
        <ProfileSectionHeading icon={Banknote} tone="money" title={t("editorTitle")} />
        <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p
            className="text-[15px] font-semibold leading-normal text-text-primary tabular-nums [overflow-wrap:anywhere]"
          >
            {initialAccount}
          </p>
          <p className="text-[13px] leading-normal text-text-secondary [overflow-wrap:anywhere]">
            {initialAccountType ? `${ACCOUNT_TYPE_LABEL[initialAccountType]} ` : ""}
            {METHOD_LABEL[initialMethod!]}
            {initialAccountName ? ` · ${initialAccountName}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={startEdit}
          aria-label={t("editorAriaEdit")}
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-border-subtle transition-colors hover:border-gold/50 hover:bg-gold/5"
        >
          <Pencil className="w-4 h-4 text-text-secondary" />
        </button>
        </div>
      </section>
    );
  }

  // ── EDIT MODE ───────────────────────────────────────────────────────
  return (
    <section className="rounded-2xl border-gold/20 p-5 lp-card space-y-3 hover:border-gold/40">
      <ProfileSectionHeading icon={Banknote} tone="money" title={t("editorTitle")} />

      <div className="grid grid-cols-2 gap-1.5">
        {METHOD_OPTIONS.filter((m) => !allowedMethods || allowedMethods.includes(m.id)).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => changeMethod(m.id)}
            aria-pressed={method === m.id}
            className={`min-h-11 cursor-pointer rounded-full border px-3 py-1.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${
                method === m.id
                ? "bg-bg-elevated text-text-primary border-text-secondary"
                : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-gold/40"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === "otro" ? (
        <div className="space-y-2">
          <label htmlFor={`${id}-bank`} className="block text-[15px] font-medium text-text-primary">{t("labelBank")}</label>
          <input
            id={`${id}-bank`}
            type="text"
            value={bank}
            onChange={(e) => setBank(sanitizeBankName(e.target.value))}
            placeholder={t("placeholderBank")}
            autoComplete="off"
            maxLength={60}
            className="lp-input min-w-0 text-[15px]"
          />
        </div>
      ) : null}

      <label htmlFor={`${id}-account`} className="block text-[15px] font-medium text-text-primary">
        {method === "nequi" ? t("placeholderPhone") : method === "llave" ? t("labelLlave") : t("placeholderAccount")}
      </label>
      <input
        id={`${id}-account`}
        type="text"
        inputMode={method === "nequi" || method === "bancolombia" ? "numeric" : "text"}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        value={account}
        onChange={(e) => setAccount(sanitizeAccount(e.target.value))}
        placeholder={cur.accountPlaceholder}
        maxLength={method === "nequi" ? 10 : method === "llave" ? 60 : 40}
        aria-describedby={formatError ? `${id}-format` : undefined}
        className="lp-input min-w-0 text-[15px]"
      />
      {formatError ? (
        <p id={`${id}-format`} className="text-[13px] text-text-secondary">{formatError}</p>
      ) : null}

      {needsAccountType ? (
        <div className="flex flex-wrap gap-1.5">
          {(["ahorros", "corriente"] as const).map((accType) => (
            <button
              key={accType}
              type="button"
              onClick={() => setAccountType(accType)}
              aria-pressed={accountType === accType}
              className={`min-h-11 cursor-pointer rounded-full border px-3 py-1.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${
                accountType === accType
                  ? "bg-bg-elevated text-text-primary border-text-secondary"
                  : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-gold/40"
              }`}
            >
              {ACCOUNT_TYPE_LABEL[accType]}
            </button>
          ))}
        </div>
      ) : null}

      {needsName ? (
        <div className="space-y-2">
        <label htmlFor={`${id}-name`} className="block text-[15px] font-medium text-text-primary">{t("placeholderNameSimple")}</label>
        <input
          id={`${id}-name`}
          type="text"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder={t("placeholderNameSimple")}
          className="lp-input min-w-0 text-[15px]"
        />
        </div>
      ) : null}

      {error && <p role="alert" className="text-[13px] text-red-alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold px-3 py-2 text-sm font-semibold text-bg-base transition-all hover:brightness-110 disabled:opacity-50"
        >
          {saving ? t("savingShort") : (<><Check className="w-4 h-4" /> {t("saveShort")}</>)}
        </button>
        {hasInitial ? (
          <button
            type="button"
            onClick={() => {
              resetToInitial();
              setMode("view");
            }}
            className="min-h-11 rounded-xl border border-border-subtle px-3 py-2 text-sm text-text-secondary transition-colors hover:border-text-secondary/40"
          >
            {tCommon("cancel")}
          </button>
        ) : null}
        {hasInitial && onClear ? (
          <button
            type="button"
            onClick={clearAccount}
            className="min-h-11 rounded-xl border border-border-subtle px-3 py-2 text-sm text-text-muted transition-colors hover:border-red-alert/40 hover:text-red-alert"
          >
            {t("delete")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
