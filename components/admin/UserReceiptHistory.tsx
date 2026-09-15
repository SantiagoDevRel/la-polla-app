"use client";

// components/admin/UserReceiptHistory.tsx — comprobantes que envió un usuario.
//
// Complementa la revisión por polla (/admin/pollas/recibos): acá se mira a una
// persona a través de todas sus pollas. Solo lectura; aprobar o rechazar sigue
// viviendo en la cola de pagos y en el bot, para no tener dos flujos de decisión.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileImage, ReceiptText, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCop } from "@/lib/casa/format";
import { formatPhone } from "@/lib/format-phone";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import type { ReceiptOutcome } from "@/lib/casa/user-receipts";

interface Recibo {
  id: string;
  pollaId: string | null;
  polla: string;
  montoCop: number | null;
  boleta: number | null;
  participacion?: number | null;
  enviadoEn: string;
  revisadoEn: string | null;
  motivo: string | null;
  estado: ReceiptOutcome;
  comprobanteUrl: string | null;
}

interface Historial {
  usuario: { id: string; nombre: string | null; telefono: string | null };
  desde: string;
  resumen: { enviados: number; aprobados: number; rechazados: number; sinDecision: number };
}

const OUTCOME: Record<ReceiptOutcome, { label: string; className: string }> = {
  aprobado: { label: "Aprobado", className: "border-turf/30 text-turf" },
  rechazado: { label: "Rechazado", className: "border-red-alert/30 text-red-alert" },
  pendiente: { label: "Pendiente", className: "border-amber/40 text-amber" },
  reemplazado: { label: "Sin revisar · reemplazado", className: "border-border-default text-text-secondary" },
};

function when(iso: string) {
  return formatColombiaDateTime(iso, { day: "2-digit", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

export default function UserReceiptHistory({ userId }: { userId: string }) {
  const [info, setInfo] = useState<Historial | null>(null);
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [request, setRequest] = useState<{ cursor: string | null; n: number }>({ cursor: null, n: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const loadingRef = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (request.cursor) params.set("cursor", request.cursor);
        const response = await fetch(`/api/admin/users/${userId}/receipts?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (response.status === 404) { setNotFound(true); return; }
        if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el historial.");
        if (controller.signal.aborted) return;
        setInfo({ usuario: data.usuario, desde: data.desde, resumen: data.resumen });
        setRecibos((previous) => {
          const rows: Recibo[] = request.cursor ? [...previous, ...data.recibos] : data.recibos;
          return Array.from(new Map(rows.map((row) => [row.id, row])).values());
        });
        setCursor(data.hasMore ? data.nextCursor : null);
        if (!request.cursor) setImageError(null);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial.");
      } finally {
        if (!controller.signal.aborted) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [userId, request]);

  function actualizar() {
    if (loadingRef.current) return;
    setRequest((current) => ({ cursor: null, n: current.n + 1 }));
  }

  function cargarMas() {
    if (loadingRef.current || !cursor) return;
    setRequest((current) => ({ cursor, n: current.n + 1 }));
  }

  if (notFound) {
    return <div role="alert" className="rounded-md border border-border-default p-4">
      <p className="text-[15px] font-semibold text-text-primary">Usuario no encontrado</p>
      <p className="mt-1 text-[13px] text-text-secondary">Esta cuenta ya no existe. Búscala otra vez desde Administración.</p>
    </div>;
  }

  const resumen = info?.resumen;
  const stats = [
    { key: "enviados", label: "Enviados", value: resumen?.enviados },
    { key: "aprobados", label: "Aprobados", value: resumen?.aprobados },
    { key: "rechazados", label: "Rechazados", value: resumen?.rechazados },
    { key: "sinDecision", label: "Sin decisión", value: resumen?.sinDecision },
  ];

  return <div>
    <p className="lp-label">Historial de usuario</p>
    {info
      ? <h1 className="mt-1 font-display text-[32px] font-normal uppercase leading-[1.1] tracking-[0.04em] text-text-primary [overflow-wrap:anywhere]">{info.usuario.nombre || "Sin nombre"}</h1>
      : <Skeleton className="mt-2 h-8 w-2/3" />}
    {info && <p className="mt-1 text-[15px] tabular-nums text-text-secondary">{formatPhone(info.usuario.telefono) || "Sin teléfono"}</p>}

    {/* 4 cifras: 2×2 en móvil, 4 en una fila desde sm. Sin huérfanos. */}
    <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((stat) => <div key={stat.key} className="lp-card p-3">
        <dt className="text-[13px] text-text-secondary">{stat.label}</dt>
        <dd className="lp-money mt-1 text-[30px] tabular-nums text-text-primary">{stat.value ?? "—"}</dd>
      </div>)}
    </dl>
    <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
      Comprobantes enviados desde el {info ? formatColombiaDateTime(info.desde, { day: "numeric", month: "long", year: "numeric" }) : "inicio del historial"}, en todas las pollas. Hora de Colombia.
    </p>

    <div className="lp-card mt-5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Comprobantes</h2>
        <button type="button" onClick={actualizar} disabled={loading} className="lp-btn lp-btn-ghost !px-3 !text-[15px]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Actualizar
        </button>
      </div>

      <ul className="space-y-3">
        {recibos.map((r) => {
          const outcome = OUTCOME[r.estado];
          return <li key={r.id} className="rounded-md border border-border-default bg-bg-elevated/60 p-3 transition-colors duration-200 hover:border-border-strong">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 grow basis-40">
                {r.pollaId
                  ? <Link href={`/admin/pollas/${r.estado === "aprobado" ? "pagos" : "recibos"}?pollaId=${r.pollaId}`} className="text-[15px] font-semibold text-text-primary underline-offset-4 hover:underline [overflow-wrap:anywhere]">{r.polla}</Link>
                  : <p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{r.polla}</p>}
                {r.boleta != null && <p className="mt-1 text-[13px] text-text-secondary">Boleta #{r.boleta}</p>}
                {r.participacion != null && <p className="mt-1 text-[13px] text-text-secondary">Cupo #{r.participacion}</p>}
              </div>
              {r.montoCop != null && <span className="lp-money text-[20px] text-text-primary">{formatCop(r.montoCop)}</span>}
            </div>
            <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[13px] font-medium ${outcome.className}`}>{outcome.label}</span>
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">Enviado: <time dateTime={r.enviadoEn}>{when(r.enviadoEn)}</time></p>
            {r.revisadoEn && <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">Revisado: <time dateTime={r.revisadoEn}>{when(r.revisadoEn)}</time></p>}
            {r.motivo && <p className="mt-1 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">Motivo: {r.motivo}</p>}

            {r.comprobanteUrl ? <>
              <button
                type="button"
                onClick={() => { setAbierto(abierto === r.id ? null : r.id); setImageError(null); }}
                aria-expanded={abierto === r.id}
                aria-controls={`recibo-${r.id}`}
                className="lp-btn lp-btn-ghost mt-3 w-full !text-[15px]"
              >
                <FileImage className="h-4 w-4 shrink-0" aria-hidden="true" />
                {abierto === r.id ? "Ocultar comprobante" : "Ver comprobante"}
              </button>
              <div id={`recibo-${r.id}`} hidden={abierto !== r.id}>
                {abierto === r.id && (imageError === r.id
                  ? <p role="alert" className="mt-3 text-[13px] text-red-alert">No se pudo abrir el comprobante. Actualiza el historial para volver a cargarlo.</p>
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={r.comprobanteUrl} alt={`Comprobante enviado el ${when(r.enviadoEn)}`} onError={() => setImageError(r.id)} className="mt-3 max-h-[420px] w-full rounded-sm object-contain" />)}
              </div>
            </> : <p className="mt-3 text-[13px] text-text-secondary">El comprobante no está disponible. Actualiza el historial para intentar cargarlo.</p>}
          </li>;
        })}
      </ul>

      {loading && <div role="status" className="mt-3 space-y-3"><span className="sr-only">Cargando comprobantes...</span>{[0, 1].map((row) => <div key={row} aria-hidden="true" className="rounded-md border border-border-default p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-3 h-12 w-full" /></div>)}</div>}
      {error && !loading && <div role="alert" className="mt-3 text-[13px] text-red-alert"><p>{error}</p><button type="button" onClick={() => setRequest((current) => ({ ...current, n: current.n + 1 }))} className="lp-btn lp-btn-ghost mt-2 text-[13px]">Reintentar</button></div>}
      {!loading && !error && recibos.length === 0 && <div className="py-5 text-center">
        <ReceiptText className="mx-auto h-7 w-7 text-text-secondary" aria-hidden="true" />
        <p className="mt-2 font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Sin comprobantes todavía</p>
        <p className="mt-1 text-[13px] text-text-secondary">Cuando este usuario envíe un comprobante aparecerá aquí.</p>
      </div>}
      {!loading && !error && cursor && <button type="button" onClick={cargarMas} className="lp-btn lp-btn-ghost mt-4 w-full !text-[15px]">Cargar más comprobantes</button>}
    </div>
  </div>;
}
