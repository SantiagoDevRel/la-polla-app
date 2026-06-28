// components/polla/DoublePointsSurveyModal.tsx — Encuesta in-app "¿Los puntos
// valen el DOBLE desde octavos de final?". Se muestra a los participantes
// pagados de una polla con double_survey_open=true que todavía no votaron
// (estado de /api/double-survey). Muestra una tabla con la escala de puntos
// de ESA polla — HOY vs DOBLE — y registra el voto Sí/No.
//
// Se monta global en app/(app)/layout.tsx; hace su propio fetch y no
// renderiza nada si no hay encuesta para el viewer. Un popup a la vez: el
// endpoint difiere esta encuesta si el usuario tiene pendiente la de goles_v2.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface Tier {
  label: string;
  hoy: number;
  nuevo: number;
}

interface Survey {
  pollaId: string;
  pollaName: string;
  tiers: Tier[];
}

export function DoublePointsSurveyModal() {
  const { showToast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get<{ survey: Survey | null }>(
          "/api/double-survey",
        );
        if (!cancelled && data.survey) {
          setSurvey(data.survey);
          setOpen(true);
        }
      } catch {
        /* sin encuesta visible si falla */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const vote = async (choice: "si" | "no") => {
    if (!survey || submitting) return;
    setSubmitting(true);
    try {
      await axios.post("/api/double-survey/vote", {
        pollaId: survey.pollaId,
        choice,
      });
      setOpen(false);
      showToast(
        choice === "si"
          ? "¡Listo! Votaste por el doble desde octavos 🐥"
          : "Listo, votaste por dejar los puntos como están",
        "success",
      );
    } catch {
      showToast("No pudimos guardar tu voto, intenta de nuevo", "error");
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && survey ? (
        <motion.div
          key="double-survey"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Encuesta de puntos dobles desde octavos"
        >
          <motion.div
            className="lp-card flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden p-0"
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header (sin X: hay que votar Sí o No para cerrar) */}
            <div className="px-5 pt-5">
              <span className="inline-block rounded-full border border-gold/20 bg-gold/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold">
                Encuesta
              </span>
              <h2 className="mt-2 font-display text-[23px] leading-none tracking-[0.03em] text-text-primary">
                ¿Puntos dobles desde octavos?
              </h2>
            </div>

            <div className="overflow-y-auto px-5 pb-2 pt-3">
              <p className="text-sm leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                En{" "}
                <span className="text-text-primary">{survey.pollaName.trim()}</span>{" "}
                se propone que{" "}
                <span className="text-text-primary">
                  desde octavos de final cada acierto valga el doble
                </span>
                . Así se vería tu puntaje:
              </p>

              {/* Tabla de puntos: HOY vs NUEVO (doble) */}
              <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-border-subtle bg-bg-elevated px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                  <span>Si aciertas…</span>
                  <span className="w-10 text-center">Hoy</span>
                  <span className="w-10 text-center text-gold">Nuevo</span>
                </div>
                {survey.tiers.map((t, i) => (
                  <div
                    key={t.label}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3 py-2"
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span className="text-[12.5px] leading-tight text-text-primary [overflow-wrap:anywhere]">
                      {t.label}
                    </span>
                    <span className="w-10 text-center font-display text-[17px] text-text-secondary">
                      {t.hoy}
                    </span>
                    <span
                      className="w-10 text-center font-display text-[17px]"
                      style={{ color: t.nuevo > t.hoy ? "#1FD87F" : "#6B7689" }}
                    >
                      {t.nuevo}
                      {t.nuevo > t.hoy ? (
                        <span className="ml-0.5 align-top text-[9px]">▲</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11.5px] leading-snug text-text-secondary">
                Aplica desde{" "}
                <span className="text-text-primary">octavos de final</span> en
                adelante (octavos, cuartos, semis y final). Los{" "}
                <span className="text-text-primary">dieciseisavos (16vos)</span>{" "}
                y la fase de grupos siguen valiendo igual y{" "}
                <span className="text-text-primary">no es retroactivo</span>: lo
                que ya llevas no se toca.
              </p>
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                Solo cambia si la mayoría vota que sí, y aplica únicamente a esta
                polla — las demás siguen igual.
              </p>
            </div>

            {/* Acciones */}
            <div className="flex flex-col gap-2 px-5 pb-[calc(1.1rem+env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => vote("si")}
                className="h-12 w-full rounded-full bg-gold font-display text-[15px] tracking-[0.06em] text-bg-base transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                Sí, que valga doble
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => vote("no")}
                className="h-11 w-full rounded-full border border-border-subtle font-display text-[14px] tracking-[0.05em] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
              >
                No, déjenlo igual
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default DoublePointsSurveyModal;
