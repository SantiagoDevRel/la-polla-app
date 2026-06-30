// components/admin/KnockoutModeCard.tsx — Flip del modo "120' + avance" por
// polla en /admin (migración 077). Una fila por polla activa del Mundial.
//
// Para cada polla muestra si el modo está activo y un botón para activarlo
// (los knockouts puntúan por el marcador de 120' + bonus +1 por acertar quién
// avanza) o desactivarlo. Top-down, sin encuesta. Se auto-oculta si no hay
// pollas candidatas del Mundial.
"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface PollaMode {
  pollaId: string;
  pollaName: string;
  pollaSlug: string;
  score120: boolean;
  advanceBonus: boolean;
  modeActive: boolean;
  changedAt: string | null;
  advanceFrom: string | null;
  paid: number;
}

export default function KnockoutModeCard() {
  const { showToast } = useToast();
  const [pollas, setPollas] = useState<PollaMode[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<{ pollas: PollaMode[] }>(
        "/api/admin/knockout-mode",
      );
      setPollas(data.pollas ?? []);
    } catch {
      setPollas([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = useCallback(
    async (p: PollaMode, action: "enable" | "disable") => {
      const msg =
        action === "enable"
          ? `¿Activar MODO 120' + AVANCE en "${p.pollaName}"?\n\nDesde ahora (no retroactivo), los knockouts (16vos en adelante) de esta polla puntúan con el marcador de los 120 minutos (alargue incluido), y se suma +1 por acertar quién avanza. Las demás pollas no se afectan.`
          : `¿Desactivar el modo 120' + avance en "${p.pollaName}"? Los knockouts vuelven a puntuar por los 90 minutos y se quita el bonus de avance.`;
      if (!window.confirm(msg)) return;
      setActing(p.pollaId);
      try {
        await axios.post("/api/admin/knockout-mode", {
          pollaId: p.pollaId,
          action,
        });
        showToast(
          action === "enable"
            ? `"${p.pollaName}" ahora puntúa por 120' + avance`
            : `Modo 120' + avance desactivado en "${p.pollaName}"`,
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

  if (!loaded || !pollas || pollas.length === 0) return null;

  const activeCount = pollas.filter((p) => p.modeActive).length;

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
            Modo 120&apos; + avance
          </h3>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {activeCount > 0
              ? `${activeCount} polla(s) con el modo activo`
              : "Ninguna polla con el modo activo"}
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
            <span className="text-text-primary">120&apos; + avance:</span> los knockouts
            (16vos en adelante) puntúan con el marcador de los 120 minutos (alargue
            incluido) y +1 plano por acertar quién avanza. No retroactivo (cuenta
            desde que lo activás). Cada polla se decide aparte.
          </p>

          <div className="space-y-2.5">
            {pollas.map((p) => {
              const busy = acting === p.pollaId;
              return (
                <div
                  key={p.pollaId}
                  className="rounded-xl border border-border-subtle bg-bg-card/60 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-text-primary">
                        {p.pollaName || p.pollaSlug}
                      </p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        {p.paid} {p.paid === 1 ? "pagado" : "pagados"}
                      </p>
                    </div>
                    {p.modeActive ? (
                      <span className="shrink-0 rounded-full bg-turf/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-turf">
                        Activo
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Inactivo
                      </span>
                    )}
                  </div>

                  {p.modeActive ? (
                    <div className="mt-3 flex items-center gap-2">
                      <p className="flex-1 text-[11px] text-turf">
                        120&apos; desde{" "}
                        {p.changedAt
                          ? new Date(p.changedAt).toLocaleDateString("es-CO", {
                              day: "numeric",
                              month: "short",
                            })
                          : "?"}
                        {p.advanceFrom
                          ? ` · avance desde ${new Date(p.advanceFrom).toLocaleDateString("es-CO", {
                              day: "numeric",
                              month: "short",
                            })}`
                          : ""}
                        .
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => flip(p, "disable")}
                        className="shrink-0 rounded-full border border-border-subtle px-3 py-2 font-display text-[12.5px] tracking-[0.04em] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
                      >
                        {busy ? "…" : "Desactivar"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => flip(p, "enable")}
                        className="flex-1 rounded-full bg-gold py-2 font-display text-[12.5px] tracking-[0.04em] text-bg-base transition-transform active:scale-[0.98] disabled:opacity-60"
                      >
                        {busy ? "…" : "Activar 120' + avance"}
                      </button>
                    </div>
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
