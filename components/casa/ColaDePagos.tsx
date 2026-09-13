"use client";

// components/casa/ColaDePagos.tsx — aprobar pagos desde la web.
//
// Respaldo del bot de Telegram. El bot sigue siendo el camino principal
// (llega solo, se resuelve de un toque), pero si Telegram falla, si el chat
// nunca se vinculó, o si Tama perdió el mensaje, esta lista es la que evita
// que la gente quede esperando para siempre.

import { CASA_HEADERS } from "@/lib/casa/contract";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileImage, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCop } from "@/lib/casa/format";

interface Pendiente {
  attemptId: string | null;
  revision: number;
  id: string;
  jugador: string;
  polla: string;
  montoCop: number;
  boleta: number | null;
  comprobanteUrl: string | null;
  subidoEn: string | null;
  aprobadoEn: string | null;
  puedeDesmarcar: boolean;
}

function paymentTime(iso: string) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota", day: "2-digit", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

/** `showPollaName` defaults to showing the polla only in the unfiltered list;
 * the full review screen forces it so a filtered card still names its polla. */
export function ColaDePagos({ pollaId, onReviewed, refreshKey = 0, status = "pendiente", showPollaName }: { pollaId?: string; onReviewed?: () => void; refreshKey?: number; status?: "pendiente" | "pagada"; showPollaName?: boolean }) {
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
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const paid = status === "pagada";

  useEffect(() => {
    const updateVisible = () => {
      if (document.visibilityState === "visible" && !decisionRef.current) setRevision((value) => value + 1);
    };
    const timer = setInterval(updateVisible, 30_000);
    document.addEventListener("visibilitychange", updateVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", updateVisible); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const snapshot = JSON.stringify([pollaId ?? null, revision, refreshKey, status]);
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
          params.set("status", status);
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
  }, [pollaId, pageRequest, revision, refreshKey, status]);

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

  async function decidir(id: string, decision: "aprobar" | "rechazar" | "desmarcar") {
    if (decisionRef.current) return;
    const entry = pendientes?.find((p) => p.id === id);
    const attemptId = entry?.attemptId;
    if (!attemptId) { setDecisionError("Actualiza la cola antes de revisar el comprobante."); return; }
    decisionRef.current = true;
    setResolviendo(id);
    setDecisionError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/casa/admin/entries", {
        method: "POST",
        headers: CASA_HEADERS,
        body: JSON.stringify({ attemptId, decision, revision: entry.revision, ...(decision === "desmarcar" ? { motivo: reason.trim() } : {}) }),
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
      setCorrectionId(null);
      setReason("");
      setNotice(decision === "aprobar" ? "Pago aprobado. Puedes encontrarlo en Pagos aprobados." : decision === "desmarcar" ? "El pago volvió a Recibos pendientes. El comprobante y la corrección quedaron guardados." : "Comprobante rechazado.");
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
        <h3 className="font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">{paid ? "Pagos aprobados" : "Recibos pendientes"}</h3>
        <button type="button" onClick={actualizar} disabled={loading || resolviendo !== null} className="lp-btn lp-btn-ghost !px-3 !text-[15px]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Actualizar
        </button>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-text-secondary">Los comprobantes más recientes aparecen primero. Hora de Colombia.</p>
      {notice && <p role="status" className="mb-3 rounded-md border border-border-default p-3 text-[15px] text-text-primary">{notice}</p>}
      {decisionError && <p role="alert" className="mb-3 rounded-md border border-red-alert/30 p-3 text-[13px] text-red-alert">{decisionError}</p>}
      <ul className="space-y-3">
      {(pendientes ?? []).map((p) => (
        <li key={p.id} className="rounded-md border border-border-default bg-bg-elevated/60 p-3 transition-colors duration-200 hover:border-border-strong">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 grow basis-36">
              <p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">
                {p.jugador}
              </p>
              {p.boleta != null && <p className="mt-1 text-[13px] text-text-secondary">Boleta #{p.boleta}</p>}
              {(showPollaName ?? !pollaId) && <p className="mt-1 text-[13px] text-text-secondary [overflow-wrap:anywhere]">Polla: {p.polla}</p>}
            </div>
            <span className="lp-money text-[20px] text-text-primary">
              {formatCop(p.montoCop)}
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{p.subidoEn ? <>Recibido: <time dateTime={p.subidoEn}>{paymentTime(p.subidoEn)}</time></> : "Fecha de recepción no disponible"}</p>
          {paid && <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{p.aprobadoEn ? <>Aprobado: <time dateTime={p.aprobadoEn}>{paymentTime(p.aprobadoEn)}</time></> : "Pago aprobado"}</p>}

          {p.comprobanteUrl && (
            <button
              type="button"
              onClick={() => { setAbierto(abierto === p.id ? null : p.id); setImageError(null); }}
              aria-expanded={abierto === p.id}
              aria-controls={`comprobante-${p.id}`}
              className="lp-btn lp-btn-ghost mt-3 w-full !text-[15px]"
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
          {!p.comprobanteUrl && <p className="mt-3 text-[13px] text-text-secondary">El comprobante no está disponible. Actualiza los pagos para intentar cargarlo.</p>}

          {!paid && <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={resolviendo !== null}
              onClick={() => decidir(p.id, "rechazar")}
              aria-label={`Rechazar el pago de ${p.jugador}`}
              className="lp-btn lp-btn-ghost grow basis-24 !px-3 !text-[15px] hover:border-red-alert hover:text-red-alert"
            >
              Rechazar
            </button>
            <button
              type="button"
              disabled={resolviendo !== null}
              onClick={() => decidir(p.id, "aprobar")}
              aria-label={`Aprobar el pago de ${p.jugador}`}
              className="lp-btn lp-btn-ghost grow basis-24 !px-3 !text-[15px]"
            >
              {resolviendo === p.id ? "Guardando..." : "Aprobar"}
            </button>
          </div>}
          {paid && (p.puedeDesmarcar ? (correctionId === p.id ? (
            <div role="group" aria-label={`Corregir pago de ${p.jugador}`} className="mt-4 space-y-3 rounded-md border border-amber/40 p-3">
              <p className="text-[15px] leading-relaxed text-text-primary">El pago de {p.jugador} volverá a pendientes y dejará de contar como inscripción pagada hasta que lo apruebes otra vez.</p>
              <label htmlFor={`motivo-${p.id}`} className="block text-[15px] font-medium">Motivo de la corrección</label>
              <input id={`motivo-${p.id}`} value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} className="lp-input w-full min-w-0 !text-[15px]" placeholder="Por ejemplo: aprobé el comprobante equivocado" />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={resolviendo !== null} onClick={() => { setCorrectionId(null); setReason(""); }} className="lp-btn lp-btn-ghost grow !text-[15px]">Cancelar</button>
                <button type="button" disabled={resolviendo !== null || !reason.trim()} onClick={() => decidir(p.id, "desmarcar")} className="lp-btn lp-btn-ghost grow !text-[15px] hover:border-amber hover:text-amber">{resolviendo === p.id ? "Guardando..." : "Confirmar corrección"}</button>
              </div>
            </div>
          ) : <button type="button" disabled={resolviendo !== null} onClick={() => { setCorrectionId(p.id); setReason(""); setDecisionError(null); }} className="lp-btn lp-btn-ghost mt-3 w-full !text-[15px]">Desmarcar como pagado</button>
          ) : <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">Pago conservado en el historial. La polla ya tiene su resultado, está archivada o tiene un desempate definido.</p>)}
        </li>
      ))}
      </ul>
      {loading && <div role="status" className="mt-3 space-y-3"><span className="sr-only">Cargando pagos...</span>{[0, 1].map((row) => <div key={row} aria-hidden="true" className="rounded-md border border-border-default p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-3 h-12 w-full" /></div>)}</div>}
      {error && !loading && <div role="alert" className="mt-3 text-[13px] text-red-alert"><p>{error}</p><button type="button" onClick={() => setPageRequest((value) => value + 1)} className="lp-btn lp-btn-ghost mt-2 text-[13px]">Reintentar</button></div>}
      {!loading && !error && pendientes?.length === 0 && <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-text-secondary" aria-hidden="true" /><p className="mt-2 font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">{paid ? "Todavía no hay pagos aprobados" : "No hay recibos pendientes"}</p><p className="mt-1 text-[13px] text-text-secondary">{paid ? "Aquí encontrarás los comprobantes que ya aprobaste." : "Los nuevos comprobantes aparecerán aquí para revisarlos."}</p></div>}
      {!loading && !error && hasMore && <button type="button" onClick={cargarMas} disabled={resolviendo !== null} className="lp-btn lp-btn-ghost mt-4 w-full !text-[15px]">Cargar más pagos</button>}
    </div>
  );
}
