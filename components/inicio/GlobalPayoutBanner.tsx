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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Banknote, Copy, X, Check, Paperclip, Image as ImageIcon } from "lucide-react";
import WinnerPayoutModal, { type PayoutMethod } from "@/components/polla/WinnerPayoutModal";

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
  viewerNeedsAccount: boolean;
  hasProof: boolean;
  proofUploadedAt: string | null;
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

  // Winner-needs-account flow: si el viewer es ganador en una polla y
  // todavía no dejó cuenta de cobro, le mostramos el WinnerPayoutModal
  // primero (con video). De a una polla por vez — al guardar pasa a
  // la siguiente que falte. Cuando ya tienen todas las cuentas seteadas,
  // pasa el flow normal del banner regular.
  const [winnerPrompt, setWinnerPrompt] = useState<PendingPayout | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [viewingProofUrl, setViewingProofUrl] = useState<string | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);
  const fileInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await axios.get<{ pending: PendingPayout[] }>(
        "/api/users/me/pending-payouts",
      );
      setItems(res.data.pending);
      return res.data.pending;
    } catch {
      setItems([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-open: al cargar la lista decidimos qué mostrar primero.
  //   - Si hay incoming con viewerNeedsAccount → priorizamos el winner
  //     modal (de a uno).
  //   - Si no hay accounts pendientes pero sí hay tx → abre el modal
  //     regular cada vez que el user entre a /inicio. La X siempre lo
  //     cierra y vuelve a aparecer al próximo mount (decisión deliberada
  //     del owner — quería que sirva de recordatorio insistente hasta
  //     que se resuelva el último pago).
  useEffect(() => {
    if (loading || items.length === 0) return;
    if (typeof window === "undefined") return;

    const needsAccount = items.find((i) => i.viewerNeedsAccount);
    if (needsAccount) {
      setWinnerPrompt(needsAccount);
      return;
    }

    setOpen(true);
  }, [loading, items]);

  async function saveWinnerAccount(
    method: PayoutMethod,
    account: string,
    accountName: string | null,
  ) {
    if (!winnerPrompt || savingAccount) return;
    setSavingAccount(true);
    try {
      await axios.patch(
        `/api/pollas/${winnerPrompt.pollaSlug}/payout-method`,
        { method, account, accountName },
      );
      const next = await load();
      // Después del save, ¿queda alguna otra polla con cuenta pendiente?
      const stillNeeds = next.find((i) => i.viewerNeedsAccount);
      if (stillNeeds) {
        setWinnerPrompt(stillNeeds);
      } else {
        setWinnerPrompt(null);
      }
    } catch {
      /* swallow — el modal queda abierto para reintento */
    } finally {
      setSavingAccount(false);
    }
  }

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

  async function uploadProof(item: PendingPayout, file: File) {
    if (uploadingId) return;
    setUploadingId(item.transactionId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await axios.post(
        `/api/pollas/${item.pollaSlug}/payout-confirm/${item.transactionId}/proof`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      await load();
    } catch {
      /* swallow — el user puede reintentar */
    } finally {
      setUploadingId(null);
    }
  }

  async function viewProof(item: PendingPayout) {
    if (loadingProofId) return;
    setLoadingProofId(item.transactionId);
    try {
      const res = await axios.get<{ url: string | null }>(
        `/api/pollas/${item.pollaSlug}/payout-confirm/${item.transactionId}/proof`,
      );
      if (res.data.url) setViewingProofUrl(res.data.url);
    } catch {
      /* swallow */
    } finally {
      setLoadingProofId(null);
    }
  }

  if (loading || items.length === 0) return null;

  const incoming = items.filter((i) => i.direction === "incoming");
  const outgoing = items.filter((i) => i.direction === "outgoing");

  // Si tiene pagos OUTGOING pendientes, el modal queda bloqueado: no se
  // puede cerrar hasta que marque cada uno como pagado. Decisión del
  // owner para forzar que la gente cumpla con los ganadores antes de
  // seguir usando la app. Solo aplica al modal regular — el winner-
  // needs-account modal sí sigue siendo cerrable porque ese es del
  // viewer hacia adentro (sus datos), no responsabilidad con terceros.
  const hasOutgoingPending = outgoing.length > 0;

  return (
    <>
      {/* Winner-needs-account modal — prioridad. Solo cuando hay un
          incoming en una polla donde el viewer todavía no dejó cuenta.
          Después del save, el endpoint vuelve sin viewerNeedsAccount y
          este modal no se vuelve a abrir. */}
      {winnerPrompt ? (
        <WinnerPayoutModal
          open={true}
          pollaName={winnerPrompt.pollaName}
          position={1}
          prizeAmount={winnerPrompt.amount}
          onSubmit={saveWinnerAccount}
          onClose={() => setWinnerPrompt(null)}
        />
      ) : null}

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
                : "Tienes un pago pendiente"
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
            {hasOutgoingPending ? null : (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors p-1"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            <div className="mb-4 pr-6">
              <h2 className="font-display text-[20px] tracking-[0.04em] text-gold uppercase">
                Pagos pendientes
              </h2>
              <p className="text-[12px] text-text-secondary mt-0.5">
                De todas tus pollas finalizadas.
              </p>
              {hasOutgoingPending ? (
                <div className="mt-3 rounded-lg px-3 py-2 bg-red-alert/10 border border-red-alert/30">
                  <p className="text-[12px] text-red-alert font-semibold">
                    Cumple con tus pagos para cerrar este aviso.
                  </p>
                  <p className="text-[11px] text-red-alert/80 mt-0.5">
                    Sube el comprobante si pudiste — el ganador queda más tranquilo.
                  </p>
                </div>
              ) : null}
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
                      {it.hasProof ? (
                        <button
                          type="button"
                          onClick={() => viewProof(it)}
                          disabled={loadingProofId === it.transactionId}
                          className="w-full mb-1.5 text-[12px] font-semibold py-1.5 rounded-lg bg-bg-base border border-gold/40 text-gold hover:bg-gold/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          {loadingProofId === it.transactionId
                            ? "Cargando…"
                            : "Ver comprobante"}
                        </button>
                      ) : null}
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
                        <input
                          ref={(el) => {
                            if (el) fileInputRefs.current.set(it.transactionId, el);
                          }}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadProof(it, f);
                            e.target.value = "";
                          }}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              fileInputRefs.current.get(it.transactionId)?.click()
                            }
                            disabled={uploadingId === it.transactionId}
                            className="text-[12px] font-semibold py-1.5 rounded-lg bg-bg-base border border-border-subtle text-text-secondary hover:border-gold/40 hover:text-gold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            {uploadingId === it.transactionId
                              ? "Subiendo…"
                              : it.hasProof
                                ? "Cambiar"
                                : "Comprobante"}
                          </button>
                          <button
                            type="button"
                            onClick={() => markPaid(it)}
                            disabled={actingId === it.transactionId}
                            className="text-[12px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                          >
                            {actingId === it.transactionId ? "…" : "Ya pagué"}
                          </button>
                        </div>
                        {it.hasProof ? (
                          <p className="text-[10px] text-gold/80 mt-1.5 text-center">
                            ✓ Comprobante adjunto
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {hasOutgoingPending ? null : (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full mt-3 px-3 py-2.5 rounded-xl border border-border-subtle text-text-secondary text-[13px] hover:border-text-secondary/40 transition-colors"
              >
                Cerrar
              </button>
            )}

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

      {/* Lightbox del comprobante. La signed URL caduca a los 10 min,
          así que ni cacheamos — si el user cierra y vuelve a abrir,
          se pide otra. */}
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
    </>
  );
}
