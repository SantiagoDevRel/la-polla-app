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

/**
 * One card per participation (migration 131): OFIGOLAZO #1, OFIGOLAZO #2… A
 * polla with a single participation keeps its single card without a number.
 * `pendingByPolla` accepts `pollaId:number` keys for a participation and
 * `pollaId` for pools without numbered participations (raffles).
 */
type Card = { key: string; polla: MyCasaPolla; number: number | null; status: MyCasaPolla["entry_status"]; href: string };

function toCards(pollas: MyCasaPolla[]): Card[] {
  return pollas.flatMap((polla): Card[] => {
    const entries = polla.entries ?? [];
    if (entries.length <= 1) {
      const only = entries[0];
      return [{ key: polla.id, polla, number: null, status: only?.status ?? polla.entry_status,
        href: `/casa/${polla.slug}${only && only.number > 1 ? `?p=${only.number}` : ""}` }];
    }
    return entries.map(entry => ({ key: `${polla.id}:${entry.number}`, polla, number: entry.number, status: entry.status,
      href: `/casa/${polla.slug}?p=${entry.number}` }));
  });
}

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

  const cards = toCards(pollas ?? []);
  const filtered = cards.filter(card => searchKey(card.polla.name).includes(searchKey(query.trim())));
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
        {cards.length > PAGE_SIZE && <label className="block space-y-2 text-[13px] text-text-secondary">
          <span className="flex items-center gap-2"><Search aria-hidden="true" className="h-4 w-4" />{en ? "Search my pools" : "Buscar en mis pollas"}</span>
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="lp-input min-h-11 w-full text-[15px]" />
        </label>}
        <ul className="space-y-3">
          {visible.map(({ key, polla, number, status: entryStatus, href }) => {
            const finished = polla.status === "resuelta" || polla.status === "anulada";
            const status = polla.status === "anulada" ? (en ? "Cancelled" : "Anulada") : finished ? (en ? "Finished" : "Finalizada") : entryStatus === "pendiente" ? (en ? "Payment under review" : "Pago en revisión") : (en ? "You're participating" : "Estás participando");
            const pending = number != null ? pendingByPolla[`${polla.id}:${number}`] : pendingByPolla[polla.id] ?? pendingByPolla[`${polla.id}:${polla.entries?.[0]?.number}`];
            return <li key={key}>
              <Link href={href} className="lp-card block space-y-3 bg-bg-elevated p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                <div className="flex items-start gap-3">
                  <h3 className="min-w-0 flex-1 font-display text-[22px] leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]">
                    {polla.name}
                    {number != null && <span className="ml-2 inline-block whitespace-nowrap rounded-full border border-border-default px-2 align-middle font-sans text-[13px] font-semibold tracking-normal text-text-secondary">{en ? `Entry ${number}` : `Cupo ${number}`}</span>}
                  </h3>
                  <ChevronRight aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-text-secondary" />
                </div>
                <TournamentIdentity tournaments={polla.tournaments} kind={polla.kind} />
                <p className={`text-[13px] ${finished ? "text-text-secondary" : entryStatus === "pendiente" ? "text-amber" : "text-turf"}`}>{status}</p>
                {!!pending && <p className="text-[13px] text-amber">{en ? "Predictions remaining" : "Pronósticos pendientes"}: {pending}</p>}
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
