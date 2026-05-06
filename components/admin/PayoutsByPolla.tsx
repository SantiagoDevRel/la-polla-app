// components/admin/PayoutsByPolla.tsx
//
// Card del admin dashboard que lista todos los pagos (polla_payouts)
// agrupados por polla. Cada polla es un acordeón colapsable; cuando
// se abre, las transacciones scrollean dentro del bloque (no inflan
// el scroll global del dashboard).
//
// Solo lectura — el admin ve estado pero no marca/desmarca acá. Para
// gestionar pagos puntuales el admin entra a la polla y usa el modal
// de PollaPayoutFlow.

"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { ChevronDown, Image as ImageIcon, Check, Clock, X } from "lucide-react";

interface TxRow {
  id: string;
  fromName: string;
  toName: string;
  amount: number;
  paid: boolean;
  paidAt: string | null;
  hasProof: boolean;
  proofUploadedAt: string | null;
}

interface PollaBlock {
  pollaId: string;
  pollaSlug: string | null;
  pollaName: string;
  pollaStatus: string;
  paymentMode: string;
  buyIn: number;
  totalAmount: number;
  paidAmount: number;
  paidCount: number;
  pendingCount: number;
  txs: TxRow[];
}

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function PayoutsByPolla() {
  const [pollas, setPollas] = useState<PollaBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [viewingProofUrl, setViewingProofUrl] = useState<string | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<{ pollas: PollaBlock[] }>(
        "/api/admin/payouts-by-polla",
      );
      setPollas(res.data.pollas);
    } catch {
      setPollas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(pollaId: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(pollaId)) next.delete(pollaId);
      else next.add(pollaId);
      return next;
    });
  }

  async function viewProof(pollaSlug: string | null, txId: string) {
    if (!pollaSlug || loadingProofId) return;
    setLoadingProofId(txId);
    try {
      const res = await axios.get<{ url: string | null }>(
        `/api/pollas/${pollaSlug}/payout-confirm/${txId}/proof`,
      );
      if (res.data.url) setViewingProofUrl(res.data.url);
    } catch {
      /* swallow */
    } finally {
      setLoadingProofId(null);
    }
  }

  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-text-primary">Pagos por polla</h2>
        <span className="text-xs text-text-muted">{pollas.length}</span>
      </div>

      {loading ? (
        <p className="text-xs text-text-muted text-center py-4">Cargando…</p>
      ) : pollas.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-4">
          Sin pagos registrados — ninguna polla cerrada todavía.
        </p>
      ) : (
        // Scroll global del card capeado para que no infle la página.
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {pollas.map((p) => {
            const isOpen = openIds.has(p.pollaId);
            return (
              <div
                key={p.pollaId}
                className="rounded-xl"
                style={{ background: "#131d2e", border: "1px solid rgba(255,255,255,0.04)" }}
              >
                {/* Header: tap → expand */}
                <button
                  type="button"
                  onClick={() => toggle(p.pollaId)}
                  className="w-full p-3 flex items-center gap-3 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {p.pollaName}
                    </p>
                    <p className="text-xs text-text-muted">
                      {p.pollaStatus} · {p.paymentMode} · pozo{" "}
                      {fmtCOP(p.totalAmount)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      {p.pendingCount > 0 ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber/15 border border-amber/30 text-amber font-semibold">
                          {p.pendingCount} pend.
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-turf/15 border border-turf/30 text-turf font-semibold">
                          ✓ todos
                        </span>
                      )}
                      <span className="text-text-muted">
                        {p.paidCount}/{p.txs.length}
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-text-muted flex-shrink-0 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isOpen ? (
                  // Lista de tx scrollable interno — máx 280px para que
                  // pollas con muchos pagos no estiren el card global.
                  <div className="border-t border-white/5 max-h-[280px] overflow-y-auto">
                    {p.txs.map((tx) => (
                      <div
                        key={tx.id}
                        className="px-3 py-2 flex items-center gap-2 border-b border-white/5 last:border-0"
                      >
                        <div className="flex-shrink-0">
                          {tx.paid ? (
                            <Check className="w-4 h-4 text-turf" />
                          ) : (
                            <Clock className="w-4 h-4 text-amber" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-text-primary truncate">
                            <span className="text-text-muted">{tx.fromName}</span>
                            <span className="mx-1 text-text-muted">→</span>
                            <span>{tx.toName}</span>
                          </p>
                          <p className="text-[10px] text-text-muted">
                            {tx.paid && tx.paidAt
                              ? `Pagado ${new Date(tx.paidAt).toLocaleDateString(
                                  "es-CO",
                                  { day: "2-digit", month: "short" },
                                )}`
                              : "Pendiente"}
                          </p>
                        </div>
                        {tx.hasProof ? (
                          <button
                            type="button"
                            onClick={() => viewProof(p.pollaSlug, tx.id)}
                            disabled={loadingProofId === tx.id}
                            className="flex-shrink-0 p-1.5 rounded hover:bg-white/5 transition-colors disabled:opacity-50"
                            title="Ver comprobante"
                            aria-label="Ver comprobante"
                          >
                            <ImageIcon className="w-3.5 h-3.5 text-gold" />
                          </button>
                        ) : null}
                        <span
                          className="text-[12px] text-gold font-semibold tabular-nums flex-shrink-0"
                          style={{ fontFeatureSettings: '"tnum"' }}
                        >
                          {fmtCOP(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox del comprobante. Mismo patrón que GlobalPayoutBanner. */}
      {viewingProofUrl ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={() => setViewingProofUrl(null)}
        >
          <button
            type="button"
            onClick={() => setViewingProofUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            aria-label="Cerrar"
          >
            <X className="w-6 h-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewingProofUrl}
            alt="Comprobante de pago"
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </section>
  );
}
