import { Crosshair, Flag, ListChecks, Ticket } from "lucide-react";
import type { CasaPollaKind, CasaScoringMode } from "@/lib/casa/types";

/**
 * Qué hay que acertar en una polla de partidos. Va en las tarjetas y en el
 * detalle para que nadie tenga que abrir Info para saber si juega por
 * ganador (1X2) o por marcador exacto. `null` es 1X2, igual que en PicksBoard.
 *
 * (2026-09-19) Con `kind`, las pollas de preguntas y las rifas también dicen
 * cómo se juegan: en el inicio todas las tarjetas llevan esta línea, para que
 * ninguna quede más baja que las demás.
 */
export function ScoringModeBadge({ mode, kind = "partidos", className = "" }: { mode: CasaScoringMode | null; kind?: CasaPollaKind; className?: string }) {
  const exacto = mode === "marcador";
  const Icon = kind === "rifa" ? Ticket : kind === "manual" ? ListChecks : exacto ? Crosshair : Flag;
  const texto = kind === "rifa" ? "Gana el número sorteado"
    : kind === "manual" ? "Acierta las preguntas"
    : exacto ? "Acierta marcador exacto" : "Acierta ganador del partido";
  return (
    <span className={`inline-flex max-w-full items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated/90 px-3 py-1 text-[13px] font-semibold leading-snug text-text-primary ${className}`}>
      {/* Nunca en oro: el oro es señal de premio y ya lo usan el pozo, el estado y el CTA. */}
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-text-secondary" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{texto}</span>
    </span>
  );
}
