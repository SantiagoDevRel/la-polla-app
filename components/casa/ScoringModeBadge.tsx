import { Crosshair, Flag } from "lucide-react";
import type { CasaScoringMode } from "@/lib/casa/types";

/**
 * Qué hay que acertar en una polla de partidos. Va en las tarjetas y en el
 * detalle para que nadie tenga que abrir Info para saber si juega por
 * ganador (1X2) o por marcador exacto. `null` es 1X2, igual que en PicksBoard.
 */
export function ScoringModeBadge({ mode, className = "" }: { mode: CasaScoringMode | null; className?: string }) {
  const exacto = mode === "marcador";
  const Icon = exacto ? Crosshair : Flag;
  return (
    <span className={`inline-flex max-w-full items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated/90 px-3 py-1 text-[13px] font-semibold leading-snug text-text-primary ${className}`}>
      {/* Nunca en oro: el oro es señal de premio y ya lo usan el pozo, el estado y el CTA. */}
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-text-secondary" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{exacto ? "Acierta marcador exacto" : "Acierta ganador del partido"}</span>
    </span>
  );
}
