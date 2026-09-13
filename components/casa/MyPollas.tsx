"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronRight, Search, Ticket } from "lucide-react";
import type { MyCasaPolla } from "@/lib/casa/types";
import { TournamentIdentity } from "./TournamentIdentity";
import { PollaSection } from "./PollaSection";

const PAGE_SIZE = 5;
const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function MyPollas({ initialPollas, defaultOpen = true, pendingByPolla = {} }: { initialPollas?: MyCasaPolla[]; defaultOpen?: boolean; pendingByPolla?: Record<string, number> }) {
  const en = useLocale() === "en";
  const [loadedPollas, setPollas] = useState<MyCasaPolla[]>();
  const pollas = initialPollas ?? loadedPollas;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (initialPollas) return;
    const controller = new AbortController();
    setError(false);
    fetch("/api/casa/mis-pollas", { cache: "no-store", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Unable to load"); return response.json(); })
      .then(data => setPollas(data.pollas))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [initialPollas, attempt]);

  const filtered = (pollas ?? []).filter(p => searchKey(p.name).includes(searchKey(query.trim())));
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <PollaSection id="mis-pollas" kind="mine" title={en ? "My pools" : "Mis pollas"} description={en ? "Pools you have joined" : "Pollas a las que te has unido"} count={pollas ? pollas.length : "—"} defaultOpen={defaultOpen}>
      {error ? <div className="lp-card p-4 text-[15px] text-text-secondary" role="alert">
        <p>{en ? "Unable to load your pools." : "No pudimos cargar tus pollas."}</p>
        <button onClick={() => setAttempt(n => n + 1)} className="mt-2 min-h-11 cursor-pointer rounded-full border border-border-default px-4 text-text-primary transition-colors hover:bg-bg-elevated">{en ? "Try again" : "Intentar de nuevo"}</button>
      </div> : !pollas ? <div className="lp-card h-28 animate-pulse" role="status" aria-label={en ? "Loading your pools" : "Cargando tus pollas"} /> : pollas.length === 0 ?
      <div className="lp-card p-5 text-center">
        <Ticket aria-hidden="true" className="mx-auto mb-2 h-7 w-7 text-text-secondary" />
        <p className="text-[15px] font-semibold text-text-primary">{en ? "You haven't joined a pool yet" : "Todavía no te has inscrito en una polla"}</p>
        <Link href="/casa#pollas-abiertas" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border-default px-4 text-[15px] text-text-primary transition-colors hover:bg-bg-elevated">{en ? "See open pools" : "Ver pollas abiertas"}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>
      </div> : <>
        {pollas.length > PAGE_SIZE && <label className="block space-y-2 text-[13px] text-text-secondary">
          <span className="flex items-center gap-2"><Search aria-hidden="true" className="h-4 w-4" />{en ? "Search my pools" : "Buscar en mis pollas"}</span>
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="lp-input min-h-11 w-full text-[15px]" />
        </label>}
        <ul className="space-y-3">
          {visible.map(polla => {
            const finished = polla.status === "resuelta" || polla.status === "anulada";
            const status = polla.status === "anulada" ? (en ? "Cancelled" : "Anulada") : finished ? (en ? "Finished" : "Finalizada") : polla.entry_status === "pendiente" ? (en ? "Payment under review" : "Pago en revisión") : (en ? "You're participating" : "Estás participando");
            return <li key={polla.id}>
              <Link href={`/casa/${polla.slug}`} className="lp-card block space-y-3 bg-bg-elevated p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                <div className="flex items-start gap-3">
                  <h3 className="min-w-0 flex-1 font-display text-[22px] leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]">{polla.name}</h3>
                  <ChevronRight aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-text-secondary" />
                </div>
                <TournamentIdentity tournaments={polla.tournaments} kind={polla.kind} showNames={false} />
                <p className={`text-[13px] ${finished ? "text-text-secondary" : polla.entry_status === "pendiente" ? "text-amber" : "text-turf"}`}>{status}</p>
                {!!pendingByPolla[polla.id] && <p className="text-[13px] text-amber">{en ? "Predictions remaining" : "Pronósticos pendientes"}: {pendingByPolla[polla.id]}</p>}
              </Link>
            </li>;
          })}
        </ul>
        {filtered.length === 0 && <p role="status" className="py-3 text-[15px] text-text-secondary">{en ? "No pools match that name." : "No encontramos pollas con ese nombre."}</p>}
        {pageCount > 1 && <nav aria-label={en ? "My pools pages" : "Páginas de mis pollas"} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="min-h-11 cursor-pointer rounded-full border border-border-default px-3 text-text-primary transition-colors hover:bg-bg-elevated disabled:cursor-default disabled:opacity-40">{en ? "Previous" : "Anterior"}</button>
          <span aria-live="polite" className="text-text-secondary">{currentPage + 1} / {pageCount}</span>
          <button disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)} className="min-h-11 cursor-pointer rounded-full border border-border-default px-3 text-text-primary transition-colors hover:bg-bg-elevated disabled:cursor-default disabled:opacity-40">{en ? "Next" : "Siguiente"}</button>
        </nav>}
      </>}
  </PollaSection>;
}
