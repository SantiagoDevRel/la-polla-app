// components/polla/PendingPhasesCard.tsx — Muestra las fases del
// torneo que aún no tienen fixtures publicados. Solo aplica a pollas
// scope='full'/'knockouts'/etc — no a 'custom'.
//
// Sirve para que el user vea el tamaño completo del torneo desde el
// día 1 (ej. "Octavos · 8 partidos · ~marzo 2026") aunque el feed
// externo no haya publicado los matchups todavía. Apenas ESPN/football-
// data publican, el contador decrementa solo y los matches reales
// aparecen en la sección normal.
"use client";

import { Calendar, Hourglass } from "lucide-react";
import type { PendingPhase } from "@/lib/tournaments/structure";

interface Props {
  pending: PendingPhase[];
}

function formatEstimatedDate(iso: string | null): string {
  if (!iso) return "Fecha por confirmar";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Fecha por confirmar";
  return d.toLocaleDateString("es-CO", { month: "long", day: "numeric", year: "numeric" });
}

export default function PendingPhasesCard({ pending }: Props) {
  if (pending.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 lp-card border border-border-subtle space-y-3">
      <div className="flex items-center gap-2">
        <Hourglass className="w-4 h-4 text-text-secondary" />
        <h3 className="font-display text-[14px] tracking-[0.06em] text-text-secondary uppercase">
          Por confirmar
        </h3>
      </div>
      <p className="text-[11px] text-text-muted">
        El feed del torneo aún no publicó estos partidos. Aparecerán acá
        automáticamente cuando se conozcan los matchups y fechas.
      </p>
      <ul className="space-y-1.5">
        {pending.map((p) => (
          <li
            key={p.phase}
            className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 bg-bg-elevated/60 border border-border-subtle/60"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span className="text-[12px] font-medium text-text-primary/85 truncate">
                {p.label}
              </span>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-text-secondary tabular-nums">
                {p.pending} partido{p.pending !== 1 ? "s" : ""}
                {p.confirmed > 0 ? ` · ${p.confirmed} ya publicado${p.confirmed !== 1 ? "s" : ""}` : ""}
              </p>
              <p className="text-[10px] text-text-muted">~{formatEstimatedDate(p.estimatedDate)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
