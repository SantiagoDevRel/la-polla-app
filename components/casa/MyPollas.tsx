"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronDown, ChevronRight, Search, Ticket } from "lucide-react";
import type { MyCasaPolla } from "@/lib/casa/types";
import { TournamentIdentity } from "./TournamentIdentity";
import { PollaSection } from "./PollaSection";

const PAGE_SIZE = 5;
const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * One card per polla. With several cupos (migration 131) a dropdown inside the
 * card picks which cupo to open; its payment status is green (paid) or amber
 * (in review), and a red line flags cupos that still miss predictions.
 * `pendingByPolla` is a fallback for pools without per-cupo counts.
 */
export function MyPollas({ initialPollas, defaultOpen = true, activeOnly = false, split = false, pendingByPolla = {} }: {
  initialPollas?: MyCasaPolla[]; defaultOpen?: boolean;
  /** /casa: la página ya filtró las finalizadas (viven en Pollas cerradas). */
  activeOnly?: boolean;
  /** Perfil (2026-09-17): en juego y cerradas en dos desplegables compactos. */
  split?: boolean;
  pendingByPolla?: Record<string, number>;
}) {
  const [loadedPollas, setPollas] = useState<MyCasaPolla[]>();
  const pollas = initialPollas ?? loadedPollas;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  const retry = () => setAttempt(n => n + 1);
  if (!split) return <MyPollasSection id="mis-pollas" kind="mine" pollas={pollas} error={error} retry={retry} defaultOpen={defaultOpen} activeOnly={activeOnly} pendingByPolla={pendingByPolla} />;
  return <div className="space-y-3">
    <MyPollasSection id="mis-pollas" kind="mine" compact activeOnly pollas={pollas?.filter(p => !isFinished(p))} error={error} retry={retry} defaultOpen={defaultOpen} pendingByPolla={pendingByPolla} />
    <MyPollasSection id="mis-pollas-cerradas" kind="closed" compact pollas={pollas?.filter(isFinished)} error={error} retry={retry} defaultOpen={false} pendingByPolla={pendingByPolla} />
  </div>;
}

const isFinished = (p: MyCasaPolla) => p.status === "resuelta" || p.status === "anulada";

function MyPollasSection({ id, kind, pollas, error, retry, defaultOpen, activeOnly = false, compact = false, pendingByPolla }: {
  id: string; kind: "mine" | "closed"; pollas?: MyCasaPolla[]; error: boolean; retry: () => void;
  defaultOpen: boolean; activeOnly?: boolean; compact?: boolean; pendingByPolla: Record<string, number>;
}) {
  const en = useLocale() === "en";
  const closedList = kind === "closed";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const title = closedList ? (en ? "Closed pools" : "Pollas cerradas") : (en ? "My pools" : "Mis pollas");
  const description = closedList
    ? (en ? "Finished pools you took part in" : "Pollas finalizadas en las que participaste")
    : activeOnly ? (en ? "Your pools still in play" : "Tus pollas en juego") : (en ? "Pools you have joined" : "Pollas a las que te has unido");

  const [selectedCupo, setSelectedCupo] = useState<Record<string, number>>({});
  const filtered = (pollas ?? []).filter(p => searchKey(p.name).includes(searchKey(query.trim())));
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <PollaSection id={id} kind={kind} compact={compact} title={title} description={description} count={pollas ? pollas.length : "—"} defaultOpen={defaultOpen}>
      {error ? <div className="lp-card p-4 text-[15px] text-text-secondary" role="alert">
        <p>{en ? "Unable to load your pools." : "No pudimos cargar tus pollas."}</p>
        <button onClick={retry} className="mt-2 min-h-11 cursor-pointer rounded-full border border-border-default px-4 text-text-primary transition-colors hover:bg-bg-elevated">{en ? "Try again" : "Intentar de nuevo"}</button>
      </div> : !pollas ? <div className="lp-card h-28 animate-pulse" role="status" aria-label={en ? "Loading your pools" : "Cargando tus pollas"} /> : pollas.length === 0 ?
      closedList ? <p className="px-1 py-2 text-[15px] text-text-secondary">{en ? "You have no finished pools yet." : "Todavía no tienes pollas finalizadas."}</p> :
      <div className="lp-card p-5 text-center">
        <Ticket aria-hidden="true" className="mx-auto mb-2 h-7 w-7 text-text-secondary" />
        <p className="text-[15px] font-semibold text-text-primary">{activeOnly ? (en ? "You have no pools in play" : "No tienes pollas en juego") : (en ? "You haven't joined a pool yet" : "Todavía no te has inscrito en una polla")}</p>
        <Link href="/casa#pollas-disponibles" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border-default px-4 text-[15px] text-text-primary transition-colors hover:bg-bg-elevated">{en ? "See available pools" : "Ver pollas disponibles"}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>
      </div> : <>
        {(pollas ?? []).length > PAGE_SIZE && <label className="block space-y-2 text-[13px] text-text-secondary">
          <span className="flex items-center gap-2"><Search aria-hidden="true" className="h-4 w-4" />{en ? "Search my pools" : "Buscar en mis pollas"}</span>
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="lp-input min-h-11 w-full text-[15px]" />
        </label>}
        <ul className="space-y-3">
          {visible.map(polla => {
            const entries = polla.entries ?? [];
            const chosen = entries.find(e => e.number === selectedCupo[polla.id]) ?? entries[0];
            const several = entries.length > 1;
            const entryStatus = chosen?.status ?? polla.entry_status;
            const href = `/casa/${polla.slug}${chosen && (several || chosen.number > 1) ? `?p=${chosen.number}` : ""}`;
            const finished = polla.status === "resuelta" || polla.status === "anulada";
            const status = polla.status === "anulada" ? (en ? "Cancelled" : "Anulada") : finished ? (en ? "Finished" : "Finalizada") : entryStatus === "pendiente" ? (en ? "Payment under review" : "Pago en revisión") : chosen?.gift ? (en ? "Referral gift" : "Regalo por invitar") : (en ? "Paid" : "Pagado");
            const pendingOf = (n?: number) => entries.find(e => e.number === n)?.pending;
            const pending = chosen?.pending ?? pendingByPolla[`${polla.id}:${chosen?.number}`] ?? pendingByPolla[polla.id] ?? 0;
            const otherPending = finished ? [] : entries.filter(e => e.number !== chosen?.number && (pendingOf(e.number) ?? 0) > 0).map(e => `#${e.number}`);
            const anyPending = !finished && (pending > 0 || otherPending.length > 0);
            const selectId = `cupo-${polla.id}`;
            return <li key={polla.id}>
              {/* Finalizada = gris translúcido y logos desaturados, como en /casa. */}
              <div className={`lp-card space-y-3 p-4 ${finished ? "bg-text-primary/[0.04] [&_img]:grayscale [&_img]:opacity-70" : "bg-bg-elevated"} ${anyPending ? "border-red-alert/50" : ""}`}>
                <Link href={href} className="flex items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                  <h3 className={`min-w-0 flex-1 font-display text-[22px] leading-tight tracking-wide ${finished ? "text-text-secondary" : "text-text-primary"} [overflow-wrap:anywhere]`}>{polla.name}</h3>
                  {several && <span className="mt-1 shrink-0 text-[13px] tabular-nums text-text-secondary">{entries.length} {en ? "entries" : "cupos"}</span>}
                  <ChevronRight aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-text-secondary" />
                </Link>
                <TournamentIdentity tournaments={polla.tournaments} kind={polla.kind} />
                {several && <div>
                  <label htmlFor={selectId} className="block text-[13px] text-text-secondary">{en ? "Entry" : "Cupo"}</label>
                  <div className="relative mt-1">
                    <select id={selectId} value={chosen?.number} onChange={event => setSelectedCupo(prev => ({ ...prev, [polla.id]: Number(event.target.value) }))}
                      className="lp-input min-h-11 w-full cursor-pointer appearance-none pr-10 text-[15px] font-semibold">
                      {entries.map(e => <option key={e.number} value={e.number}>
                        {`${en ? "Entry" : "Cupo"} ${e.number} · ${e.gift ? (en ? "Gift" : "Regalo") : e.status === "pagada" ? (en ? "Paid" : "Pagado") : (en ? "In review" : "En revisión")}${!finished && (e.pending ?? 0) > 0 ? ` · ${en ? "missing" : "faltan"} ${e.pending}` : ""}`}
                      </option>)}
                    </select>
                    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-secondary" />
                  </div>
                </div>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-semibold ${finished ? "border-border-default text-text-secondary" : entryStatus === "pendiente" ? "border-amber/50 bg-amber/15 text-amber" : "border-turf/50 bg-turf/15 text-turf"}`}>{status}</span>
                  {!finished && pending > 0 && <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-red-alert/50 bg-red-alert/10 px-3 text-[13px] font-semibold text-red-alert">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-alert" />
                    {en ? `${pending} predictions missing` : pending === 1 ? "Te falta 1 pronóstico" : `Te faltan ${pending} pronósticos`}
                  </span>}
                </div>
                {otherPending.length > 0 && <p className="text-[13px] text-red-alert">{en ? "Also missing predictions in" : otherPending.length === 1 ? "También faltan pronósticos en el cupo" : "También faltan pronósticos en los cupos"} {otherPending.join(", ")}</p>}
                {several && <Link href={href} className="lp-btn lp-btn-ghost min-h-11 w-full">{en ? `Open entry ${chosen?.number}` : `Abrir cupo ${chosen?.number}`}</Link>}
              </div>
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
