"use client";

// components/casa/MatchIssueDecision.tsx — anular o mantener un partido con
// novedades. Confirmación en dos pasos dentro de la tarjeta, sin alert().
// Mount only inside an admin-gated surface; the endpoint checks is_admin too.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, PenLine } from "lucide-react";
import { CASA_HEADERS } from "@/lib/casa/contract";

type Decision = "anular" | "mantener";

const CONFIRM_COPY: Record<Decision, { title: string; body: string; action: string; busy: string; done: string }> = {
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

export function MatchIssueDecision({ issueId, matchLabel }: { issueId: string; matchLabel: string }) {
  const router = useRouter();
  const sendingRef = useRef(false);
  const [choice, setChoice] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function confirm() {
    if (!choice || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/casa/admin/match-issues/${issueId}`, {
        method: "POST",
        headers: CASA_HEADERS,
        body: JSON.stringify({ decision: choice, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "No se pudo guardar la decisión. Intenta otra vez.");
        // Otro administrador pudo decidir primero: traer el estado vigente.
        if (response.status === 409) router.refresh();
        return;
      }
      setDone(CONFIRM_COPY[choice].done);
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

  if (done) return <p role="status" className="mt-4 rounded-md border border-border-default p-3 text-[15px] leading-[1.45] text-text-primary">{done}</p>;

  const copy = choice ? CONFIRM_COPY[choice] : null;
  return (
    <div className="mt-4 border-t border-border-default pt-4">
      {copy && choice ? (
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
          <button type="button" onClick={() => { setChoice("anular"); setError(null); }}
            aria-label={`Anular ${matchLabel}: 0 puntos para todos`}
            className="lp-btn lp-btn-ghost min-h-11 w-full border-red-alert/40 text-red-alert hover:border-red-alert hover:bg-red-alert/10">
            <Ban className="h-4 w-4 shrink-0" aria-hidden="true" /> Anular: 0 puntos para todos
          </button>
          <button type="button" onClick={() => { setChoice("mantener"); setError(null); }}
            aria-label={`Mantener ${matchLabel}`}
            className="lp-btn lp-btn-ghost min-h-11 w-full">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Mantener el partido
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-alert/30 p-3 text-[13px] leading-[1.5] text-red-alert">{error}</p>}
      <Link href="/admin/discrepancias" className="mt-3 inline-flex min-h-11 items-center gap-2 text-[15px] text-text-secondary underline underline-offset-4 transition-colors hover:text-text-primary">
        <PenLine className="h-4 w-4 shrink-0" aria-hidden="true" /> Poner resultado manual
      </Link>
    </div>
  );
}
