"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * (2026-10-13, pedido del dueño) Una lista con scroll propio dentro de su
 * tarjeta, para que el historial de Terminadas no alargue Inicio. Mismo alto
 * que las jugadas del partido (55dvh, máximo 28rem).
 *
 * Las tarjetas miden lo mismo, así que el corte puede caer justo entre dos y
 * esconder que hay más: mientras quede contenido abajo, un degradado lo avisa.
 */
export function ScrollableList({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Cubre el desplegable que se abre (alto 0 → visible) y el texto ampliado.
    const resize = new ResizeObserver(update);
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div ref={ref} role="region" aria-label={label} tabIndex={0} data-scrollable-list
        className="max-h-[min(55dvh,28rem)] overflow-y-auto overscroll-y-contain rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
        {children}
      </div>
      {more && <div aria-hidden="true" data-scrollable-list-more
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-lg bg-gradient-to-t from-bg-base to-transparent" />}
    </div>
  );
}
