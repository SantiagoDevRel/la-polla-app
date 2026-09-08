"use client";

// components/casa/ColaDePagos.tsx — aprobar pagos desde la web.
//
// Respaldo del bot de Telegram. El bot sigue siendo el camino principal
// (llega solo, se resuelve de un toque), pero si Telegram falla, si el chat
// nunca se vinculó, o si Tama perdió el mensaje, esta lista es la que evita
// que la gente quede esperando para siempre.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileImage, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCop } from "@/lib/casa/format";

interface Pendiente {
  id: string;
  jugador: string;
  polla: string;
  montoCop: number;
  boleta: number | null;
  comprobanteUrl: string | null;
}

export function ColaDePagos({ pollaId, onReviewed, refreshKey = 0 }: { pollaId?: string; onReviewed?: () => void; refreshKey?: number }) {
  const router = useRouter();
  const decisionRef = useRef(false);
  const loadingRef = useRef(true);
  const loadedPagesRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const snapshotRef = useRef<string | null>(null);
  const [pendientes, setPendientes] = useState<Pendiente[] | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pageRequest, setPageRequest] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const snapshot = JSON.stringify([pollaId ?? null, revision, refreshKey]);
    const refresh = snapshotRef.current !== snapshot;
    const pagesToRead = refresh ? Math.max(1, loadedPagesRef.current) : 1;
    const firstCursor = refresh ? null : nextCursorRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    async function cargar() {
      try {
        if (!refresh && !firstCursor) return;
        let cursor = firstCursor;
        let more = false;
        let pagesRead = 0;
        const collected: Pendiente[] = [];
        for (; pagesRead < pagesToRead; ) {
          const params = new URLSearchParams();
          if (pollaId) params.set("pollaId", pollaId);
          if (cursor) params.set("cursor", cursor);
          const r = await fetch(`/api/casa/admin/entries?${params}`, { cache: "no-store", signal: controller.signal });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "No se pudieron cargar los pagos.");
          if (controller.signal.aborted) return;
          collected.push(...j.pendientes);
          pagesRead += 1;
          more = j.hasMore === true;
          cursor = typeof j.nextCursor === "string" ? j.nextCursor : null;
          if (more && !cursor) throw new Error("No se pudo continuar la lista de pagos. Actualiza para intentar otra vez.");
          if (!more) break;
        }
        if (controller.signal.aborted) return;
        setPendientes((previous) => {
          const rows = refresh ? collected : [...(previous ?? []), ...collected];
          return Array.from(new Map(rows.map((entry) => [entry.id, entry])).values());
        });
        if (refresh) setImageError(null);
        loadedPagesRef.current = (refresh ? 0 : loadedPagesRef.current) + pagesRead;
        nextCursorRef.current = cursor;
        snapshotRef.current = snapshot;
        setHasMore(more);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los pagos.");
      } finally {
        if (!controller.signal.aborted) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    }
    void cargar();
    return () => controller.abort();
  }, [pollaId, pageRequest, revision, refreshKey]);

  function actualizar() {
    // Refresh the full loaded window atomically. Keep the proof and card open.
    setRevision((value) => value + 1);
    setImageError(null);
  }

  function cargarMas() {
    if (loadingRef.current || decisionRef.current || !nextCursorRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setPageRequest((value) => value + 1);
  }

  async function decidir(id: string, decision: "aprobar" | "rechazar") {
    if (decisionRef.current) return;
    decisionRef.current = true;
    setResolviendo(id);
    setDecisionError(null);
    try {
      const r = await fetch("/api/casa/admin/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: id, decision }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDecisionError(data.error ?? "No se pudo guardar la decisión. Intenta otra vez.");
        if (r.status === 409) {
          actualizar();
          onReviewed?.();
        }
        return;
      }
      setPendientes((prev) => (prev ?? []).filter((p) => p.id !== id));
      // Reconcile every loaded page after a decision; keyset pagination also
      // remains safe when another administrator resolves a preceding payment.
      actualizar();
      onReviewed?.();
      router.refresh();
    } catch {
      setDecisionError("Se cayó la conexión. No se pudo confirmar la decisión.");
    } finally {
      decisionRef.current = false;
      setResolviendo(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="lp-display text-[22px]">Pagos por revisar</h3>
        <button type="button" onClick={actualizar} disabled={loading || resolviendo !== null} className="lp-btn lp-btn-ghost !px-3 !text-[12px]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Actualizar
        </button>
      </div>
      {decisionError && <p role="alert" className="mb-3 rounded-md border border-red-alert/30 p-3 text-[13px] text-red-alert">{decisionError}</p>}
      <ul className="space-y-3">
      {(pendientes ?? []).map((p) => (
        <li key={p.id} className="rounded-md border border-border-default bg-bg-elevated/60 p-3 transition-colors duration-200 hover:border-border-strong">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 grow basis-36">
              <p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">
                {p.jugador}
              </p>
              {p.boleta != null && <p className="mt-1 text-[12px] text-text-secondary">Boleta #{p.boleta}</p>}
              {!pollaId && <p className="mt-1 text-[12px] text-text-secondary [overflow-wrap:anywhere]">{p.polla}</p>}
            </div>
            <span className="lp-money text-[20px] text-text-primary">
              {formatCop(p.montoCop)}
            </span>
          </div>

          {p.comprobanteUrl && (
            <button
              type="button"
              onClick={() => { setAbierto(abierto === p.id ? null : p.id); setImageError(null); }}
              aria-expanded={abierto === p.id}
              aria-controls={`comprobante-${p.id}`}
              className="lp-btn lp-btn-ghost mt-3 w-full text-[12px]"
            >
              <FileImage className="h-4 w-4 shrink-0" aria-hidden="true" />
              {abierto === p.id ? "Ocultar comprobante" : "Ver comprobante"}
            </button>
          )}

          <div id={`comprobante-${p.id}`} hidden={abierto !== p.id}>
            {abierto === p.id && p.comprobanteUrl && (imageError === p.id ? (
              <p role="alert" className="mt-3 text-[13px] text-red-alert">No se pudo abrir el comprobante. Actualiza los pagos para volver a cargarlo.</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.comprobanteUrl} alt={`Comprobante de ${p.jugador}`} onError={() => setImageError(p.id)} className="mt-3 max-h-[420px] w-full rounded-sm object-contain" />
            ))}
          </div>
          {!p.comprobanteUrl && <p className="mt-3 text-[12px] text-text-secondary">El comprobante no está disponible. Actualiza los pagos para intentar cargarlo.</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={resolviendo !== null}
              onClick={() => decidir(p.id, "rechazar")}
              aria-label={`Rechazar el pago de ${p.jugador}`}
              className="lp-btn lp-btn-ghost grow basis-24 !px-3 !text-[13px] hover:border-red-alert hover:text-red-alert"
            >
              Rechazar
            </button>
            <button
              type="button"
              disabled={resolviendo !== null}
              onClick={() => decidir(p.id, "aprobar")}
              aria-label={`Aprobar el pago de ${p.jugador}`}
              className="lp-btn lp-btn-ghost grow basis-24 !px-3 !text-[13px]"
            >
              {resolviendo === p.id ? "Guardando..." : "Aprobar"}
            </button>
          </div>
        </li>
      ))}
      </ul>
      {loading && <div role="status" className="mt-3 space-y-3"><span className="sr-only">Cargando pagos...</span>{[0, 1].map((row) => <div key={row} aria-hidden="true" className="rounded-md border border-border-default p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-3 h-12 w-full" /></div>)}</div>}
      {error && !loading && <div role="alert" className="mt-3 text-[13px] text-red-alert"><p>{error}</p><button type="button" onClick={() => setPageRequest((value) => value + 1)} className="lp-btn lp-btn-ghost mt-2 text-[13px]">Reintentar</button></div>}
      {!loading && !error && pendientes?.length === 0 && <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-text-secondary" aria-hidden="true" /><p className="lp-display mt-2 text-[22px]">No hay pagos pendientes</p><p className="mt-1 text-[13px] text-text-secondary">Los nuevos comprobantes aparecerán en esta polla.</p></div>}
      {!loading && !error && hasMore && <button type="button" onClick={cargarMas} disabled={resolviendo !== null} className="lp-btn lp-btn-ghost mt-4 w-full text-[13px]">Cargar más pagos</button>}
    </div>
  );
}
