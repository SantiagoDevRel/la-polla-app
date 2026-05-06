// components/admin/UserPayoutsPreview.tsx
//
// Modal del admin que renderiza una preview READ-ONLY del modal de
// pagos pendientes que vería un usuario específico al entrar a /inicio.
// Sirve para que el admin verifique "esto es lo que ve Casvi", "esto
// es lo que ve John", etc., sin tener que loguearse como esa persona.
//
// Sin botones de accion: solo lista. El admin que quiera intervenir va
// al modal de Pagos por polla en su propio dashboard.

"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { X, Banknote, Image as ImageIcon, ArrowDown, ArrowUp } from "lucide-react";

interface PendingPayout {
  transactionId: string;
  pollaSlug: string;
  pollaName: string;
  paymentMode: string;
  direction: "incoming" | "outgoing";
  amount: number;
  counterpartyName: string;
  counterpartyAccount: {
    method: string | null;
    account: string | null;
  } | null;
  hasProof: boolean;
  proofUploadedAt: string | null;
}

interface Payload {
  target: { id: string; displayName: string | null };
  pending: PendingPayout[];
}

const METHOD_LABEL: Record<string, string> = {
  nequi: "Nequi",
  daviplata: "Daviplata",
  bancolombia: "Bancolombia",
  transfiya: "Transfiya",
  otro: "Otro",
};

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function UserPayoutsPreview({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get<Payload>(
          `/api/admin/users/${userId}/pending-payouts`,
        );
        if (!cancelled) {
          setData(res.data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "No se pudo cargar la preview";
          setError(msg);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const incoming =
    data?.pending.filter((p) => p.direction === "incoming") ?? [];
  const outgoing =
    data?.pending.filter((p) => p.direction === "outgoing") ?? [];
  const targetName = data?.target.displayName ?? "este usuario";

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center px-4 py-6 bg-black/65 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-bg-card border border-gold/20 rounded-2xl p-5 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0e1420" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-text-muted hover:text-text-primary p-1"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-3 pr-6">
          <p className="text-[10px] uppercase tracking-wide text-gold/70">
            Preview admin
          </p>
          <h2 className="text-base font-bold text-text-primary mt-0.5">
            Lo que ve {targetName}
          </h2>
          <p className="text-[11px] text-text-muted">
            Modal de pagos pendientes en su /inicio.
          </p>
        </div>

        {loading ? (
          <p className="text-xs text-text-muted text-center py-6">Cargando…</p>
        ) : error ? (
          <p className="text-xs text-red-alert">{error}</p>
        ) : !data || data.pending.length === 0 ? (
          <div className="rounded-lg p-4 text-center" style={{ background: "#131d2e" }}>
            <Banknote className="w-6 h-6 text-text-muted mx-auto mb-2" />
            <p className="text-xs text-text-muted">
              No tiene pagos pendientes — no le aparece ningún modal.
            </p>
          </div>
        ) : (
          <>
            {incoming.length > 0 ? (
              <section className="mb-4">
                <h3 className="text-[10px] uppercase tracking-[0.1em] text-turf mb-2 flex items-center gap-1">
                  <ArrowDown className="w-3 h-3" />
                  Le tienen que pagar ({incoming.length})
                </h3>
                <ul className="space-y-1.5">
                  {incoming.map((it) => (
                    <li
                      key={it.transactionId}
                      className="rounded-lg px-3 py-2 text-[12px]"
                      style={{ background: "#131d2e" }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-text-primary truncate flex-1">
                          {it.counterpartyName}
                        </p>
                        <span
                          className="font-display text-gold tabular-nums flex-shrink-0"
                          style={{ fontFeatureSettings: '"tnum"', fontSize: 14 }}
                        >
                          {fmtCOP(it.amount)}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted truncate">
                        {it.pollaName}
                        {it.hasProof ? (
                          <span className="ml-1 text-gold inline-flex items-center gap-0.5">
                            <ImageIcon className="w-3 h-3" /> con comprobante
                          </span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {outgoing.length > 0 ? (
              <section className="mb-2">
                <h3 className="text-[10px] uppercase tracking-[0.1em] text-amber mb-2 flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" />
                  Le toca pagar ({outgoing.length})
                </h3>
                <p className="text-[10px] text-red-alert/80 mb-2">
                  Modal bloqueado para {targetName} hasta que marque cada uno.
                </p>
                <ul className="space-y-1.5">
                  {outgoing.map((it) => {
                    const acct = it.counterpartyAccount;
                    const hasAccount = acct?.method && acct?.account;
                    return (
                      <li
                        key={it.transactionId}
                        className="rounded-lg px-3 py-2 text-[12px]"
                        style={{ background: "#131d2e" }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-text-primary truncate flex-1">
                            {it.counterpartyName}
                          </p>
                          <span
                            className="font-display text-gold tabular-nums flex-shrink-0"
                            style={{ fontFeatureSettings: '"tnum"', fontSize: 14 }}
                          >
                            {fmtCOP(it.amount)}
                          </span>
                        </div>
                        <p className="text-[10px] text-text-muted truncate">
                          {it.pollaName}
                          {it.hasProof ? (
                            <span className="ml-1 text-gold inline-flex items-center gap-0.5">
                              <ImageIcon className="w-3 h-3" /> con comprobante
                            </span>
                          ) : null}
                        </p>
                        {hasAccount ? (
                          <p
                            className="text-[10px] text-text-secondary tabular-nums truncate mt-0.5"
                            style={{ fontFeatureSettings: '"tnum"' }}
                          >
                            {METHOD_LABEL[acct!.method!] ?? acct!.method} ·{" "}
                            {acct!.account}
                          </p>
                        ) : (
                          <p className="text-[10px] text-text-muted mt-0.5">
                            (sin cuenta del cobrador)
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
