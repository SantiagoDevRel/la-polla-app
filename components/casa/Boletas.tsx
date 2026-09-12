"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";

type Availability = { tickets: Array<{ number: number; state: string }>; total: number; available: number; can_reserve: boolean; next: number | null };
const labels: Record<string, string> = { available: "Disponible", unavailable: "Reservada", paid: "Tuya, pagada", review: "Tuya, en revisión", uploading: "Tuya, carga en curso", resume: "Tuya, puedes retomar" };

export function SelectorBoleta({ slug, value, onChange, disabled, revision = 0 }: {
  slug: string; value: string; onChange: (value: string) => void; disabled: boolean; revision?: number;
}) {
  const [from, setFrom] = useState(1);
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") setRefresh((n) => n + 1); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    fetch(`/api/casa/pollas/${slug}/tickets?from=${from}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((result) => { if (!controller.signal.aborted) setData(result); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [slug, from, refresh, revision]);
  if (error) return <div role="alert" className="text-[13px] text-red-alert">No se pudieron consultar las boletas. <button type="button" className="lp-btn lp-btn-ghost mt-2 w-full" onClick={() => setRefresh((r) => r + 1)}>Reintentar</button></div>;
  if (!data) return <Skeleton className="h-24 w-full" />;
  return <div className="space-y-2">
    <label htmlFor="casa-ticket" className="block text-[15px] font-semibold">Número de boleta</label>
    <p className="text-[13px] text-text-secondary">{data.available} disponibles de {data.total}. Tus boletas fallidas conservan su número.</p>
    {!data.can_reserve && <p className="text-[13px] text-text-secondary">Primero completa tu boleta pendiente y espera la aprobación del pago. Puedes retomar tus números reservados.</p>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-[13px]">Buscar número<input inputMode="numeric" type="number" min={1} max={data.total} value={search} disabled={disabled} onChange={(e) => setSearch(e.target.value)} className="lp-input mt-1 w-full text-[15px]" /></label>
      <button type="button" className="lp-btn lp-btn-ghost" disabled={disabled || !/^\d+$/.test(search) || Number(search)<1 || Number(search)>data.total} onClick={() => setFrom(Math.floor((Number(search)-1)/50)*50+1)}>Buscar</button>
    </div>
    <select id="casa-ticket" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="lp-input w-full text-[15px]">
      <option value="">Elige una boleta</option>
      {value && !data.tickets.some((t) => String(t.number) === value) && <option value={value}>Boleta {value} seleccionada</option>}
      {data.tickets.map((ticket) => <option key={ticket.number} value={ticket.number} disabled={!["available", "resume", "uploading"].includes(ticket.state) || (ticket.state === "available" && !data.can_reserve)}>
        {ticket.number} — {labels[ticket.state]}
      </option>)}
    </select>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="lp-btn lp-btn-ghost flex-1 text-[13px]" disabled={disabled || from === 1} onClick={() => setFrom(Math.max(1, from - 50))}>Anteriores</button>
      <button type="button" className="lp-btn lp-btn-ghost flex-1 text-[13px]" disabled={disabled || data.next === null} onClick={() => setFrom(data.next!)}>Siguientes</button>
    </div>
  </div>;
}

type MyTicket = { id: string; ticket_number: number; status: string; hasProof: boolean; canResume: boolean; reject_reason: string | null };
export function MisBoletas({ slug, open }: { slug: string; open: boolean }) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ entries: MyTicket[]; next: number | null } | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(`/api/casa/pollas/${slug}/tickets?mine=1&offset=${offset}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); }).then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    const timer = setInterval(() => { if (document.visibilityState === "visible") setRevision((n) => n + 1); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [slug, offset, revision]);
  return <section className="lp-card space-y-3 p-4">
    <h2 className="font-display text-[24px] tracking-wide">Mis boletas</h2>
    {error ? <p role="alert" className="text-[13px] text-red-alert">No se pudieron actualizar tus boletas. <button className="lp-btn lp-btn-ghost mt-2 w-full" onClick={() => setRevision((n) => n + 1)}>Reintentar</button></p>
      : !data ? <Skeleton className="h-20 w-full" /> : data.entries.length === 0 ? <p className="text-[15px] text-text-secondary">Aún no tienes boletas en esta rifa.</p>
        : <ul className="divide-y divide-border-default">{data.entries.map((entry) => <li key={entry.id} className="py-3 text-[15px]">
          <p className="font-semibold">Boleta {entry.ticket_number}</p>
          <p className="text-[13px] text-text-secondary">{entry.status === "pagada" ? "Pago confirmado" : entry.status === "pendiente" && entry.hasProof ? "Comprobante en revisión" : "Comprobante por completar"}</p>
          {entry.reject_reason && <p className="text-[13px] text-text-secondary">{entry.reject_reason}</p>}
          {(open || entry.canResume) && entry.status !== "pagada" && !(entry.status === "pendiente" && entry.hasProof) && <Link className="lp-btn lp-btn-ghost mt-2 text-[13px]" href={`/casa/${slug}/pagar?boleta=${entry.ticket_number}`}>Retomar esta boleta</Link>}
        </li>)}</ul>}
    {data && (offset > 0 || data.next !== null) && <div className="flex flex-wrap gap-2">
      <button className="lp-btn lp-btn-ghost flex-1" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Anteriores</button>
      <button className="lp-btn lp-btn-ghost flex-1" disabled={data.next === null} onClick={() => setOffset(data.next!)}>Siguientes</button>
    </div>}
    {open && <Link className="lp-btn lp-btn-ghost w-full" href={`/casa/${slug}/pagar`}>Comprar otra boleta</Link>}
  </section>;
}
