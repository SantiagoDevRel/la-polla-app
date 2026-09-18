// components/casa/MatchIssuesReview.tsx — lista de partidos con novedades.
// Presentacional (sin estado): los textos y fechas llegan ya calculados desde
// el servidor en hora de Colombia. Las acciones viven en MatchIssueDecision.
//
// Tipografía: Bebas 20 para secciones; Outfit 15/1.45 para contenido y
// controles, 13/1.5 para ayuda. Todo el texto hace wrap, nada se trunca.

import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ShieldCheck } from "lucide-react";
import { MatchIssueDecision } from "@/components/casa/MatchIssueDecision";
import { describeDecision, type MatchIssueView } from "@/lib/casa/match-issues";

/** Las notas que escribe SQL al cerrar solo un caso (migración 121), dichas en claro. */
function automaticNote(note: string): string | null {
  if (note === "Se cerró solo: llegaron datos del proveedor.") return "Se cerró solo porque ya llegaron el marcador y el minuto del partido. El partido sigue su curso normal.";
  if (note === "Se cerró solo: el resultado quedó verificado.") return "Se cerró solo porque el resultado del partido ya quedó verificado.";
  if (note === "Se cerró solo: el partido tiene una nueva hora de inicio.") return "Se cerró solo porque el partido tiene una nueva hora de inicio.";
  return null;
}

function MatchHeader({ issue }: { issue: MatchIssueView }) {
  return <>
    {issue.tournamentName && <p className="text-[13px] leading-[1.5] text-text-secondary [overflow-wrap:anywhere]">{issue.tournamentName}</p>}
    <h3 className="mt-1 text-[15px] font-semibold leading-[1.45] text-text-primary [overflow-wrap:anywhere]">
      {issue.homeTeam} <span className="font-normal text-text-secondary">vs</span> {issue.awayTeam}
    </h3>
    {issue.scheduledLabel && issue.scheduledIso && <p className="mt-1 flex items-start gap-2 text-[13px] leading-[1.5] text-text-secondary">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span><time dateTime={issue.scheduledIso}>{issue.scheduledLabel}</time></span>
    </p>}
  </>;
}

function AffectedPollas({ issue }: { issue: MatchIssueView }) {
  if (issue.pollas.length === 0) {
    return <p className="mt-3 text-[13px] leading-[1.5] text-text-secondary">Este partido ya no está en ninguna polla activa.</p>;
  }
  return <div className="mt-3">
    <p className="text-[13px] font-medium leading-[1.5] text-text-secondary">{issue.pollas.length === 1 ? "Polla afectada" : `Pollas afectadas (${issue.pollas.length})`}</p>
    <ul className="mt-1 space-y-1">
      {issue.pollas.map((polla) => <li key={polla.id} className="flex flex-wrap items-center gap-x-2 text-[15px] leading-[1.45]">
        {polla.linkable
          ? <Link href={`/polla/${polla.slug}`} className="inline-flex min-h-11 items-center text-text-primary underline underline-offset-4 transition-colors hover:text-gold [overflow-wrap:anywhere]">{polla.name}</Link>
          : <span className="inline-flex min-h-11 items-center text-text-primary [overflow-wrap:anywhere]">{polla.name}</span>}
        <span className="text-[13px] text-text-secondary">{polla.statusLabel}{polla.voided ? " · anulado en esta polla" : ""}</span>
      </li>)}
    </ul>
  </div>;
}

function OpenIssueBody({ issue }: { issue: MatchIssueView }) {
  return <>
    <MatchHeader issue={issue} />
    <p className="mt-3 flex items-start gap-2 text-[15px] font-semibold leading-[1.45] text-amber">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{issue.summary}</span>
    </p>
    {issue.score && <p className="mt-1 text-[15px] leading-[1.45] text-text-primary">Marcador: <span className="lp-money">{issue.score}</span></p>}
    {issue.kind === "sin_datos" && <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">La fuente de resultados todavía no reporta el marcador ni el minuto de este partido. Suele ser un atraso: cuando lleguen los datos, el caso se cierra solo y el resultado se verifica como siempre. Si ya sabes el marcador de los 90 minutos, puedes ponerlo; también puedes anular el partido o esperar.</p>}
    {issue.currentState && <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">{issue.currentState}</p>}
    <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">Detectado: <time dateTime={issue.firstSeenIso}>{issue.firstSeenLabel}</time></p>
    <AffectedPollas issue={issue} />
    <MatchIssueDecision issueId={issue.id} kind={issue.kind} homeTeam={issue.homeTeam} awayTeam={issue.awayTeam}
      matchLabel={`${issue.homeTeam} vs ${issue.awayTeam}`} />
  </>;
}

export function MatchIssuesReview({ open, inactive = [], decided, openTruncated }: {
  open: MatchIssueView[];
  /** Abiertos que ya no afectan pollas activas: van al final y no cuentan como pendientes. */
  inactive?: MatchIssueView[];
  decided: MatchIssueView[];
  openTruncated: boolean;
}) {
  return <div className="space-y-6">
    <section aria-labelledby="issues-open-title">
      <h2 id="issues-open-title" className="font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Por decidir{open.length > 0 ? ` (${open.length})` : ""}</h2>
      {open.length === 0 ? (
        <div className="lp-card mt-3 px-5 py-8 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-text-secondary" aria-hidden="true" />
          <p className="mt-3 font-display text-[24px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">No hay partidos con novedades</p>
          <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">Si un partido de una polla activa se suspende, se aplaza, se cancela, se abandona o pasa media hora de su inicio sin marcador, aparecerá aquí para que decidas.</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-4">
          {open.map((issue) => <li key={issue.id} className="lp-card p-4 transition-colors duration-200 hover:border-border-strong">
            <OpenIssueBody issue={issue} />
          </li>)}
        </ul>
      )}
      {openTruncated && <p role="status" className="mt-3 text-[13px] leading-[1.5] text-text-secondary">Se muestran los 200 casos más antiguos. Decide estos para ver los siguientes.</p>}
    </section>

    {inactive.length > 0 && <details className="group lp-card overflow-hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
        <span className="font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Sin pollas activas ({inactive.length})</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p className="border-t border-border-default px-4 py-3 text-[13px] leading-[1.5] text-text-secondary">Estos partidos ya no están en pollas activas, así que no bloquean ningún reparto. Puedes decidirlos igual; si vuelven a usarse en una polla, pasarán a Por decidir.</p>
      <ul className="divide-y divide-border-default border-t border-border-default">
        {inactive.map((issue) => <li key={issue.id} className="p-4">
          <OpenIssueBody issue={issue} />
        </li>)}
      </ul>
    </details>}

    {decided.length > 0 && <details className="group lp-card overflow-hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
        <span className="font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Decididos recientemente ({decided.length})</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="divide-y divide-border-default border-t border-border-default">
        {decided.map((issue) => <li key={issue.id} className="p-4">
          <MatchHeader issue={issue} />
          <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">Motivo del caso: {issue.summary}</p>
          {/* El marcador y el estado son los de AHORA, no los del momento del caso. */}
          {(issue.currentState || issue.score) && <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">{issue.currentState ?? "Estado actual"}{issue.score ? ` · marcador ${issue.score}` : ""}</p>}
          {issue.decision && <p className={`mt-2 flex items-start gap-2 text-[15px] font-semibold leading-[1.45] ${issue.decision === "anular" ? "text-red-alert" : "text-text-primary"}`}>
            {issue.decision === "anular"
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{describeDecision(issue.decision)}</span>
          </p>}
          <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary [overflow-wrap:anywhere]">
            {issue.decision === "resuelto" && !issue.decidedByName ? "Cerrado automáticamente" : `Por ${issue.decidedByName ?? "Administrador"}`}{issue.decidedAtLabel && issue.decidedAtIso ? <>, <time dateTime={issue.decidedAtIso}>{issue.decidedAtLabel}</time></> : null}
          </p>
          {issue.note && <p className="mt-1 whitespace-pre-line text-[13px] leading-[1.5] text-text-secondary [overflow-wrap:anywhere]">{automaticNote(issue.note) ?? `Nota: ${issue.note.replace(/datos del proveedor/g, "datos del partido")}`}</p>}
          {issue.pollas.length > 0 && <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary [overflow-wrap:anywhere]">Pollas: {issue.pollas.map((polla) => polla.name).join(", ")}</p>}
        </li>)}
      </ul>
    </details>}
  </div>;
}
