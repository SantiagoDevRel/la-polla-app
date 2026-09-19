"use client";

// components/casa/RegalosPolla.tsx — cupos de regalo por invitar en el panel (migración 135).
//
// Punto 5 del dueño: el cupo se crea solo, sin que el administrador haga nada.
// Punto 6: «Remover cupo» opcional, por si algo (varias cuentas de la misma
// persona, un pago mal aprobado). Remover pide motivo y se puede deshacer.

import { useEffect, useState, type FormEvent } from "react";
import { Gift } from "lucide-react";
import { casaPost } from "@/lib/casa/upload-client";
import { Skeleton } from "@/components/ui/Skeleton";

interface Regalo {
  entry_id: string;
  entry_number: number;
  status: "pagada" | "anulada";
  name: string | null;
  active_since: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  restored_at: string | null;
  invitados: number;
  nombres: string[];
}

export function RegalosPolla({ pollaId, every, editable, refreshKey = 0 }: {
  pollaId: string;
  every: number;
  editable: boolean;
  /** Cambia cuando el panel revisa pagos: vuelve a leer sin borrar un motivo a medio escribir. */
  refreshKey?: number;
}) {
  const [regalos, setRegalos] = useState<Regalo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [removiendo, setRemoviendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/casa/admin/regalos?pollaId=${encodeURIComponent(pollaId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar los cupos de regalo.");
        setRegalos(body.regalos ?? []);
        setError(null);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los cupos de regalo."); });
    return () => controller.abort();
  }, [pollaId, revision, refreshKey]);

  async function enviar(body: { accion: "remover"; entryId: string; motivo: string } | { accion: "restaurar"; entryId: string }) {
    setEnviando(true);
    setError(null);
    try {
      await casaPost("/api/casa/admin/regalos", body);
      setRemoviendo(null);
      setMotivo("");
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el cambio.");
    } finally {
      setEnviando(false);
    }
  }

  function remover(event: FormEvent, entryId: string) {
    event.preventDefault();
    if (!motivo.trim()) return setError("Escribe el motivo para remover el cupo.");
    void enviar({ accion: "remover", entryId, motivo: motivo.trim() });
  }

  return (
    <section aria-labelledby={`regalos-${pollaId}`} className="mt-6 border-t border-border-default pt-4">
      <h3 id={`regalos-${pollaId}`} className="flex items-center gap-2 text-[15px] font-semibold leading-snug text-text-primary">
        <Gift aria-hidden="true" className="h-5 w-5 shrink-0 text-turf" />
        Cupos de regalo por invitar
      </h3>
      <p className="mt-1 text-[13px] text-text-secondary">
        Cupos gratis que alguien usó aquí: se gana 1 por cada {every} invitados nuevos con pago aprobado, en total. No suman al pozo.
      </p>

      {error && <p role="alert" className="mt-3 rounded-md border border-red-alert/30 p-3 text-[13px] text-red-alert">{error}</p>}

      {regalos === null ? (
        !error && <Skeleton className="mt-3 h-16 w-full" />
      ) : regalos.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-secondary">Todavía nadie ha usado un cupo gratis en esta polla.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {regalos.map((regalo) => {
            const removido = Boolean(regalo.removed_at && !regalo.restored_at);
            const estado = removido ? "Removido" : regalo.status === "pagada" ? "Activo" : "En pausa";
            const tono = removido ? "border-red-alert/50 bg-red-alert/10 text-red-alert"
              : regalo.status === "pagada" ? "border-turf/50 bg-turf/15 text-turf" : "border-amber/50 bg-amber/15 text-amber";
            return (
              <li key={regalo.entry_id} className="rounded-md border border-border-default bg-bg-elevated/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">
                    {regalo.name ?? "Sin nombre"} · Cupo #{regalo.entry_number}
                  </p>
                  <span className={`inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 text-[13px] font-semibold ${tono}`}>{estado}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                  {regalo.invitados} {regalo.invitados === 1 ? "invitado" : "invitados"} con pago aprobado
                  {regalo.nombres.length > 0 ? `: ${regalo.nombres.join(", ")}` : ""}
                </p>
                {removido && regalo.removed_reason && (
                  <p className="mt-1 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">Motivo: {regalo.removed_reason}</p>
                )}
                {!removido && regalo.status !== "pagada" && (
                  <p className="mt-1 text-[13px] text-text-secondary">En pausa: se corrigió un pago o llegó al máximo de cupos.</p>
                )}
                {editable && (removido ? (
                  <button type="button" disabled={enviando} onClick={() => enviar({ accion: "restaurar", entryId: regalo.entry_id })}
                    className="lp-btn lp-btn-ghost mt-3 min-h-11 w-full !text-[15px]">
                    Restaurar cupo
                  </button>
                ) : removiendo === regalo.entry_id ? (
                  <form onSubmit={(event) => remover(event, regalo.entry_id)} className="mt-3 space-y-2 rounded-md border border-red-alert/40 p-3">
                    <label htmlFor={`motivo-${regalo.entry_id}`} className="block text-[13px] text-text-secondary">
                      Motivo (queda en el historial)
                    </label>
                    <input id={`motivo-${regalo.entry_id}`} value={motivo} maxLength={200} onChange={(event) => setMotivo(event.target.value)}
                      placeholder="Ej. varias cuentas de la misma persona" className="lp-input min-h-11 w-full text-[15px]" />
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={enviando || !motivo.trim()} className="lp-btn min-h-11 flex-[1_0_auto] bg-red-alert !px-4 text-[15px] text-white">
                        {enviando ? "Removiendo…" : "Remover cupo"}
                      </button>
                      <button type="button" onClick={() => { setRemoviendo(null); setMotivo(""); }} className="lp-btn lp-btn-ghost min-h-11 flex-[1_0_auto] !px-4 text-[15px]">
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setRemoviendo(regalo.entry_id); setMotivo(""); }}
                    className="mt-3 min-h-11 w-full cursor-pointer rounded-full border border-red-alert/40 px-4 text-[15px] text-red-alert transition-colors hover:bg-red-alert/10">
                    Remover cupo
                  </button>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
