"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Plus, RefreshCw, Ticket, Files, CheckCircle2, AlertTriangle, Settings, Trophy } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { HeroFrame, Label, Tape } from "@/components/street";
import { Skeleton } from "@/components/ui/Skeleton";
import { AccionesPolla } from "@/components/casa/AccionesPolla";
import { ColaDePagos } from "@/components/casa/ColaDePagos";
import { PagosGanadores } from "@/components/casa/PagosGanadores";
import { PremioObjeto } from "@/components/casa/PremioObjeto";
import { ResolverPolla } from "@/components/casa/ResolverPolla";
import { fadeUp, staggerContainer } from "@/lib/animations";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { editorHref } from "@/lib/casa/editor";
import { referralEvery } from "@/lib/casa/referrals-shared";
import { RegalosPolla } from "@/components/casa/RegalosPolla";
import type { pollaStatusLabel, CasaPolla, CasaPot, CasaSettlementReadiness } from "@/lib/casa/types";

export type AdminPolla = Pick<CasaPolla, "id" | "slug" | "name" | "kind" | "status" | "closes_at" | "opens_at" | "publication_mode" | "prize_kind" | "prize_object" | "draw_pending" | "settlement_outcome" | "entry_price_cop" | "referral_every"> & {
  label: ReturnType<typeof pollaStatusLabel>;
  private_draft?: boolean;
  /** Se puede editar (antes del cierre). */
  editable?: boolean;
};

/** Pozo en dinero de partidos o preguntas: el reparto se confirma en «Pago a ganadores». */
function settleInline(polla: Pick<AdminPolla, "prize_kind" | "kind">) {
  return polla.prize_kind === "pozo" && (polla.kind === "partidos" || polla.kind === "manual");
}

export function CasaAdminPanel({ pollas, pots, totalCasa, openIssues = null, readiness = {} }: {
  pollas: AdminPolla[];
  pots: Record<string, CasaPot>;
  totalCasa: number;
  /** Pollas de pozo en juego o terminadas: si ya se pueden repartir (migración 134). */
  readiness?: Record<string, CasaSettlementReadiness>;
  /** Casos de partidos sin decidir; `null` si no se pudo leer el conteo. */
  openIssues?: number | null;
}) {
  const reducedMotion = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    async function cargar() {
      try {
        const response = await fetch("/api/casa/admin/entries?summary=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("No se pudieron cargar los pendientes");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setCounts(data.counts);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void cargar();
    // Solo mientras el administrador tiene esta pantalla visible.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRevision((value) => value + 1);
    }, 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [revision]);

  const totalPendientes = counts ? Object.values(counts).reduce((total, count) => total + count, 0) : null;
  // (2026-09-17) Pollas con todos los partidos verificados y nada pendiente: toca repartir y pagar.
  const listas = pollas.filter((polla) => readiness[polla.id]?.ready);
  function abrirPolla(id: string) {
    setOpenId(id);
    requestAnimationFrame(() => document.getElementById(`polla-toggle-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[232px]">
        <Link href="/admin" className="mb-3 inline-flex min-h-11 items-center gap-2 self-start text-[13px] text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administración
        </Link>
        <Label>Administración</Label>
        <h1 className="mt-1 font-display text-[32px] font-normal uppercase leading-[1.1] tracking-[0.04em] text-text-primary">Administrar pollas</h1>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <Label>Balance de la casa</Label>
            <p className="lp-money mt-1 text-[24px] leading-none text-gold [overflow-wrap:anywhere]">{formatCop(totalCasa)}</p>
          </div>
          <div className="min-w-0">
            <Label>Recibos pendientes</Label>
            {counts === null && loading ? <Skeleton className="mt-1 h-6 w-12" /> : <p className="lp-money mt-1 text-[24px] leading-none text-text-primary">{error ? "—" : totalPendientes ?? "—"}</p>}
          </div>
        </div>
      </HeroFrame>

      <div className="px-4 pt-5">
        <div className="mb-5 flex flex-wrap gap-2">
          <Link href="/admin/pollas/crear" className="lp-btn lp-btn-primary grow basis-40">
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Crear polla
          </Link>
          <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading} className="lp-btn lp-btn-ghost grow basis-40">
            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" /> Actualizar pagos
          </button>
        </div>
        <nav aria-label="Revisión de pagos" className="mb-5 grid grid-cols-2 gap-2">
          <Link href="/admin/pollas/recibos" className="lp-btn lp-btn-ghost flex-col !px-3 !text-[15px]"><Files className="h-5 w-5 shrink-0" aria-hidden="true" />Recibos pendientes</Link>
          <Link href="/admin/pollas/pagos" className="lp-btn lp-btn-ghost flex-col !px-3 !text-[15px]"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />Pagos aprobados</Link>
        </nav>
        <p className="mb-5 text-[13px] leading-relaxed text-text-secondary">Revisa todos los recibos pendientes o abre una polla para ver solo los suyos. Los pagos aprobados quedan en su historial.</p>
        {error && <div role="alert" className="mb-4 rounded-md border border-red-alert/30 p-3 text-[13px] text-red-alert">No se pudieron actualizar los conteos. Puedes abrir una polla para revisar sus pagos o intentar actualizar otra vez.</div>}
        {listas.length > 0 && (
          <button type="button" onClick={() => abrirPolla(listas[0].id)}
            className="mb-3 flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md border border-turf/50 bg-turf/10 px-4 py-3 text-left transition-colors duration-200 hover:bg-turf/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
            <Trophy className="h-5 w-5 shrink-0 text-turf" aria-hidden="true" />
            <span className="min-w-0 grow">
              <span className="block text-[15px] font-semibold leading-[1.45] text-text-primary">{listas.length === 1 ? "1 polla lista para repartir" : `${listas.length} pollas listas para repartir`}</span>
              <span className="block text-[13px] leading-[1.5] text-text-secondary [overflow-wrap:anywhere]">Todos sus resultados están verificados. Revisa los ganadores, confirma y paga: {listas.map((polla) => polla.name).join(", ")}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
          </button>
        )}
        <Link href="/admin/issues"
          className={`mb-5 flex min-h-14 items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-200 hover:bg-bg-elevated/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${openIssues !== null && openIssues > 0 ? "border-amber/60 bg-amber/10" : "border-border-default"}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${openIssues !== null && openIssues > 0 ? "text-amber" : "text-text-secondary"}`} aria-hidden="true" />
          <span className="min-w-0 grow">
            <span className="block text-[15px] font-semibold leading-[1.45] text-text-primary">Issues de partidos</span>
            <span className={`block text-[13px] leading-[1.5] ${openIssues !== null && openIssues > 0 ? "font-medium text-amber" : "text-text-secondary"}`}>
              {openIssues === null ? "No se pudo leer el conteo. Abre la lista para revisarla." : openIssues === 0 ? "Sin partidos por decidir" : `${openIssues} ${openIssues === 1 ? "partido por decidir" : "partidos por decidir"}`}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
        </Link>

        {pollas.length === 0 ? (
          <div className="lp-card px-5 py-8 text-center">
            <Ticket className="mx-auto h-8 w-8 text-text-secondary" aria-hidden="true" />
            <h2 className="mt-3 font-display text-[24px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Todavía no hay pollas</h2>
            <p className="mt-2 text-[14px] text-text-secondary">Crea la primera polla para recibir inscripciones y revisar sus pagos aquí.</p>
            <Link href="/admin/pollas/crear" className="lp-btn lp-btn-ghost mt-5">Crear la primera polla</Link>
          </div>
        ) : (
          <motion.ul variants={staggerContainer} initial={reducedMotion ? false : "hidden"} animate="visible" className="space-y-4">
            {pollas.map((polla) => {
              const expanded = openId === polla.id;
              const status = polla.label;
              const pot = pots[polla.id];
              const pending = counts?.[polla.id] ?? 0;
              return (
                <motion.li key={polla.id} variants={fadeUp} className="lp-card overflow-hidden">
                  <h2>
                    <button
                      type="button"
                      id={`polla-toggle-${polla.id}`}
                      aria-expanded={expanded}
                      aria-controls={`polla-panel-${polla.id}`}
                      onClick={() => setOpenId(expanded ? null : polla.id)}
                      className="w-full cursor-pointer p-4 text-left transition-colors duration-200 hover:bg-bg-elevated/60 active:bg-bg-elevated"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0 text-[17px] font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">{polla.name}</span>
                        <ChevronDown className={`mt-0.5 h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                      </span>
                      <span className={`mt-2 block text-[13px] font-medium ${!error && counts && pending > 0 ? "text-amber" : "text-text-secondary"}`}>
                        {error ? "Pendientes por actualizar" : counts === null ? "Cargando pendientes..." : `${pending} ${pending === 1 ? "pendiente" : "pendientes"} por revisar`}
                      </span>
                      <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Tape tone={status.tone === "cal" ? "mute" : status.tone}>{status.text}</Tape>
                        {readiness[polla.id]?.ready && <Tape tone="live">Lista para repartir</Tape>}
                        <span className="text-[12px] text-text-secondary">{pot?.paid_entries ?? 0} inscritos</span>
                        {polla.status === "abierta" && <span className="text-[12px] text-text-secondary">Cierra en {timeLeft(polla.closes_at)}</span>}
                      </span>
                    </button>
                  </h2>
                  <div id={`polla-panel-${polla.id}`} role="region" aria-labelledby={`polla-toggle-${polla.id}`} hidden={!expanded}>
                    {expanded && (
                      <div className="border-t border-border-default p-4">
                        {/* (2026-09-16) Con la polla resuelta, lo primero es pagar
                            a los ganadores y dejar la prueba de pago. */}
                        {settleInline(polla) && (polla.status === "resuelta" || readiness[polla.id]?.inscriptionsClosed) && (
                          <PagosGanadores pollaId={polla.id} pollaName={polla.name} kind={polla.kind === "manual" ? "manual" : "partidos"} />
                        )}
                        {!polla.private_draft && <ColaDePagos key={polla.id} pollaId={polla.id} refreshKey={revision} onReviewed={() => setRevision((value) => value + 1)} />}
                        {!polla.private_draft && <Link href={`/admin/pollas/pagos?pollaId=${polla.id}`} className="lp-btn lp-btn-ghost mt-4 w-full !text-[15px]">Ver pagos aprobados</Link>}
                        {/* Invitaciones (migración 135): los regalos se crean solos; remover es opcional. */}
                        {referralEvery(polla) !== null && (
                          <RegalosPolla key={`regalos-${polla.id}`} pollaId={polla.id} every={referralEvery(polla)!} refreshKey={revision}
                            editable={polla.status === "abierta" || polla.status === "cerrada"} />
                        )}
                        <div className="mt-6 border-t border-border-default pt-4">
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0"><Label>{polla.prize_kind === "objeto" ? "Premio" : "Pozo"}</Label><p className="lp-money mt-1 text-[24px] text-text-primary [overflow-wrap:anywhere]">{polla.prize_kind === "objeto" ? polla.prize_object : formatCop(pot?.prize_cop ?? 0)}</p></div>
                            <div className="flex flex-wrap gap-2">
                              {polla.private_draft && <Link href={`/admin/pollas/${polla.id}/preview`} className="lp-btn lp-btn-primary !text-[15px]">Ver borrador privado</Link>}
                              {polla.editable && <Link href={editorHref(polla.id)} className="lp-btn lp-btn-ghost !px-3 !text-[13px]"><Settings className="h-4 w-4 shrink-0" aria-hidden="true" />Editar</Link>}
                              {polla.status !== "borrador" && <Link href={`/polla/${polla.slug}`} className="lp-btn lp-btn-ghost !px-3 !text-[13px]">Ver polla</Link>}
                            </div>
                          </div>
                          <div className="[&_button]:!min-h-11">
                            {/* Resolver preguntas / registrar el número de la
                                rifa. Sin esto, esas dos clases de polla solo
                                se podían cerrar desde el bot de Telegram. */}
                            {(polla.kind === "manual" || polla.kind === "rifa") &&
                              ["abierta", "cerrada"].includes(polla.status) && !polla.draw_pending && (
                                <ResolverPolla id={polla.id} kind={polla.kind} />
                              )}
                            {polla.prize_kind === "objeto" && (polla.draw_pending || polla.status === "resuelta") && <PremioObjeto slug={polla.slug} />}
                            {polla.private_draft ? <p className="text-[13px] leading-relaxed text-text-secondary">Solo visible para los administradores autorizados. Publicación e inscripciones bloqueadas.</p> : <AccionesPolla id={polla.id} status={polla.status} nombre={polla.name} prizeKind={polla.prize_kind} drawPending={polla.draw_pending} opensAt={polla.opens_at} settleInline={settleInline(polla)} />}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </div>
  );
}
