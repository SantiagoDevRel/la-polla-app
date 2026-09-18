"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronRight, Search, Ticket } from "lucide-react";
import type { MyCasaPolla } from "@/lib/casa/types";
import { timeLeft } from "@/lib/casa/format";
import { premioLabel, premioValor } from "@/lib/casa/premio";
import { isPollaOpen } from "@/lib/casa/types";
import { TournamentIdentity } from "./TournamentIdentity";
import { PollaSection } from "./PollaSection";

const PAGE_SIZE = 5;
const searchKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Una polla = una tarjeta = un toque.
 *
 * (2026-09-18, pedido del dueño) Los cupos salieron de esta lista. Antes cada
 * tarjeta era un tablero en miniatura — selector de cupo, pastilla de pago,
 * pastilla de faltantes, «también te faltan en #2, #3» y un botón «Abrir cupo
 * 1» — y obligaba a entender qué es un cupo, y a elegir uno, antes de entrar a
 * la polla. Eso vive ahora SOLO dentro de la polla (components/casa/
 * Participaciones.tsx), que es donde se pronostica.
 *
 * Lo que queda es una portada: nombre, torneos, pozo, cierre y UNA línea de
 * estado, la más urgente de todas (ver `siguientePaso`). Si no hay nada que
 * hacer no se dice nada: estar en esta lista ya significa que estás dentro, y
 * un «Pagado» verde permanente solo le roba atención al rojo que sí pide algo.
 */
export function MyPollas({ initialPollas, defaultOpen = true, activeOnly = false, split = false, flat = false, pendingByPolla = {} }: {
  initialPollas?: MyCasaPolla[]; defaultOpen?: boolean;
  /**
   * Inicio (2026-09-18): sin desplegable. Las pollas en las que estás salen de
   * una arriba; si no estás en ninguna, la sección no se dibuja (la pantalla
   * pasa directo a las pollas para entrar, que es lo único que hay que hacer).
   */
  flat?: boolean;
  /** /casa: la página ya filtró las finalizadas (viven en Pollas cerradas). */
  activeOnly?: boolean;
  /** Perfil (2026-09-17): en juego y cerradas en dos desplegables compactos. */
  split?: boolean;
  /** Respaldo para pollas sin conteo por cupo (se suman igual en una sola línea). */
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
  if (flat && pollas && pollas.length === 0 && !error) return null;
  if (!split) return <MyPollasSection id="mis-pollas" kind="mine" flat={flat} pollas={pollas} error={error} retry={retry} defaultOpen={defaultOpen} activeOnly={activeOnly} pendingByPolla={pendingByPolla} />;
  return <div className="space-y-3">
    <MyPollasSection id="mis-pollas" kind="mine" compact activeOnly pollas={pollas?.filter(p => !isFinished(p))} error={error} retry={retry} defaultOpen={defaultOpen} pendingByPolla={pendingByPolla} />
    <MyPollasSection id="mis-pollas-cerradas" kind="closed" compact pollas={pollas?.filter(isFinished)} error={error} retry={retry} defaultOpen={false} pendingByPolla={pendingByPolla} />
  </div>;
}

const isFinished = (p: MyCasaPolla) => p.status === "resuelta" || p.status === "anulada";

type Paso = { texto: string; tono: "urgente" | "espera"; verbo: string } | null;

/**
 * La única línea de estado de la tarjeta, por orden de urgencia:
 *   1. Te faltan pronósticos (sumados entre todos tus cupos, sin enumerarlos).
 *   2. Un pago en revisión y nada más urgente.
 *   3. Nada. Estás dentro y al día: la tarjeta se calla.
 * Una polla finalizada nunca pide nada.
 */
export function siguientePaso(polla: MyCasaPolla, fallback: number, en: boolean): Paso {
  if (isFinished(polla)) return null;
  const faltan = polla.entries.length > 0
    ? polla.entries.reduce((total, entry) => total + (entry.pending ?? 0), 0)
    : fallback;
  if (faltan > 0) return {
    texto: en
      ? `${faltan} ${faltan === 1 ? "prediction" : "predictions"} missing`
      : faltan === 1 ? "Te falta 1 pronóstico" : `Te faltan ${faltan} pronósticos`,
    tono: "urgente",
    verbo: en ? "Continue" : "Continuar",
  };
  const revision = polla.entries.some(e => e.status === "pendiente") || (polla.entries.length === 0 && polla.entry_status === "pendiente");
  if (revision) return {
    texto: en ? "Payment under review" : "Pago en revisión",
    tono: "espera",
    verbo: en ? "Open pool" : "Ver polla",
  };
  return null;
}

function MyPollasSection({ id, kind, pollas, error, retry, defaultOpen, activeOnly = false, compact = false, flat = false, pendingByPolla }: {
  id: string; kind: "mine" | "closed"; pollas?: MyCasaPolla[]; error: boolean; retry: () => void;
  defaultOpen: boolean; activeOnly?: boolean; compact?: boolean; flat?: boolean; pendingByPolla: Record<string, number>;
}) {
  const en = useLocale() === "en";
  const closedList = kind === "closed";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const title = closedList ? (en ? "Finished" : "Terminadas") : (en ? "My pools" : "Mis pollas");
  const description = closedList
    ? (en ? "Finished pools you took part in" : "Pollas finalizadas en las que participaste")
    : activeOnly ? (en ? "Your pools still in play" : "Tus pollas en juego") : (en ? "Pools you have joined" : "Pollas a las que te has unido");

  const filtered = (pollas ?? []).filter(p => searchKey(p.name).includes(searchKey(query.trim())));
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <PollaSection id={id} kind={kind} compact={compact} flat={flat} title={title} description={description} count={pollas ? pollas.length : "—"} defaultOpen={defaultOpen}>
      {error ? <div className="lp-card p-4 text-[15px] text-text-secondary" role="alert">
        <p>{en ? "Unable to load your pools." : "No pudimos cargar tus pollas."}</p>
        <button onClick={retry} className="mt-2 min-h-11 cursor-pointer rounded-full border border-border-default px-4 text-text-primary transition-colors hover:bg-bg-elevated">{en ? "Try again" : "Intentar de nuevo"}</button>
      </div> : !pollas ? <div className="lp-card h-28 animate-pulse" role="status" aria-label={en ? "Loading your pools" : "Cargando tus pollas"} /> : pollas.length === 0 ?
      closedList ? <p className="px-1 py-2 text-[15px] text-text-secondary">{en ? "You have no finished pools yet." : "Todavía no tienes pollas finalizadas."}</p> :
      <div className="lp-card p-5 text-center">
        <Ticket aria-hidden="true" className="mx-auto mb-2 h-7 w-7 text-text-secondary" />
        <p className="text-[15px] font-semibold text-text-primary">{activeOnly ? (en ? "You have no pools in play" : "No tienes pollas en juego") : (en ? "You haven't joined a pool yet" : "Todavía no te has inscrito en una polla")}</p>
        <Link href="/inicio#pollas-disponibles" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border-default px-4 text-[15px] text-text-primary transition-colors hover:bg-bg-elevated">{en ? "See available pools" : "Ver pollas disponibles"}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>
      </div> : <>
        {(pollas ?? []).length > PAGE_SIZE && <label className="block space-y-2 text-[13px] text-text-secondary">
          <span className="flex items-center gap-2"><Search aria-hidden="true" className="h-4 w-4" />{en ? "Search my pools" : "Buscar en mis pollas"}</span>
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="lp-input min-h-11 w-full text-[15px]" />
        </label>}
        <ul className="space-y-3">
          {visible.map(polla => {
            const finished = isFinished(polla);
            const paso = siguientePaso(polla, pendingByPolla[polla.id] ?? 0, en);
            const abierta = !finished && isPollaOpen({ status: polla.status, closes_at: polla.closes_at });
            const cupos = polla.entries.length;
            const premio = premioValor(polla);
            return <li key={polla.id}>
              {/* Toda la tarjeta es el enlace: un toque, sin elegir cupo antes de entrar. */}
              <Link
                href={`/polla/${polla.slug}`}
                className={`lp-card block space-y-3 p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${finished ? "bg-text-primary/[0.04] [&_img]:grayscale [&_img]:opacity-70" : `bg-bg-elevated border-l-[3px] ${paso?.tono === "urgente" ? "border-l-red-alert" : paso?.tono === "espera" ? "border-l-amber" : "border-l-turf"}`} ${paso?.tono === "urgente" ? "border-red-alert/50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <h3 className={`min-w-0 flex-1 font-display text-[22px] leading-tight tracking-wide ${finished ? "text-text-secondary" : "text-text-primary"} [overflow-wrap:anywhere]`}>{polla.name}</h3>
                  {cupos > 1 && <span className="mt-1 shrink-0 text-[13px] tabular-nums text-text-secondary">{cupos} {en ? "entries" : "cupos"}</span>}
                  <ChevronRight aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-text-secondary" />
                </div>
                <TournamentIdentity tournaments={polla.tournaments} kind={polla.kind} />

                {/* Premio y cierre: lo único que de verdad se compara entre pollas.
                    Un premio en objeto muestra el objeto: «POZO $0» hacía ver una
                    polla que regala entradas como una que no reparte nada. */}
                {(premio !== null || abierta) && <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                  {premio !== null && <div className="min-w-0">
                    <span className="lp-label block">{premioLabel(en)}</span>
                    <span className={`${polla.prize_kind === "objeto" ? "font-semibold" : "lp-money"} mt-0.5 block text-[24px] leading-tight [overflow-wrap:anywhere] ${finished ? "text-text-secondary" : "text-text-primary"}`}>{premio}</span>
                  </div>}
                  {abierta && <div className="min-w-0 text-right">
                    <span className="lp-label block">{en ? "Closes in" : "Cierra en"}</span>
                    <span className="mt-0.5 block text-[15px] font-semibold text-gold [overflow-wrap:anywhere]">{timeLeft(polla.closes_at)}</span>
                  </div>}
                </div>}

                {/* Una sola línea de estado, y solo si hay algo que hacer. */}
                {paso && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
                  <span className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold ${paso.tono === "urgente" ? "border-red-alert/50 bg-red-alert/10 text-red-alert" : "border-amber/50 bg-amber/15 text-amber"}`}>
                    {paso.tono === "urgente" && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-alert" />}
                    {paso.texto}
                  </span>
                  <span className="inline-flex min-h-8 items-center gap-1 text-[13px] font-semibold text-text-primary">
                    {paso.verbo}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                  </span>
                </div>}
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
