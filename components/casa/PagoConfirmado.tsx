"use client";

// components/casa/PagoConfirmado.tsx — «te aprobamos el pago», una sola vez.
//
// (2026-09-18) Antes, un cupo aprobado dejaba un recuadro verde permanente
// («Estás dentro»). Un estado feliz que nunca se va no informa: se vuelve
// paisaje y le roba atención al rojo, que sí pide algo. Pero la aprobación SÍ
// es noticia — la persona la estuvo esperando. La diferencia es que es un
// EVENTO, no un estado: se avisa la primera vez que vuelve después de que el
// administrador aprobó, y no vuelve a aparecer.
//
// Se recuerda en el navegador de esa persona (localStorage). Si el navegador no
// deja guardar, el aviso sale otra vez: molesta menos que no avisar nunca.

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

const seenKey = (entryId: string) => `lp_pago_ok:${entryId}`;

export function PagoConfirmado({ entryId, cortesia = false, cupo = null, abierta }: {
  entryId: string;
  /** Con una cortesía nadie pagó nada: decir «confirmamos tu pago» sería falso. */
  cortesia?: boolean;
  /** Número de cupo cuando la persona tiene varios. */
  cupo?: number | null;
  abierta: boolean;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(seenKey(entryId)) === "1") return;
    } catch {
      // Sin almacenamiento: se muestra en esta visita.
    }
    setShow(true);
  }, [entryId]);

  function cerrar() {
    setShow(false);
    try { localStorage.setItem(seenKey(entryId), "1"); } catch { /* Vuelve a salir la próxima vez. */ }
  }

  if (!show) return null;
  return (
    <div className="mt-4 flex items-start gap-3 border border-turf/40 bg-turf/10 p-3 first:mt-0" role="status">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-turf/40 text-turf">
        <Check aria-hidden="true" className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="lp-label text-turf">{cupo ? `Cupo ${cupo} · ` : ""}Ya estás dentro</p>
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
          {cortesia ? "Activamos tu cortesía y ya compites por el premio." : "Confirmamos tu pago y ya compites por el premio."}
          {abierta ? " Haz tus pronósticos antes del cierre." : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar aviso"
        className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <X aria-hidden="true" className="h-5 w-5" />
      </button>
    </div>
  );
}
