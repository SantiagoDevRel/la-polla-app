// components/polla/PollaPayoutFlow.tsx
//
// Orquestador del flujo de pago al cierre de la polla.
// Se monta UNA vez en la página de polla. Internamente:
//
// 1. Trae el resumen de payouts (/api/pollas/:slug/payout-summary).
//    Si la polla todavía no está 'ended', no muestra nada.
//
// 2. Si la polla está cerrada y hay transacciones pendientes:
//    - Renderiza un banner pinned arriba con CTA "Ver pagos".
//    - La primera vez en la sesión (por polla.id) abre el modal solo.
//      Luego respeta el opt-out hasta que el usuario abra/cierre la app
//      de nuevo (sessionStorage).
//
// 3. Modal "PayoutSettlement":
//    - Si el viewer es ganador y todavía no dejó payout_method/account
//      → muestra el WinnerPayoutModal (input celebración) primero.
//      Al guardar via PATCH /payout-method, el modal salta al siguiente
//      paso: la lista de pagos.
//    - "Tus pagos" (myOutgoing) — cada uno con botón "Ya pagué".
//    - "Te tienen que pagar" (myIncoming) — cada uno con "Ya me pagaron"
//      + cuenta del que paga (raro, pero útil si el admin necesita
//      saber quién falta).
//    - Para admin: "Todos los pagos" colapsable con override
//      (mark-as-paid sin importar quién es from/to).
//    - Botón cerrar arriba — la X cierra solo el modal, el banner sigue
//      pinned hasta que todas las transacciones queden saldadas.
"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Banknote, Check, ChevronDown, X, Trophy, AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import WinnerPayoutModal, { CopyAccountButton, type PayoutMethod } from "./WinnerPayoutModal";

interface SummaryTransaction {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_display_name: string;
  to_display_name: string;
  to_payout_method: string | null;
  to_payout_account: string | null;
  amount: number;
  paid_at: string | null;
  paid_by_user_id: string | null;
  involvesViewer: boolean;
}

interface SummaryAllocation {
  user_id: string;
  display_name: string;
  rank: number;
  allocation: number;
  isTied: boolean;
  payout_method: string | null;
  payout_account: string | null;
}

interface PayoutSummary {
  polla: {
    id: string;
    slug: string;
    name: string;
    status: string;
    payment_mode: "admin_collects" | "pay_winner";
    buy_in_amount: number;
    created_by: string;
  };
  pot: number;
  isEnded: boolean;
  isAdmin: boolean;
  isViewerWinner: boolean;
  viewerHasPayoutAccount: boolean;
  myAllocation: { allocation: number; rank: number; isTied: boolean } | null;
  allocations: SummaryAllocation[];
  transactions: SummaryTransaction[];
  myOutgoing: SummaryTransaction[];
  myIncoming: SummaryTransaction[];
  allUnpaidTransactions: SummaryTransaction[];
  pendingTransactionsCount: number;
  errors: string[];
  warnings: string[];
  canSettle: boolean;
}

interface Props {
  slug: string;
  /** Re-fetch trigger — bump from parent if external state changes. */
  refreshKey?: number;
}

const METHOD_LABEL_KEYS: Record<string, string> = {
  nequi: "methodNequi",
  daviplata: "methodDaviplata",
  bancolombia: "methodBancolombia",
  transfiya: "methodTransfiya",
  otro: "methodOtro",
};

function sessionKey(pollaId: string): string {
  return `payout-modal-shown-${pollaId}`;
}

export default function PollaPayoutFlow({ slug, refreshKey = 0 }: Props) {
  const t = useTranslations("PayoutFlow");
  const tPayout = useTranslations("Payout");
  const locale = useLocale();
  const intlTag = locale === "en" ? "en-US" : "es-CO";
  const fmtCOP = (n: number): string => `$${Math.round(n).toLocaleString(intlTag)}`;
  const ordinal = (p: number): string => {
    if (p === 1) return tPayout("winnerPlace1");
    if (p === 2) return tPayout("winnerPlace2");
    if (p === 3) return tPayout("winnerPlace3");
    return tPayout("winnerPlaceN", { n: p });
  };
  const methodLabel = (method: string | null | undefined): string => {
    if (!method) return "";
    const key = METHOD_LABEL_KEYS[method];
    return key ? tPayout(key) : method;
  };
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [showAllAdmin, setShowAllAdmin] = useState(false);
  const [actingTxId, setActingTxId] = useState<string | null>(null);
  const [savingPayout, setSavingPayout] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await axios.get(`/api/pollas/${slug}/payout-summary`);
      setSummary(res.data);
    } catch (err) {
      // Si el viewer no es participante (403) o la polla no existe (404),
      // simplemente no mostramos nada. Otros errores se loguean.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 403 && status !== 404) {
        console.error("[payout-flow] fetch failed:", err);
      }
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary, refreshKey]);

  // Auto-open por sesión cuando hay deuda viewer-relacionada o el viewer
  // es admin con transacciones pendientes.
  useEffect(() => {
    if (loading || !summary || !summary.isEnded) return;
    if (summary.pendingTransactionsCount === 0) return;
    if (typeof window === "undefined") return;
    const k = sessionKey(summary.polla.id);
    if (window.sessionStorage.getItem(k) === "1") return;

    const hasViewerStake =
      summary.myOutgoing.length > 0 ||
      summary.myIncoming.length > 0 ||
      (summary.isAdmin && summary.allUnpaidTransactions.length > 0);
    if (!hasViewerStake) return;

    setModalOpen(true);
    if (summary.isViewerWinner && !summary.viewerHasPayoutAccount) {
      setWinnerOpen(true);
    }
    try {
      window.sessionStorage.setItem(k, "1");
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, [loading, summary]);

  async function saveWinnerAccount(
    method: PayoutMethod,
    account: string,
    accountName: string | null,
  ) {
    if (savingPayout) return;
    setSavingPayout(true);
    try {
      await axios.patch(`/api/pollas/${slug}/payout-method`, {
        method,
        account,
        accountName,
      });
      setWinnerOpen(false);
      await fetchSummary();
    } catch (err) {
      console.error("[payout-flow] save method failed:", err);
    } finally {
      setSavingPayout(false);
    }
  }

  async function markPaid(txId: string) {
    if (actingTxId) return;
    setActingTxId(txId);
    try {
      await axios.post(`/api/pollas/${slug}/payout-confirm/${txId}`);
      await fetchSummary();
    } catch (err) {
      console.error("[payout-flow] confirm failed:", err);
    } finally {
      setActingTxId(null);
    }
  }

  async function unmarkPaid(txId: string) {
    if (actingTxId) return;
    setActingTxId(txId);
    try {
      await axios.delete(`/api/pollas/${slug}/payout-confirm/${txId}`);
      await fetchSummary();
    } catch (err) {
      console.error("[payout-flow] unconfirm failed:", err);
    } finally {
      setActingTxId(null);
    }
  }

  if (loading || !summary || !summary.isEnded) return null;
  if (summary.errors.length === 0 && summary.pot === 0) return null;

  const hasViewerStake =
    summary.myOutgoing.length > 0 ||
    summary.myIncoming.length > 0 ||
    (summary.isAdmin && summary.allUnpaidTransactions.length > 0);
  const showBanner = summary.pendingTransactionsCount > 0 && hasViewerStake;
  const allSettled =
    summary.transactions.length > 0 && summary.pendingTransactionsCount === 0;

  return (
    <>
      {summary.errors.length > 0 ? (
        <div className="rounded-xl px-4 py-3 bg-red-alert/10 border border-red-alert/30 text-[12px] text-red-alert flex items-start gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{t("errCalcTitle")}</p>
            {summary.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        </div>
      ) : null}

      {showBanner ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full rounded-xl px-4 py-3 bg-gold/10 border border-gold/30 text-left flex items-center gap-3 hover:bg-gold/15 transition-colors mb-3"
        >
          <Banknote className="w-5 h-5 text-gold flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">
              {summary.isAdmin
                ? t("pendingPayments", { count: summary.pendingTransactionsCount })
                : summary.myIncoming.length > 0 && summary.myOutgoing.length === 0
                ? t("youGetPaid")
                : summary.myOutgoing.length > 0
                ? t("youHavePayment")
                : t("pollaPaymentsPending")}
            </p>
            <p className="text-[11px] text-text-secondary">{t("tapForDetail")}</p>
          </div>
          <span className="text-[11px] text-gold font-semibold">{t("viewArrow")}</span>
        </button>
      ) : null}

      {allSettled ? (
        <div className="rounded-xl px-4 py-2 bg-turf/10 border border-turf/30 flex items-center gap-2 mb-3">
          <Check className="w-4 h-4 text-turf flex-shrink-0" />
          <p className="text-[12px] text-turf font-medium">{t("allSettled")}</p>
        </div>
      ) : null}

      {/* Winner-needs-account modal (priority) */}
      {summary.isViewerWinner ? (
        <WinnerPayoutModal
          open={winnerOpen}
          pollaName={summary.polla.name}
          position={summary.myAllocation?.rank ?? 1}
          prizeAmount={summary.myAllocation?.allocation ?? 0}
          onSubmit={saveWinnerAccount}
          onClose={() => setWinnerOpen(false)}
        />
      ) : null}

      {/* Settlement modal — solo cuando NO hay un winner-modal pendiente
          que tomar precedencia. Si el ganador necesita poner cuenta,
          mostramos solo el WinnerPayoutModal y el SettlementModal queda
          en espera para abrirse después de que el winner save. */}
      {modalOpen && !winnerOpen ? (
        <SettlementModal
          summary={summary}
          actingTxId={actingTxId}
          onMarkPaid={markPaid}
          onUnmarkPaid={unmarkPaid}
          onClose={() => setModalOpen(false)}
          onOpenWinner={() => {
            // Cerrar settlement antes de abrir winner — evita que dos
            // modals se solapen tapando el video del WinnerPayoutModal.
            setModalOpen(false);
            setWinnerOpen(true);
          }}
          showAllAdmin={showAllAdmin}
          setShowAllAdmin={setShowAllAdmin}
          fmtCOP={fmtCOP}
          ordinal={ordinal}
          methodLabel={methodLabel}
        />
      ) : null}
    </>
  );
}

interface SettlementModalProps {
  summary: PayoutSummary;
  actingTxId: string | null;
  onMarkPaid: (txId: string) => void;
  onUnmarkPaid: (txId: string) => void;
  onClose: () => void;
  onOpenWinner: () => void;
  showAllAdmin: boolean;
  setShowAllAdmin: (v: boolean) => void;
  fmtCOP: (n: number) => string;
  ordinal: (p: number) => string;
  methodLabel: (method: string | null | undefined) => string;
}

function SettlementModal({
  summary,
  actingTxId,
  onMarkPaid,
  onUnmarkPaid,
  onClose,
  onOpenWinner,
  showAllAdmin,
  setShowAllAdmin,
  fmtCOP,
  ordinal,
  methodLabel,
}: SettlementModalProps) {
  const t = useTranslations("PayoutFlow");
  const tCommon = useTranslations("Common");
  const adminTxs = summary.transactions; // includes paid + unpaid
  const someoneOwesViewer = summary.myIncoming.length > 0;
  const viewerOwes = summary.myOutgoing.length > 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 bg-black/55 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-sm bg-bg-card border border-gold/20 rounded-2xl p-5 max-h-[88vh] overflow-y-auto shadow-[0_0_40px_rgba(255,215,0,0.18)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors p-1"
          aria-label={tCommon("close")}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-gold flex-shrink-0" />
          <h2 className="font-display text-[20px] tracking-[0.04em] text-gold uppercase">
            {t("modalTitle")}
          </h2>
        </div>

        <p className="text-[12px] text-text-secondary mb-3">
          {summary.polla.payment_mode === "admin_collects"
            ? t("modeAdminCollects")
            : t("modePayWinner")}
        </p>

        {summary.warnings.length > 0 ? (
          <div className="rounded-lg px-3 py-2 bg-amber/10 border border-amber/30 text-[11px] text-amber mb-3 space-y-1">
            {summary.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        ) : null}

        {/* Winner banner — viewer must input account */}
        {summary.isViewerWinner && !summary.viewerHasPayoutAccount ? (
          <button
            type="button"
            onClick={onOpenWinner}
            className="w-full rounded-xl px-3 py-3 bg-gold text-bg-base font-semibold text-[13px] mb-3 hover:brightness-110 transition-all"
          >
            {t("putMyAccount")}
          </button>
        ) : null}

        {/* Per-position summary */}
        <section className="mb-4">
          <h3 className="text-[10px] uppercase tracking-[0.1em] text-text-primary/60 mb-1.5">
            {t("prizes")}
          </h3>
          <ul className="space-y-1.5">
            {summary.allocations
              .filter((a) => a.allocation > 0)
              .map((a) => (
                <li
                  key={a.user_id}
                  className="rounded-lg px-3 py-2 bg-bg-elevated border border-border-subtle flex items-center gap-2"
                >
                  <span
                    className="font-display text-[15px] text-gold tabular-nums w-8 text-center"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {ordinal(a.rank)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">
                      {a.display_name}
                      {a.isTied ? <span className="text-[10px] text-text-secondary ml-1">{t("tied")}</span> : null}
                    </p>
                    {a.payout_account ? (
                      <p className="text-[11px] text-text-secondary truncate tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                        {methodLabel(a.payout_method)} · {a.payout_account}
                      </p>
                    ) : (
                      <p className="text-[11px] text-text-muted truncate">{t("noAccount")}</p>
                    )}
                  </div>
                  <span className="font-display text-[14px] text-gold tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                    {fmtCOP(a.allocation)}
                  </span>
                  {a.payout_account ? <CopyAccountButton value={a.payout_account} /> : null}
                </li>
              ))}
          </ul>
        </section>

        {/* Viewer-incoming */}
        {someoneOwesViewer ? (
          <section className="mb-4">
            <h3 className="text-[10px] uppercase tracking-[0.1em] text-turf mb-1.5">
              {t("sectionToCollect")}
            </h3>
            <ul className="space-y-1.5">
              {summary.myIncoming.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  label={t("youArrowFrom", { name: tx.from_display_name })}
                  onMark={() => onMarkPaid(tx.id)}
                  busy={actingTxId === tx.id}
                  ctaLabel={t("ctaIGotPaid")}
                  fmtCOP={fmtCOP}
                  methodLabel={methodLabel}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {/* Viewer-outgoing */}
        {viewerOwes ? (
          <section className="mb-4">
            <h3 className="text-[10px] uppercase tracking-[0.1em] text-amber mb-1.5">
              {t("sectionToPay")}
            </h3>
            <ul className="space-y-1.5">
              {summary.myOutgoing.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  label={t("youArrowTo", { name: tx.to_display_name })}
                  onMark={() => onMarkPaid(tx.id)}
                  busy={actingTxId === tx.id}
                  ctaLabel={t("ctaIPaid")}
                  fmtCOP={fmtCOP}
                  methodLabel={methodLabel}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {/* Admin override section */}
        {summary.isAdmin && adminTxs.length > 0 ? (
          <section className="mb-2">
            <button
              type="button"
              onClick={() => setShowAllAdmin(!showAllAdmin)}
              className="w-full flex items-center justify-between text-left mb-2"
            >
              <h3 className="text-[10px] uppercase tracking-[0.1em] text-text-primary/70">
                {t("sectionAllAdmin")}
              </h3>
              <ChevronDown
                className={`w-4 h-4 text-text-primary/70 transition-transform ${
                  showAllAdmin ? "rotate-180" : ""
                }`}
              />
            </button>
            {showAllAdmin ? (
              <ul className="space-y-1.5">
                {adminTxs.map((tx) => (
                  <li
                    key={tx.id}
                    className={`rounded-lg px-3 py-2 border flex items-center gap-2 ${
                      tx.paid_at
                        ? "bg-turf/5 border-turf/20"
                        : "bg-bg-elevated border-border-subtle"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-text-primary truncate">
                        {tx.from_display_name} → {tx.to_display_name}
                      </p>
                      {tx.to_payout_account ? (
                        <p className="text-[11px] text-text-secondary truncate tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                          {methodLabel(tx.to_payout_method)} · {tx.to_payout_account}
                        </p>
                      ) : (
                        <p className="text-[11px] text-text-muted truncate">
                          {t("noAccountAdminMark")}
                        </p>
                      )}
                    </div>
                    <span className="font-display text-[13px] text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                      {fmtCOP(tx.amount)}
                    </span>
                    {tx.paid_at ? (
                      <button
                        type="button"
                        onClick={() => onUnmarkPaid(tx.id)}
                        disabled={actingTxId === tx.id}
                        className="text-[10px] px-2 py-1 rounded-md border border-border-subtle text-text-muted hover:border-amber/40 hover:text-amber transition-colors disabled:opacity-50"
                      >
                        {actingTxId === tx.id ? "…" : t("undo")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onMarkPaid(tx.id)}
                        disabled={actingTxId === tx.id}
                        className="text-[10px] px-2 py-1 rounded-md bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                      >
                        {actingTxId === tx.id ? "…" : t("paid")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-3 px-3 py-2.5 rounded-xl border border-border-subtle text-text-secondary text-[13px] hover:border-text-secondary/40 transition-colors"
        >
          {t("close")}
        </button>
      </div>
    </div>
  );
}

interface TxRowProps {
  tx: SummaryTransaction;
  label: string;
  onMark: () => void;
  busy: boolean;
  ctaLabel: string;
  fmtCOP: (n: number) => string;
  methodLabel: (m: string | null | undefined) => string;
}

function TxRow({ tx, label, onMark, busy, ctaLabel, fmtCOP, methodLabel }: TxRowProps) {
  const t = useTranslations("PayoutFlow");
  return (
    <li className="rounded-lg px-3 py-2 bg-bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-text-primary truncate">{label}</p>
          {tx.to_payout_account ? (
            <p className="text-[11px] text-text-secondary truncate tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
              {methodLabel(tx.to_payout_method)} · {tx.to_payout_account}
            </p>
          ) : (
            <p className="text-[11px] text-text-muted">
              {t("awaitingAccount")}
            </p>
          )}
        </div>
        <span
          className="font-display text-[14px] text-gold tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {fmtCOP(tx.amount)}
        </span>
        {tx.to_payout_account ? <CopyAccountButton value={tx.to_payout_account} /> : null}
      </div>
      <button
        type="button"
        onClick={onMark}
        disabled={busy}
        className="mt-2 w-full text-[12px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
      >
        {busy ? t("savingShort") : ctaLabel}
      </button>
    </li>
  );
}
