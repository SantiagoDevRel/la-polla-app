// components/polla/ScoringSurveyModal.tsx — Encuesta in-app de sistema de
// puntos. Se muestra a los participantes pagados de una polla con
// scoring_survey_open=true que todavía no votaron (estado de
// /api/scoring-survey). Explica el puntaje de HOY vs la PROPUESTA con
// ejemplos de marcadores y registra el voto Sí/No.
//
// Se monta global en app/(app)/layout.tsx; hace su propio fetch y no
// renderiza nada si no hay encuesta para el viewer. "Lo veo después" cierra
// por la sesión (sessionStorage) pero vuelve a aparecer en la próxima
// sesión hasta que el usuario vote.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight } from "lucide-react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface Survey {
  pollaId: string;
  pollaName: string;
}

const SNOOZE_KEY = "lp_scoring_survey_snoozed_v1";

// Filas de comparación HOY vs PROPUESTA. `up` marca los tiers que suben.
const ROWS: { label: string; hoy: number; nuevo: number; up?: boolean }[] = [
  { label: "Marcador exacto", hoy: 5, nuevo: 5 },
  { label: "Ganador + diferencia de gol", hoy: 3, nuevo: 4, up: true },
  { label: "Ganador + un gol de algún equipo", hoy: 2, nuevo: 3, up: true },
  { label: "Ganador solo", hoy: 2, nuevo: 2 },
  { label: "Un gol de algún equipo (sin el ganador)", hoy: 1, nuevo: 1 },
  { label: "Nada", hoy: 0, nuevo: 0 },
];

// Ejemplos que ilustran por qué el nuevo premia acercarse más.
const EXAMPLES: { pred: string; result: string; hoy: number; nuevo: number; why: string }[] = [
  { pred: "2-0", result: "3-1", hoy: 3, nuevo: 4, why: "Le pegaste al ganador y a la diferencia" },
  { pred: "2-0", result: "2-1", hoy: 2, nuevo: 3, why: "Ganador + le acertaste los goles del local" },
];

export function ScoringSurveyModal() {
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
        if (sessionStorage.getItem(SNOOZE_KEY)) return;
      } catch {
        /* noop */
      }
      try {
        const { data } = await axios.get<{ survey: Survey | null }>(
          "/api/scoring-survey",
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

  const snooze = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {
      /* noop */
    }
  };

  const vote = async (choice: "si" | "no") => {
    if (!survey || submitting) return;
    setSubmitting(true);
    try {
      await axios.post("/api/scoring-survey/vote", {
        pollaId: survey.pollaId,
        choice,
      });
      setOpen(false);
      showToast(
        choice === "si"
          ? "¡Listo! Votaste por el nuevo sistema 🐥"
          : "Listo, votaste por dejarlo como está",
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
          key="scoring-survey"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={snooze}
          role="dialog"
          aria-modal="true"
          aria-label="Encuesta de sistema de puntos"
        >
          <motion.div
            className="lp-card flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden p-0"
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <div>
                <span className="inline-block rounded-full border border-gold/20 bg-gold/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold">
                  Encuesta
                </span>
                <h2 className="mt-2 font-display text-[23px] leading-none tracking-[0.03em] text-text-primary">
                  ¿Cambiamos el puntaje?
                </h2>
              </div>
              <button
                type="button"
                onClick={snooze}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 pb-2 pt-3">
              <p className="text-sm leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                En{" "}
                <span className="text-text-primary">{survey.pollaName.trim()}</span>{" "}
                se propone un sistema de puntos que premia más{" "}
                <span className="text-text-primary">acercarte al marcador</span>.
                Mira cómo cambiaría y vota.
              </p>

              {/* Tabla comparativa */}
              <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-border-subtle bg-bg-elevated px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                  <span>Acertaste</span>
                  <span className="w-9 text-center">Hoy</span>
                  <span className="w-9 text-center text-gold">Nuevo</span>
                </div>
                {ROWS.map((r, i) => (
                  <div
                    key={r.label}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3 py-2"
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span className="text-[12.5px] leading-tight text-text-primary [overflow-wrap:anywhere]">
                      {r.label}
                    </span>
                    <span className="w-9 text-center font-display text-[17px] text-text-secondary">
                      {r.hoy}
                    </span>
                    <span
                      className="w-9 text-center font-display text-[17px]"
                      style={{ color: r.up ? "#1FD87F" : "#f0f4ff" }}
                    >
                      {r.nuevo}
                      {r.up ? (
                        <span className="ml-0.5 align-top text-[9px]">▲</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>

              {/* Ejemplos */}
              <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                Ejemplos
              </p>
              <div className="space-y-2">
                {EXAMPLES.map((ex) => (
                  <div
                    key={ex.pred + ex.result}
                    className="rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-display text-[18px] tracking-[0.04em] text-text-primary">
                        {ex.pred}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                      <span className="font-display text-[18px] tracking-[0.04em] text-text-primary">
                        {ex.result}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5 text-[12px]">
                        <span className="text-text-secondary">{ex.hoy}</span>
                        <ArrowRight className="h-3 w-3 text-text-muted" aria-hidden="true" />
                        <span className="font-display text-[16px] text-turf">{ex.nuevo}</span>
                        <span className="text-text-muted">pts</span>
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-text-muted">
                      {ex.why}
                    </p>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11px] leading-snug text-text-muted">
                Solo cambia si la mayoría vota que sí. Aplica únicamente a esta
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
                Me gusta, cámbienlo
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => vote("no")}
                className="h-11 w-full rounded-full border border-border-subtle font-display text-[14px] tracking-[0.05em] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
              >
                No, déjenlo así
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={snooze}
                className="mt-0.5 h-8 w-full text-[12px] text-text-muted transition-colors hover:text-text-secondary disabled:opacity-60"
              >
                Lo veo después
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default ScoringSurveyModal;
