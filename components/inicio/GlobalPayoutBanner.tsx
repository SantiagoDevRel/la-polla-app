// components/inicio/GlobalPayoutBanner.tsx
//
// Banner pinned arriba de /inicio cuando el viewer tiene transacciones
// pendientes en cualquier polla (incoming o outgoing). Tap → abre un
// modal con la lista detallada y botones para marcar como pagado.
//
// Diferencia con PollaPayoutFlow: ese vive dentro de /pollas/[slug] y
// solo conoce esa polla. Este es global — agrega de TODAS las pollas
// del user. Mismo endpoint resuelve la lista (predicado de viewer
// involvement ya filtrado server-side).
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Banknote, Copy, X, Check } from "lucide-react";

interface PendingPayout {
  transactionId: string;
  pollaId: string;
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

export default function GlobalPayoutBanner() {
  const router = useRouter();
  const [items, setItems] = useState<PendingPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<{ pending: PendingPayout[] }>(
        "/api/users/me/pending-payouts",
      );
      setItems(res.data.pending);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-open una vez por sesión cuando hay tx pendientes — el user no
  // tiene que clickear el banner la primera vez. Después de cerrar
  // (X o "Cerrar") queda pinned hasta que se salde todo.
  useEffect(() => {
    if (loading || items.length === 0) return;
    if (typeof window === "undefined") return;
    const k = "global-payout-modal-shown";
    if (window.sessionStorage.getItem(k) === "1") return;
    setOpen(true);
    try {
      window.sessionStorage.setItem(k, "1");
    } catch {
      /* sessionStorage unavailable */
    }
  }, [loading, items.length]);

  async function markPaid(item: PendingPayout) {
    if (actingId) return;
    setActingId(item.transactionId);
    try {
      await axios.post(
        `/api/pollas/${item.pollaSlug}/payout-confirm/${item.transactionId}`,
      );
      await load();
    } catch {
      /* swallow */
    } finally {
      setActingId(null);
    }
  }

  async function copyAccount(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (loading || items.length === 0) return null;

  const incoming = items.filter((i) => i.direction === "incoming");
  const outgoing = items.filter((i) => i.direction === "outgoing");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl px-4 py-3 bg-gold/10 border border-gold/35 text-left flex items-center gap-3 hover:bg-gold/15 transition-colors"
      >
        <Banknote className="w-5 h-5 text-gold flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text-primary">
            {items.length === 1
              ? incoming.length === 1
                ? "Te tienen que pagar"
                : "Tenés un pago pendiente"
              : `${items.length} pagos pendientes`}
          </p>
          <p className="text-[11px] text-text-secondary truncate">
            {incoming.length > 0 && outgoing.length > 0
              ? `${incoming.length} por cobrar · ${outgoing.length} por pagar`
              : incoming.length > 0
              ? `Total a cobrar: ${fmtCOP(incoming.reduce((s, i) => s + i.amount, 0))}`
              : `Total a pagar: ${fmtCOP(outgoing.reduce((s, i) => s + i.amount, 0))}`}
          </p>
        </div>
        <span className="text-[11px] text-gold font-semibold">Ver →</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 bg-black/55 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-sm bg-bg-card border border-gold/20 rounded-2xl p-5 max-h-[88vh] overflow-y-auto shadow-[0_0_40px_rgba(255,215,0,0.18)]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors p-1"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-4 pr-6">
              <h2 className="font-display text-[20px] tracking-[0.04em] text-gold uppercase">
                Pagos pendientes
              </h2>
              <p className="text-[12px] text-text-secondary mt-0.5">
                De todas tus pollas finalizadas.
              </p>
            </div>

            {incoming.length > 0 ? (
              <section className="mb-4">
                <h3 className="text-[10px] uppercase tracking-[0.1em] text-turf mb-2">
                  Te tienen que pagar
                </h3>
                <ul className="space-y-2">
                  {incoming.map((it) => (
                    <li
                      key={it.transactionId}
                      className="rounded-lg px-3 py-2.5 bg-bg-elevated border border-border-subtle"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-text-primary truncate">
                            {it.counterpartyName}
                          </p>
                          <p className="text-[11px] text-text-muted truncate">
                            {it.pollaName}
                          </p>
                        </div>
                        <span
                          className="font-display text-[16px] text-gold tabular-nums"
                          style={{ fontFeatureSettings: '"tnum"' }}
                        >
                          {fmtCOP(it.amount)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => markPaid(it)}
                        disabled={actingId === it.transactionId}
                        className="w-full text-[12px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                      >
                        {actingId === it.transactionId ? "…" : "Ya me pagaron"}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {outgoing.length > 0 ? (
              <section className="mb-4">
                <h3 className="text-[10px] uppercase tracking-[0.1em] text-amber mb-2">
                  Te toca pagar
                </h3>
                <ul className="space-y-2">
                  {outgoing.map((it) => {
                    const acct = it.counterpartyAccount;
                    const hasAccount = acct?.method && acct?.account;
                    return (
                      <li
                        key={it.transactionId}
                        className="rounded-lg px-3 py-2.5 bg-bg-elevated border border-border-subtle"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-text-primary truncate">
                              {it.counterpartyName}
                            </p>
                            <p className="text-[11px] text-text-muted truncate">
                              {it.pollaName}
                            </p>
                          </div>
                          <span
                            className="font-display text-[16px] text-gold tabular-nums"
                            style={{ fontFeatureSettings: '"tnum"' }}
                          >
                            {fmtCOP(it.amount)}
                          </span>
                        </div>
                        {hasAccount ? (
                          <div className="flex items-center gap-2 mb-2">
                            <p
                              className="flex-1 min-w-0 truncate text-[11px] text-text-secondary tabular-nums"
                              style={{ fontFeatureSettings: '"tnum"' }}
                            >
                              {METHOD_LABEL[acct!.method!] ?? acct!.method} · {acct!.account}
                            </p>
                            <button
                              type="button"
                              onClick={() => copyAccount(acct!.account!, it.transactionId)}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold transition-colors"
                            >
                              {copied === it.transactionId ? (
                                <>
                                  <Check className="w-3 h-3" /> Copiado
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" /> Copiar
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          <p className="text-[11px] text-text-muted mb-2">
                            Esperando que indique cómo cobrar…
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => markPaid(it)}
                          disabled={actingId === it.transactionId}
                          className="w-full text-[12px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                        >
                          {actingId === it.transactionId ? "…" : "Ya pagué"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full mt-3 px-3 py-2.5 rounded-xl border border-border-subtle text-text-secondary text-[13px] hover:border-text-secondary/40 transition-colors"
            >
              Cerrar
            </button>

            {items.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/pollas/${items[0].pollaSlug}`);
                }}
                className="w-full mt-2 text-[11px] text-text-muted underline"
              >
                Ir a la polla
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
