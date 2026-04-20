// components/polla/ScoringExplanation.tsx — Modal que explica el sistema de puntaje
"use client";

import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";

const TIERS = [
  {
    points: 5,
    label: "Resultado exacto",
    pred: "2-1",
    result: "2-1",
    desc: "Adivinaste el marcador perfecto",
    color: "text-gold",
    bg: "bg-gold/10 border-gold/20",
  },
  {
    points: 3,
    label: "Ganador + diferencia de gol",
    pred: "3-2",
    result: "2-1",
    desc: "Acertaste quien gana y la diferencia de goles es la misma",
    color: "text-green-live",
    bg: "bg-green-live/10 border-green-live/20",
  },
  {
    points: 2,
    label: "Ganador correcto",
    pred: "3-0",
    result: "2-1",
    desc: "Acertaste quien gana pero la diferencia de goles es diferente",
    color: "text-blue-info",
    bg: "bg-blue-info/10 border-blue-info/20",
  },
  {
    points: 1,
    label: "Acertar goles de un equipo",
    pred: "2-3",
    result: "2-1",
    desc: "Adivinaste los goles de al menos un equipo",
    color: "text-text-secondary",
    bg: "bg-bg-elevated border-border-subtle",
  },
  {
    points: 0,
    label: "Nada",
    pred: "0-0",
    result: "2-1",
    desc: "No acertaste nada",
    color: "text-text-muted",
    bg: "bg-bg-card border-border-subtle",
  },
];

export default function ScoringExplanation() {
  const [open, setOpen] = useState(false);

  // Lock body scroll mientras el card está abierto. overscroll-contain en el
  // contenedor interno ya corta el scroll chaining en navegadores modernos;
  // este toggle sobre document.body es el respaldo para móviles más viejos.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-gold transition-colors cursor-pointer"
      >
        <HelpCircle className="w-4 h-4" />
        Como se puntua?
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-bg-base/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-bg-card border border-border-subtle max-h-[85vh] overflow-y-auto overscroll-contain">
            <div className="sticky top-0 flex items-center justify-between p-4 bg-bg-card border-b border-border-subtle">
              <h2 className="font-display text-xl text-gold tracking-wide">Sistema de Puntaje</h2>
              <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {TIERS.map((tier) => (
                <div key={tier.points} className={`rounded-xl p-3 border ${tier.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-bold text-sm ${tier.color}`}>{tier.label}</span>
                    <span className={`font-display text-lg tabular-nums ${tier.color}`}>{tier.points} pts</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs mb-1.5">
                    <span className="text-text-muted">Tu pronostico: <strong className="text-text-primary">{tier.pred}</strong></span>
                    <span className="text-text-muted">Resultado: <strong className="text-text-primary">{tier.result}</strong></span>
                  </div>
                  <p className="text-xs text-text-secondary">{tier.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
