// components/inicio/UnpaidPollasBanner.tsx
//
// Banner urgente en /inicio cuando el viewer tiene pollas activas
// admin_collects donde todavía no pagó. Tap → abre un modal
// no-bloqueante con los datos de pago + CTA "Subir comprobante" que
// lo lleva directo a la polla.
//
// Más urgente que el GlobalPayoutBanner (ese es para pagos de fin
// de polla — esto es para QUE PUEDA EMPEZAR a pronosticar). Por eso
// usa rojo/amber en vez de gold.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertTriangle, X, Copy, Check } from "lucide-react";

interface UnpaidPolla {
  pollaSlug: string;
  pollaName: string;
  buyInAmount: number;
  adminPayoutMethod: "nequi" | "bancolombia" | "otro" | null;
  adminPayoutAccount: string | null;
  adminPayoutAccountName: string | null;
  adminPaymentInstructions: string | null;
  proofStatus: "none" | "pending_review" | "rejected";
  lastRejectionReason: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  otro: "Otro",
};

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

const SESSION_KEY = "unpaid-pollas-modal-shown";

export default function UnpaidPollasBanner() {
  const router = useRouter();
  const [items, setItems] = useState<UnpaidPolla[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<{ unpaid: UnpaidPolla[] }>(
        "/api/users/me/unpaid-pollas",
      );
      setItems(res.data.unpaid);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-open una vez por sesión cuando hay pollas con pago pendiente.
  // No nag-eamos varias veces — el banner queda visible y es tappable.
  useEffect(() => {
    if (loading || items.length === 0) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return;
    setOpen(true);
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* sessionStorage unavailable */
    }
  }, [loading, items.length]);

  async function copyAccount(account: string, slug: string) {
    try {
      await navigator.clipboard.writeText(account);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (loading || items.length === 0) return null;

  const totalOwed = items.reduce((s, i) => s + i.buyInAmount, 0);
  const headline =
    items.length === 1
      ? `Hacé tu pago para empezar a pronosticar`
      : `${items.length} pollas esperan tu pago`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl px-4 py-3 bg-red-alert/10 border border-red-alert/35 text-left flex items-center gap-3 hover:bg-red-alert/15 transition-colors"
      >
        <AlertTriangle className="w-5 h-5 text-red-alert flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text-primary">{headline}</p>
          <p className="text-[11px] text-text-secondary truncate">
            {items.length === 1
              ? `${fmtCOP(items[0].buyInAmount)} en ${items[0].pollaName}`
              : `${fmtCOP(totalOwed)} totales · tap para ver detalle`}
          </p>
        </div>
        <span className="text-[11px] text-red-alert font-bold whitespace-nowrap">Pagar →</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 bg-black/55 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-sm bg-bg-card border border-red-alert/30 rounded-2xl p-5 max-h-[88vh] overflow-y-auto shadow-[0_0_40px_rgba(255,61,87,0.15)]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors p-1"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center mb-4 pr-2">
              <div className="w-12 h-12 rounded-full bg-red-alert/15 border border-red-alert/40 flex items-center justify-center mb-2">
                <AlertTriangle className="w-6 h-6 text-red-alert" />
              </div>
              <h2 className="font-display text-[20px] tracking-[0.04em] text-red-alert uppercase">
                Pagos pendientes
              </h2>
              <p className="text-[12px] text-text-secondary mt-0.5">
                Hacé el pago al organizador y subí el comprobante para que la AI te apruebe y puedas pronosticar.
              </p>
            </div>

            <ul className="space-y-3">
              {items.map((it) => (
                <li
                  key={it.pollaSlug}
                  className="rounded-xl px-3 py-3 bg-bg-elevated border border-border-subtle space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-text-primary truncate">
                      {it.pollaName}
                    </p>
                    <p
                      className="font-display text-[18px] text-gold tabular-nums whitespace-nowrap"
                      style={{ fontFeatureSettings: '"tnum"' }}
                    >
                      {fmtCOP(it.buyInAmount)}
                    </p>
                  </div>

                  {it.adminPayoutMethod && it.adminPayoutAccount ? (
                    <div className="flex items-center gap-2">
                      <p
                        className="flex-1 min-w-0 truncate text-[12px] text-text-secondary tabular-nums"
                        style={{ fontFeatureSettings: '"tnum"' }}
                      >
                        {METHOD_LABEL[it.adminPayoutMethod] ?? it.adminPayoutMethod} · {it.adminPayoutAccount}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyAccount(it.adminPayoutAccount!, it.pollaSlug)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold transition-colors"
                      >
                        {copiedSlug === it.pollaSlug ? (<><Check className="w-3 h-3" /> Copiado</>) : (<><Copy className="w-3 h-3" /> Copiar</>)}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted">
                      El organizador todavía no configuró su cuenta de cobro.
                    </p>
                  )}

                  {it.adminPayoutAccountName ? (
                    <p className="text-[11px] text-text-muted truncate">
                      A nombre de {it.adminPayoutAccountName}
                    </p>
                  ) : null}

                  {it.proofStatus === "pending_review" ? (
                    <p className="text-[11px] text-amber">
                      ⌛ Tu comprobante está en revisión.
                    </p>
                  ) : it.proofStatus === "rejected" ? (
                    <p className="text-[11px] text-red-alert">
                      ✗ Tu comprobante fue rechazado.{" "}
                      {it.lastRejectionReason ? `(${it.lastRejectionReason})` : ""}{" "}
                      Subí uno nuevo.
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(`/pollas/${it.pollaSlug}?tab=pagos`);
                    }}
                    className="w-full mt-1 bg-gold text-bg-base font-display text-base tracking-wide py-2.5 rounded-xl hover:brightness-110 transition-all"
                  >
                    {it.proofStatus === "rejected" ? "VOLVER A SUBIR" : "SUBIR COMPROBANTE"}
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full mt-3 px-3 py-2.5 rounded-xl border border-border-subtle text-text-secondary text-[13px] hover:border-text-secondary/40 transition-colors"
            >
              Pagar después
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
