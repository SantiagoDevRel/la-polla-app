// components/worldcup/BracketIntroModal.tsx — Popup de intro de "Road to
// World Cup". Se muestra la PRIMERA vez que el user entra a la bracket
// (flag en localStorage) y explica qué es: las llaves se actualizan cuando
// se confirmen, y por ahora puede mover banderas y predecir cruces sin que
// sumen puntos. Cierra con "Entendido", X o backdrop.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { WorldCupTrophy } from "@/components/icons/WorldCupTrophy";

const SEEN_KEY = "lp_rtwc_intro_seen_v1";

export function BracketIntroModal() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* noop */
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="rtwc-intro"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Road to World Cup"
        >
          <motion.div
            className="lp-card w-full max-w-sm p-5"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-gold/30 bg-gold/10 text-gold">
                <WorldCupTrophy className="h-7 w-7" />
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <h2 className="font-display text-[24px] leading-none tracking-[0.03em] text-text-primary">
              Road to World Cup
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
              Aquí vamos a ir actualizando las llaves a medida que se confirmen los
              cruces. Por ahora puedes <span className="text-text-primary">mover las
              banderas</span> y armar tus posibles caminos hasta la final — es para
              jugar y predecir, <span className="text-gold">no suma puntos para la polla</span>.
            </p>

            <button
              type="button"
              onClick={close}
              className="mt-5 h-12 w-full rounded-full bg-gold font-display text-[15px] tracking-[0.06em] text-bg-base transition-transform active:scale-[0.98]"
            >
              Entendido
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
