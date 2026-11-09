"use client";

// components/casa/PagarGanadorAdmin.tsx — pagar a un ganador desde la polla.
//
// (2026-11-09) Pedido del dueño: cuando la polla terminó, los administradores
// pagan desde la misma pantalla de la polla, debajo de cada ganador: «Pagar»
// abre un popup con la cuenta de esa persona y el botón para subir el
// comprobante. Reutiliza el mismo endpoint y la misma tarjeta del panel
// (/api/casa/admin/payouts + PagoGanador): la cuenta solo viaja a admins.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { PagoGanador } from "@/components/casa/PagosGanadores";
import type { AdminPayoutRow } from "@/lib/casa/types";

function PagoDialog({ pollaId, payoutId, displayName, onClose }: { pollaId: string; payoutId: string; displayName: string; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [row, setRow] = useState<AdminPayoutRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => { dialog.current?.showModal(); }, []);

  const load = useCallback(async (signal: AbortSignal) => {
    setError(null);
    try {
      const response = await fetch(`/api/casa/admin/payouts?pollaId=${pollaId}`, { cache: "no-store", signal });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "No se pudo cargar el pago.");
      const found = ((json.rows ?? []) as AdminPayoutRow[]).find((r) => r.id === payoutId);
      if (!found) throw new Error("No encontramos este premio. Actualiza la página.");
      if (!signal.aborted) setRow(found);
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el pago.");
    }
  }, [pollaId, payoutId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-border-default bg-bg-card p-0 text-text-primary backdrop:bg-bg-base/80 backdrop:backdrop-blur-sm"
    >
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="min-w-0 font-display text-[24px] leading-tight tracking-[0.04em] [overflow-wrap:anywhere]">Pagar a {displayName}</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {error && (
          <div role="alert" className="space-y-3 text-[15px]">
            <p className="text-red-alert">{error}</p>
            <button type="button" className="lp-btn lp-btn-ghost w-full" onClick={() => setRevision((v) => v + 1)}>Reintentar</button>
          </div>
        )}
        {!row && !error && <div role="status"><span className="sr-only">Cargando la cuenta</span><Skeleton className="h-40 w-full" /></div>}
        {row && (
          <ul>
            <PagoGanador
              row={row}
              mode="pay"
              onPaid={() => { router.refresh(); dialog.current?.close(); }}
            />
          </ul>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

/** Botón por ganador, solo para administradores. */
export function PagarGanadorAdmin({ pollaId, payoutId, displayName, pagado }: { pollaId: string; payoutId: string; displayName: string; pagado: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`lp-btn ${pagado ? "lp-btn-ghost" : "lp-btn-primary"} w-full !min-h-11 !text-[15px]`}
      >
        {pagado ? "Ver o cambiar comprobante" : "Pagar"}
      </button>
      {open && <PagoDialog pollaId={pollaId} payoutId={payoutId} displayName={displayName} onClose={() => setOpen(false)} />}
    </>
  );
}
