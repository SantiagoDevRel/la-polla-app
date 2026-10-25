"use client";

// components/casa/CortesiaRegalo.tsx — «La Polla te regaló un cupo», obligatorio.
//
// (2026-10-25, migración 173) Pedido del dueño: quien recibía cortesías desde el
// panel no sabía dónde estaban. Ahora, al abrir la app, ve este aviso encima de
// todo y no se cierra hasta aceptar: no tiene X, Escape no hace nada y al
// recargar vuelve, porque lo pinta el layout desde SQL mientras haya cortesías
// sin aceptar. Un toque y queda dentro, en el cupo nuevo.
//
// Nunca atrapa a nadie: si la polla cerró o la cortesía ya no existe, el
// servidor lo dice, se avisa y el aviso desaparece.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Gift } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CASA_HEADERS } from "@/lib/casa/contract";
import type { PendingCourtesy } from "@/lib/casa/courtesies-shared";

export function CortesiaRegalo({ pendientes }: { pendientes: PendingCourtesy[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  // Las que ya se resolvieron en esta pantalla, mientras el layout se refresca.
  const [resueltas, setResueltas] = useState<string[]>([]);
  const [aceptando, setAceptando] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);

  const actual = pendientes.find((p) => !resueltas.includes(p.pollaId)) ?? null;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!actual) return;
    boton.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    // Escape no cierra y el foco no sale del aviso: hay que aceptar.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        boton.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [actual]);

  async function aceptar() {
    if (!actual) return;
    setAceptando(true);
    try {
      const response = await fetch("/api/casa/cortesias/aceptar", {
        method: "POST", headers: CASA_HEADERS, body: JSON.stringify({ pollaId: actual.pollaId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        // 409: la cortesía venció o ya no existe. No se puede aceptar, así que
        // el aviso se va. Otro error: se queda para intentar otra vez.
        if (response.status === 409) setResueltas((r) => [...r, actual.pollaId]);
        showToast(data.error ?? "No pudimos aceptar la cortesía. Intenta de nuevo.", "error");
        router.refresh();
        return;
      }
      // Sin toast: la polla ya lo dice con «Cortesía activada. ¡A pronosticar!».
      setResueltas((r) => [...r, actual.pollaId]);
      const cupo = typeof data.entryNumber === "number" ? `?p=${data.entryNumber}` : "";
      router.push(`/polla/${encodeURIComponent(actual.slug)}${cupo}`);
      router.refresh();
    } catch {
      showToast("Se cayó la conexión. Intenta otra vez.", "error");
    } finally {
      setAceptando(false);
    }
  }

  if (!mounted || !actual) return null;
  const titulo = actual.pending === 1 ? "un cupo gratis" : `${actual.pending} cupos gratis`;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 px-4 pb-4 pt-10 backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cortesia-regalo-titulo"
        aria-describedby="cortesia-regalo-polla"
        className="lp-card-hero relative max-h-full w-full max-w-sm overflow-y-auto p-5 text-center"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0, scale: 0.97 }}
        animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-turf/40 bg-turf/15 text-turf">
          <Gift aria-hidden="true" className="h-7 w-7" />
        </span>
        <h2 id="cortesia-regalo-titulo" className="mt-3 font-display text-[32px] leading-[1.05] tracking-[0.03em] text-text-primary [overflow-wrap:anywhere]">
          La Polla te regaló <span className="text-gold">{titulo}</span>
        </h2>
        <p id="cortesia-regalo-polla" className="mt-2 text-[17px] font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">
          {actual.polla}
        </p>
        <button
          ref={boton}
          type="button"
          onClick={aceptar}
          disabled={aceptando}
          className="lp-btn lp-btn-primary mt-5 w-full"
        >
          {aceptando ? "Aceptando..." : "Aceptar y jugar"}
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export default CortesiaRegalo;
