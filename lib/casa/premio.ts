// lib/casa/premio.ts — qué se lleva el ganador, en una etiqueta y un valor.
//
// (2026-09-18) Pedido del dueño: la etiqueta dice «Premio», no «Pozo», y cuando
// el premio es un objeto el valor es el objeto, no una cifra. POLLA REGALO
// entrega dos boletas y las tarjetas mostraban «POZO $0»: una polla que regala
// entradas parecía no repartir nada.
//
// Vive acá, sin React, porque lo usan el inicio, «Mis pollas», el detalle de la
// polla y el bot de Telegram. Una sola verdad sobre cómo se nombra el premio.

import { formatCop } from "./format";

/** Cabecera de la cifra o del objeto. En inglés, en chickenpicks.app. */
export function premioLabel(english = false): string {
  return english ? "Prize" : "Premio";
}

type PremioFuente = {
  prize_kind?: string | null;
  prize_object?: string | null;
  /** Pozo vivo en pesos; `undefined` cuando no se pudo leer. */
  prize_cop?: number | null;
};

/**
 * Lo que se muestra debajo de «Premio»: el objeto si el premio es un objeto, y
 * si no, el pozo en pesos. `null` cuando no hay dato — la tarjeta omite la fila
 * en vez de mentir con un cero.
 */
export function premioValor(polla: PremioFuente): string | null {
  if (polla.prize_kind === "objeto") {
    const objeto = (polla.prize_object ?? "").trim();
    return objeto.length > 0 ? objeto : null;
  }
  return typeof polla.prize_cop === "number" ? formatCop(polla.prize_cop) : null;
}
