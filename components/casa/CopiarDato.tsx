"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Botón para copiar un dato de pago (número de Nequi o de cuenta).
 *
 * (2026-09-13) Pedido del dueño: en «Transfiere a» había que seleccionar el
 * número a mano para pegarlo en la app del banco. Copia solo los dígitos del
 * número, que es lo que aceptan Nequi y Bancolombia, y confirma en pantalla y
 * para lectores de pantalla.
 */
export function CopiarDato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copiar() {
    const limpio = valor.replace(/[\s.-]/g, "");
    try {
      await navigator.clipboard.writeText(limpio);
    } catch {
      // Sin permiso de portapapeles (http o navegador viejo): se selecciona para copiar a mano.
      const nodo = document.getElementById(`copiar-${etiqueta}`);
      if (nodo) {
        const rango = document.createRange();
        rango.selectNodeContents(nodo);
        const seleccion = window.getSelection();
        seleccion?.removeAllRanges();
        seleccion?.addRange(rango);
      }
      return;
    }
    setCopiado(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiado(false), 2200);
  }

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={`Copiar ${etiqueta}`}
      className="lp-btn lp-btn-ghost min-h-11 shrink-0 gap-2 !px-4 text-[15px]"
    >
      {copiado ? <Check aria-hidden="true" className="h-4 w-4 text-turf" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
      <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
    </button>
  );
}
