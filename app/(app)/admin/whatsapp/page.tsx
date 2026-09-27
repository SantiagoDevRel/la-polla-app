"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

type Audience = { recipients: Array<{ phone: string; enabled: boolean; source: string; changed_at: string }>; total: number };
export default function WhatsAppAudiencePage() {
  const [enabled, setEnabled] = useState(true);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Audience | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    void fetch(`/api/admin/whatsapp-audience?enabled=${enabled}&page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [enabled, page, attempt]);
  return <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 pb-28">
    <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-text-secondary underline hover:text-text-primary">Volver a administración</Link>
    <h1 className="font-display text-3xl tracking-wide text-text-primary">Avisos por WhatsApp</h1>
    <p className="text-base leading-relaxed text-text-secondary">Solo reciben avisos quienes los activaron en Perfil o escribieron ALTA. Quienes no han elegido no reciben marketing. Los códigos de acceso se gestionan aparte.</p>
    <div className="flex flex-wrap gap-2" aria-label="Filtrar destinatarios">
      {[true, false].map(value => <button key={String(value)} type="button" aria-pressed={enabled === value}
        onClick={() => { setEnabled(value); setPage(0); }}
        className={`min-h-11 cursor-pointer rounded-full border px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${enabled === value ? "border-text-secondary bg-bg-elevated text-text-primary" : "border-border-default text-text-secondary hover:bg-bg-elevated"}`}>
        {value ? "Aceptaron avisos" : "No reciben avisos"}
      </button>)}
    </div>
    {error ? <div role="alert" className="lp-card space-y-3 p-4"><p>No se pudo cargar la lista.</p><button type="button" onClick={() => setAttempt(x => x + 1)} className="min-h-11 cursor-pointer underline">Reintentar</button></div>
      : !data ? <div role="status" aria-label="Cargando destinatarios" className="h-32 animate-pulse rounded-xl bg-bg-elevated" />
      : <section className="space-y-3" aria-label="Destinatarios">
        <p role="status" className="text-sm text-text-secondary">{data.total} {data.total === 1 ? "número" : "números"}</p>
        {!data.recipients.length ? <div className="lp-card space-y-3 p-5">
          <MessageCircle className="h-6 w-6 text-text-secondary" aria-hidden="true" />
          <h2 className="font-display text-2xl tracking-wide">{enabled ? "Todavía no hay altas" : "Todavía no hay bajas"}</h2>
          <p className="text-sm leading-relaxed text-text-secondary">Las preferencias aparecerán aquí cuando alguien las cambie.</p>
          <Link href="/perfil" className="inline-flex min-h-11 items-center text-sm underline">Ver preferencia en Perfil</Link>
        </div> : <ul className="space-y-3">{data.recipients.map(row => <li key={row.phone} className="lp-card space-y-1 p-4">
          <p className="break-all text-base font-semibold tabular-nums text-text-primary">+{row.phone}</p>
          <p className="text-sm leading-relaxed text-text-secondary">{row.source === "profile" ? "Desde Perfil" : row.source === "legacy" ? "Baja anterior" : "Desde WhatsApp"} · {new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" }).format(new Date(row.changed_at))}</p>
        </li>)}</ul>}
        {(page > 0 || (page + 1) * 25 < data.total) && <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={!page} onClick={() => setPage(p => p - 1)} className="min-h-11 cursor-pointer px-3 underline disabled:opacity-40">Anterior</button>
          <span className="text-sm">Página {page + 1}</span>
          <button type="button" disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(p => p + 1)} className="min-h-11 cursor-pointer px-3 underline disabled:opacity-40">Siguiente</button>
        </div>}
      </section>}
  </main>;
}
