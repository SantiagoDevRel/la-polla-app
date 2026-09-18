"use client";

// components/casa/PromoInvitados.tsx — aviso de invitaciones al entrar (2026-09-17).
//
// Pedido del dueño: un aviso para todos los que entren, «Por 5 invitados, te
// damos un cupo en la OFIGOLAZO», sencillo y llamativo, con el código a mano
// para copiar. Sale una vez por persona y polla en cada dispositivo; se cierra
// con la X, Escape o tocando afuera. No aparece en la app de iOS (como el resto
// de las invitaciones). Qué polla y qué código: referralPromo(), en el servidor.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gift, X } from "lucide-react";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { REFERRAL_FINE_PRINT, type ReferralPromo } from "@/lib/casa/referrals-shared";
import { CompartirPolla } from "./CompartirPolla";
import { CopiarDato } from "./CopiarDato";

const seenKey = (pollaId: string) => `lp_promo_invitados:${pollaId}`;

export function PromoInvitados({ promo, verPolla = false }: {
  promo: ReferralPromo;
  /** En el inicio de Casa: enlace a la polla. Dentro de la polla sobra. */
  verPolla?: boolean;
}) {
  const isIOSApp = useIsIOSApp();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    if (isIOSApp) return;
    try {
      if (localStorage.getItem(seenKey(promo.pollaId)) === "1") return;
    } catch {
      // Sin almacenamiento (modo privado): se muestra en esta visita.
    }
    // Después del primer pintado, para no competir con la carga de la pantalla.
    const timer = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [isIOSApp, promo.pollaId]);

  const close = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(seenKey(promo.pollaId), "1"); } catch { /* Vuelve a salir en la próxima visita. */ }
    previousFocus.current?.focus?.();
  }, [promo.pollaId]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    // El foco entra al aviso (lectores de pantalla) sin pintar el anillo en la X.
    dialog.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      // El foco no sale del aviso mientras está abierto.
      const items = [...dialog.current.querySelectorAll<HTMLElement>("button, a[href]")];
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

  // El portal va solo después de hidratar: el servidor no pinta nada aquí.
  if (isIOSApp || !mounted) return null;
  const cada = promo.every === 1 ? "Por cada invitado" : `Por ${promo.every} invitados`;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="promo-invitados"
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
            aria-labelledby="promo-invitados-titulo"
            tabIndex={-1}
            className="lp-card-hero relative max-h-full w-full max-w-sm overflow-y-auto p-5 focus:outline-none"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-turf/40 bg-turf/15 text-turf">
                <Gift aria-hidden="true" className="h-6 w-6" />
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <h2 id="promo-invitados-titulo" className="mt-3 font-display text-[32px] leading-[1.05] tracking-[0.03em] text-text-primary [overflow-wrap:anywhere]">
              {cada}, te damos un cupo en la <span className="text-gold">{promo.name}</span>
            </h2>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-dashed border-border-strong px-3 py-2.5">
              <div className="min-w-0">
                <span className="lp-label">Tu código</span>
                <span id="copiar-codigo-promo" className="lp-money mt-1 block select-all text-[28px] leading-none text-text-primary [overflow-wrap:anywhere]">
                  {promo.code}
                </span>
              </div>
              <CopiarDato valor={promo.code} etiqueta="codigo-promo" nombre="tu código" />
            </div>

            <CompartirPolla
              slug={promo.slug}
              nombre={promo.name}
              entradaCop={promo.entryPriceCop}
              premio={promo.premio}
              codigo={promo.code}
              variant="primary"
              className="mt-3 w-full"
            />
            {verPolla && (
              <Link href={`/polla/${promo.slug}`} onClick={close} className="lp-btn lp-btn-ghost mt-2 w-full !px-4">
                Ver la polla
              </Link>
            )}
            <p className="mt-3 text-[13px] italic text-text-muted">{REFERRAL_FINE_PRINT}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
