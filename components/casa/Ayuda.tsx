"use client";

// components/casa/Ayuda.tsx — la (i) que explica algo sin ocupar la pantalla.
//
// (2026-09-18, pedido del dueño) En «Tus cupos» la explicación vivía como un
// párrafo de cuatro líneas siempre visible, y partirla en tarjetas dejaba la
// pantalla sobrepoblada. Ahora es un ícono de información al lado del título:
// quien ya entendió cómo funciona no ve nada, y quien no, toca y lee.
//
// Es un aviso, no una tarea: acá adentro solo va explicación. Lo que hace
// avanzar —pagar, cuántos pronósticos faltan, por qué rechazaron un pago—
// se queda afuera, a la vista.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Info, X } from "lucide-react";

export function Ayuda({ titulo, etiqueta, children }: {
  titulo: string;
  /** Qué explica, para lectores de pantalla: «Cómo funcionan los cupos». */
  etiqueta?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const close = useCallback(() => {
    setOpen(false);
    previousFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      // El foco no sale del aviso mientras está abierto.
      const items = [...dialog.current.querySelectorAll<HTMLElement>("button, a[href]")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = items.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (!inside || document.activeElement === last)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={etiqueta ?? titulo}
        className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <Info aria-hidden="true" className="h-5 w-5" />
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              key="ayuda"
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 px-4 pb-4 pt-10 backdrop-blur-sm sm:items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            >
              <motion.div
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ayuda-titulo"
                tabIndex={-1}
                className="lp-card relative max-h-full w-full max-w-sm overflow-y-auto bg-bg-card p-5 focus:outline-none"
                style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
                initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0, scale: 0.97 }}
                animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 id="ayuda-titulo" className="min-w-0 font-display text-[26px] leading-tight tracking-[0.04em] text-text-primary [overflow-wrap:anywhere]">
                    {titulo}
                  </h2>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Cerrar"
                    className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    <X aria-hidden="true" className="h-5 w-5" />
                  </button>
                </div>

                <ul className="mt-4 list-disc space-y-2.5 pl-5 text-[15px] leading-relaxed text-text-secondary marker:text-text-muted [overflow-wrap:anywhere]">
                  {children}
                </ul>

                <button type="button" onClick={close} className="lp-btn lp-btn-ghost mt-5 w-full">
                  Entendido
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
