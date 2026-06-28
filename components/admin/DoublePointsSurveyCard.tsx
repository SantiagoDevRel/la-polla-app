// components/admin/DoublePointsSurveyCard.tsx — Resultados de la encuesta
// "puntos dobles desde octavos" en /admin, una fila por polla.
//
// Para cada polla con encuesta abierta (o ya con el doble activo) muestra el
// tally Sí/No/Faltan + un botón "Implementar doble" que activa el x2 desde
// octavos para ESA polla, o "Mantener". Se auto-oculta si no hay ninguna
// encuesta ni polla con el doble activo.
"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface Survey {
  pollaId: string;
  pollaName: string;
  pollaSlug: string;
  doubleActive: boolean;
  surveyOpen: boolean;
  decidedAt: string | null;
  counts: { total: number; si: number; no: number; pending: number };
}

export default function DoublePointsSurveyCard() {
  const { showToast } = useToast();
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<{ surveys: Survey[] }>(
        "/api/admin/double-survey",
      );
      setSurveys(data.surveys ?? []);
    } catch {
      setSurveys([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (s: Survey, action: "apply" | "keep") => {
      const msg =
        action === "apply"
          ? `¿Activar PUNTOS DOBLES desde octavos en "${s.pollaName}"?\n\nLos 16vos y grupos siguen igual. Octavos, cuartos, semis y final pasan a valer x2 en esta polla. Las demás no se afectan.`
          : `¿Cerrar la encuesta y MANTENER los puntos como están en "${s.pollaName}"?`;
      if (!window.confirm(msg)) return;
      setActing(s.pollaId);
      try {
        await axios.post("/api/admin/double-survey", {
          pollaId: s.pollaId,
          action,
        });
        showToast(
          action === "apply"
            ? `"${s.pollaName}" ahora dobla los puntos desde octavos`
            : `Encuesta cerrada en "${s.pollaName}"`,
          "success",
        );
        await load();
      } catch {
        showToast("No se pudo procesar la acción", "error");
      } finally {
        setActing(null);
      }
    },
    [load, showToast],
  );

  if (!loaded || !surveys || surveys.length === 0) return null;

  const openCount = surveys.filter((s) => s.surveyOpen).length;
  const appliedCount = surveys.filter((s) => s.doubleActive).length;

  return (
    <section
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: "rgba(255,215,0,0.06)",
        border: "1px solid rgba(255,215,0,0.25)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <h3 className="font-display text-[18px] tracking-[0.03em] text-text-primary">
            Encuesta · puntos dobles desde octavos
          </h3>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {openCount} {openCount === 1 ? "encuesta abierta" : "encuestas abiertas"}
            {appliedCount > 0 ? ` · ${appliedCount} ya activada(s)` : ""}
          </p>
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <>
          <p className="rounded-xl bg-bg-elevated px-3 py-2 text-[11px] leading-snug text-text-secondary">
            <span className="text-text-primary">Desde octavos x2:</span> &quot;Implementar&quot;
            activa el doble (octavos · cuartos · semis · final) en esa polla. Los
            16vos y grupos siguen igual. Cada polla se decide aparte según sus votos.
          </p>

          <div className="space-y-2.5">
        {surveys.map((s) => {
          const { counts } = s;
          const decided = counts.si + counts.no;
          const majorityYes = counts.si > counts.total / 2;
          const majorityNo = counts.no >= counts.total / 2 && counts.total > 0;
          const applied = s.doubleActive;
          const busy = acting === s.pollaId;
          return (
            <div
              key={s.pollaId}
              className="rounded-xl border border-border-subtle bg-bg-card/60 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-text-primary">
                    {s.pollaName || s.pollaSlug}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {counts.total} {counts.total === 1 ? "jugador" : "jugadores"} ·{" "}
                    {decided} {decided === 1 ? "votó" : "votaron"}
                  </p>
                </div>
                {applied ? (
                  <span className="shrink-0 rounded-full bg-turf/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-turf">
                    Activada
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
                    Abierta
                  </span>
                )}
              </div>

              {/* Tally */}
              <div className="mt-2 flex items-center gap-3 text-[12px]">
                <span className="text-turf">
                  Sí <span className="font-display text-[15px]">{counts.si}</span>
                </span>
                <span className="text-red-alert">
                  No <span className="font-display text-[15px]">{counts.no}</span>
                </span>
                <span className="text-text-muted">
                  Faltan{" "}
                  <span className="font-display text-[15px]">{counts.pending}</span>
                </span>
                {!applied ? (
                  majorityYes ? (
                    <span className="ml-auto text-[11px] text-turf">Mayoría: Sí</span>
                  ) : majorityNo ? (
                    <span className="ml-auto text-[11px] text-text-secondary">
                      Mayoría: No
                    </span>
                  ) : (
                    <span className="ml-auto text-[11px] text-text-muted">
                      Sin mayoría
                    </span>
                  )
                ) : null}
              </div>

              {/* Acciones */}
              {!applied ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(s, "apply")}
                    className="flex-1 rounded-full bg-gold py-2 font-display text-[12.5px] tracking-[0.04em] text-bg-base transition-transform active:scale-[0.98] disabled:opacity-60"
                  >
                    {busy ? "…" : "Implementar doble"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(s, "keep")}
                    className="rounded-full border border-border-subtle px-3 py-2 font-display text-[12.5px] tracking-[0.04em] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
                  >
                    Mantener
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-turf">
                  Dobla desde octavos{" "}
                  {s.decidedAt
                    ? `(activado ${new Date(s.decidedAt).toLocaleDateString("es-CO", {
                        day: "numeric",
                        month: "short",
                      })})`
                    : ""}
                  .
                </p>
              )}
            </div>
          );
        })}
          </div>
        </>
      ) : null}
    </section>
  );
}
