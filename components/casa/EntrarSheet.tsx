"use client";

// components/casa/EntrarSheet.tsx — el bloqueo, en el momento correcto.
//
// (2026-09-18) El dueño pidió «un popup o bloqueo tipo paga y sube tu
// comprobante aquí», pero también que los partidos y la info se vean sin pagar.
// Las dos cosas a la vez no existen si el aviso sale al ENTRAR: ahí tapa justo
// lo que se quería mostrar, y la gente lo cierra sin leer.
//
// Entonces el aviso sale DESPUÉS de mirar: cuando alguien que no está inscrito
// toca una casilla para marcar un resultado. Ese es el segundo en que la
// persona ya decidió que quiere jugar, y es el único momento en que un bloqueo
// ayuda en vez de estorbar.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { formatCop } from "@/lib/casa/format";
import { joinFreePolla } from "@/lib/casa/join-free";
import { useToast } from "@/components/ui/Toast";

export function EntrarSheet({ open, onClose, href, entryPriceCop, slug }: {
  open: boolean;
  onClose: () => void;
  href: string;
  entryPriceCop: number;
  /**
   * Entrada gratis (migración 143): con `slug` y precio 0 no hay nada que
   * transferir — el mismo botón inscribe aquí mismo y la persona sigue
   * pronosticando sin cambiar de pantalla.
   */
  slug?: string;
}) {
  const gratis = entryPriceCop === 0 && Boolean(slug);
  const router = useRouter();
  const { showToast } = useToast();
  const [entrando, setEntrando] = useState(false);
  const reduce = useReducedMotion();
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    onClose();
    previousFocus.current?.focus?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="entrar-sheet"
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
            aria-labelledby="entrar-sheet-titulo"
            tabIndex={-1}
            className="lp-card relative w-full max-w-sm bg-bg-card p-5 focus:outline-none"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="entrar-sheet-titulo" className="min-w-0 font-display text-[26px] leading-tight tracking-[0.04em] text-text-primary [overflow-wrap:anywhere]">
                {gratis ? "Únete para guardar tu pronóstico" : "Paga para guardar tu pronóstico"}
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

            <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
              {gratis
                ? <>Entrar es gratis: no tienes que transferir nada ni subir comprobante. Para que este marcador cuente, únete a la polla.</>
                : <>Los partidos los puedes ver sin pagar. Para que este marcador cuente, transfiere {formatCop(entryPriceCop)} y sube el comprobante.</>}
            </p>

            {gratis ? (
              <button
                type="button"
                disabled={entrando}
                onClick={async () => {
                  setEntrando(true);
                  const result = await joinFreePolla(slug!);
                  setEntrando(false);
                  if (!result.ok) { showToast(result.error, "error"); router.refresh(); return; }
                  showToast("Listo, ya estás dentro. Guarda tu pronóstico.", "success");
                  close();
                  router.refresh();
                }}
                className="lp-btn lp-btn-primary mt-5 w-full !px-4"
              >
                {entrando ? "Entrando..." : "Unirme · es gratis"}
              </button>
            ) : (
              <Link href={href} className="lp-btn lp-btn-primary mt-5 w-full !px-4">
                Pagar la entrada · {formatCop(entryPriceCop)}
              </Link>
            )}
            <button type="button" onClick={close} className="lp-btn lp-btn-ghost mt-2 w-full">
              Seguir mirando
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
