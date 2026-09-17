"use client";

// components/casa/MatchIssueDecision.tsx — anular o mantener un partido con
// novedades y, si el caso es «Sin datos del proveedor», poner el resultado de
// los 90 minutos. Confirmación en dos pasos dentro de la tarjeta, sin alert().
// Mount only inside an admin-gated surface; the endpoints check is_admin too.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, PenLine } from "lucide-react";
import { CASA_HEADERS } from "@/lib/casa/contract";
import type { MatchIssueKind } from "@/lib/casa/match-issue-kinds";

type Choice = "anular" | "mantener" | "resultado";

type Copy = { title: string; body: string; action: string; busy: string; done: string };

const CONFIRM_COPY: Record<"anular" | "mantener", Copy> = {
  anular: {
    title: "Anular este partido",
    body: "El partido quedará anulado en las pollas afectadas que no han terminado. Todos reciben 0 puntos en ese partido, aunque se juegue después. Esta decisión no se puede cambiar.",
    action: "Confirmar anulación",
    busy: "Anulando...",
    done: "Partido anulado. Todos reciben 0 puntos en ese partido.",
  },
  mantener: {
    title: "Mantener el partido",
    body: "El partido sigue en las pollas. Sus puntos se calculan cuando se juegue o se verifique su resultado. Esta decisión no se puede cambiar.",
    action: "Confirmar: mantener",
    busy: "Guardando...",
    done: "Decisión guardada. El partido sigue en las pollas.",
  },
};

const SIN_DATOS_KEEP_COPY: Copy = {
  ...CONFIRM_COPY.mantener,
  body: "El partido sigue en las pollas y esperamos su marcador. Sus puntos se calculan cuando se verifique el resultado. Si la hora de inicio cambia y vuelve a pasar sin datos, se abrirá un caso nuevo.",
};

function parseGoals(value: string): number | null {
  if (!/^\d{1,2}$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function MatchIssueDecision({ issueId, matchLabel, kind, homeTeam, awayTeam }: {
  issueId: string;
  matchLabel: string;
  kind?: MatchIssueKind;
  homeTeam?: string;
  awayTeam?: string;
}) {
  const router = useRouter();
  const sendingRef = useRef(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sinDatos = kind === "sin_datos";
  const homeGoals = parseGoals(home);
  const awayGoals = parseGoals(away);
  const scoreReady = homeGoals !== null && awayGoals !== null;

  async function confirm() {
    if (!choice || sendingRef.current) return;
    if (choice === "resultado" && !scoreReady) {
      setError("Escribe los goles de cada equipo: números enteros entre 0 y 99.");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const response = choice === "resultado"
        ? await fetch(`/api/casa/admin/match-issues/${issueId}/resultado`, {
          method: "POST",
          headers: CASA_HEADERS,
          body: JSON.stringify({ home: homeGoals, away: awayGoals }),
        })
        : await fetch(`/api/casa/admin/match-issues/${issueId}`, {
          method: "POST",
          headers: CASA_HEADERS,
          body: JSON.stringify({ decision: choice, ...(note.trim() ? { note: note.trim() } : {}) }),
        });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "No se pudo guardar la decisión. Intenta otra vez.");
        // Otro administrador o el proveedor pudo cerrar el caso primero: traer el estado vigente.
        if (response.status === 409) router.refresh();
        return;
      }
      setDone(choice === "resultado"
        ? `Resultado guardado: ${homeGoals} - ${awayGoals}. Los puntos de las pollas ya se calcularon.`
        : (choice === "mantener" && sinDatos ? SIN_DATOS_KEEP_COPY : CONFIRM_COPY[choice]).done);
      setChoice(null);
      setNote("");
      router.refresh();
    } catch {
      setError("Se cayó la conexión. No se pudo confirmar la decisión.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function pick(next: Choice) {
    setChoice(next);
    setError(null);
  }

  if (done) return <p role="status" className="mt-4 rounded-md border border-border-default p-3 text-[15px] leading-[1.45] text-text-primary">{done}</p>;

  const homeName = homeTeam ?? "Local";
  const awayName = awayTeam ?? "Visitante";
  const copy = choice === "anular" || choice === "mantener"
    ? (choice === "mantener" && sinDatos ? SIN_DATOS_KEEP_COPY : CONFIRM_COPY[choice])
    : null;

  return (
    <div className="mt-4 border-t border-border-default pt-4">
      {choice === "resultado" ? (
        <div role="group" aria-label={`Resultado de los 90 minutos: ${matchLabel}`}
          className="rounded-md border border-border-strong bg-bg-elevated/60 p-3 [overflow-wrap:anywhere]">
          <h3 className="text-[15px] font-semibold leading-[1.45] text-text-primary">Resultado de los 90 minutos</h3>
          <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">Escribe el marcador al final del tiempo reglamentario, sin alargue ni penales. El partido queda verificado y los puntos se calculan de inmediato. No se puede cambiar después.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            <label htmlFor={`issue-home-${issueId}`} className="block min-w-0 text-[15px] font-medium leading-[1.45] text-text-primary">
              {homeName}
              <input id={`issue-home-${issueId}`} type="number" inputMode="numeric" min={0} max={99} step={1}
                value={home} disabled={sending} onChange={(event) => setHome(event.target.value)}
                className="lp-input mt-1 w-full min-w-0 !text-[15px]" />
            </label>
            <label htmlFor={`issue-away-${issueId}`} className="block min-w-0 text-[15px] font-medium leading-[1.45] text-text-primary">
              {awayName}
              <input id={`issue-away-${issueId}`} type="number" inputMode="numeric" min={0} max={99} step={1}
                value={away} disabled={sending} onChange={(event) => setAway(event.target.value)}
                className="lp-input mt-1 w-full min-w-0 !text-[15px]" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={sending || !scoreReady} onClick={confirm}
              className="lp-btn lp-btn-ghost min-h-11 grow basis-40 border-border-strong">
              {sending ? "Guardando..." : scoreReady ? `Confirmar ${homeGoals} - ${awayGoals}` : "Confirmar resultado"}
            </button>
            <button type="button" disabled={sending} onClick={() => { setChoice(null); setError(null); }}
              className="lp-btn lp-btn-ghost min-h-11 grow basis-40">Cancelar</button>
          </div>
        </div>
      ) : copy && choice ? (
        <div role="group" aria-label={`${copy.title}: ${matchLabel}`}
          className={`rounded-md border p-3 [overflow-wrap:anywhere] ${choice === "anular" ? "border-red-alert/40 bg-red-alert/10" : "border-border-strong bg-bg-elevated/60"}`}>
          <h3 className="text-[15px] font-semibold leading-[1.45] text-text-primary">{copy.title}</h3>
          <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">{copy.body}</p>
          <label htmlFor={`issue-note-${issueId}`} className="mt-3 block text-[15px] font-medium leading-[1.45] text-text-primary">Nota (opcional)</label>
          <textarea id={`issue-note-${issueId}`} value={note} maxLength={300} rows={2} disabled={sending}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Por ejemplo: el organizador confirmó que no se reanuda"
            className="lp-input mt-1 w-full min-w-0 resize-y !text-[15px]" />
          <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">{note.length}/300</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={sending} onClick={confirm}
              className={`lp-btn min-h-11 grow basis-40 ${choice === "anular" ? "bg-red-alert text-bg-base hover:brightness-110" : "lp-btn-ghost border-border-strong"}`}>
              {sending ? copy.busy : copy.action}
            </button>
            <button type="button" disabled={sending} onClick={() => { setChoice(null); setError(null); }}
              className="lp-btn lp-btn-ghost min-h-11 grow basis-40">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {sinDatos && <button type="button" onClick={() => pick("resultado")}
            aria-label={`Poner el resultado de los 90 minutos de ${matchLabel}`}
            className="lp-btn lp-btn-ghost min-h-11 w-full border-border-strong">
            <PenLine className="h-4 w-4 shrink-0" aria-hidden="true" /> Poner resultado de los 90 minutos
          </button>}
          <button type="button" onClick={() => pick("anular")}
            aria-label={`Anular ${matchLabel}: 0 puntos para todos`}
            className="lp-btn lp-btn-ghost min-h-11 w-full border-red-alert/40 text-red-alert hover:border-red-alert hover:bg-red-alert/10">
            <Ban className="h-4 w-4 shrink-0" aria-hidden="true" /> Anular: 0 puntos para todos
          </button>
          <button type="button" onClick={() => pick("mantener")}
            aria-label={sinDatos ? `Mantener ${matchLabel} y esperar los datos` : `Mantener ${matchLabel}`}
            className="lp-btn lp-btn-ghost min-h-11 w-full">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> {sinDatos ? "Mantener y esperar los datos" : "Mantener el partido"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-alert/30 p-3 text-[13px] leading-[1.5] text-red-alert">{error}</p>}
      {!sinDatos && <Link href="/admin/discrepancias" className="mt-3 inline-flex min-h-11 items-center gap-2 text-[15px] text-text-secondary underline underline-offset-4 transition-colors hover:text-text-primary">
        <PenLine className="h-4 w-4 shrink-0" aria-hidden="true" /> Poner resultado manual
      </Link>}
    </div>
  );
}
