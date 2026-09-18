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
  // (2026-09-18) De recuadro de tres líneas a una franja: es una buena noticia,
  // no un párrafo. «Ya compites por el premio» y «haz tus pronósticos antes del
  // cierre» sobraban: los partidos están justo debajo.
  return (
    <div className="mt-4 flex items-center gap-2 rounded-full border border-turf/40 bg-turf/10 py-1 pl-3 pr-1 first:mt-0" role="status">
      <Check aria-hidden="true" className="h-5 w-5 max-w-none shrink-0 text-turf" />
      <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">
        {cupo ? `Cupo ${cupo}: ` : ""}{cortesia ? "Cortesía activada" : "Pago confirmado"}{abierta ? ". ¡A pronosticar!" : ""}
      </p>
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
