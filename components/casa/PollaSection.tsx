import type { ReactNode } from "react";
import { ChevronDown, DoorOpen, History, Ticket } from "lucide-react";

export function PollaSection({ id, title, description, count, kind, defaultOpen = false, compact = false, children }: {
  id: string; title: string; description: string; count: ReactNode;
  kind: "open" | "mine" | "closed"; defaultOpen?: boolean;
  /** Perfil: desplegable bajo (título de sección 20 px, sin subtítulo visible). */
  compact?: boolean;
  children: ReactNode;
}) {
  const Icon = kind === "mine" ? Ticket : kind === "open" ? DoorOpen : History;
  // Cerradas = pollas terminadas: casi negro neutro y más translúcido que el
  // vidrio azul de las otras dos secciones.
  const closed = kind === "closed";
  return <details id={id} open={defaultOpen} data-polla-section={kind} data-my-pollas={kind === "mine" ? "" : undefined} className={`group/polla-section lp-card scroll-mt-20 overflow-hidden ${closed ? "bg-bg-base/45" : ""}`}>
    <summary aria-controls={`${id}-content`} className={`flex cursor-pointer list-none items-center gap-3 px-4 transition-colors ${compact ? "min-h-12 py-2.5" : "min-h-16 py-4"} hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden`}>
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <h2 className={`font-display ${compact ? "text-[20px]" : "text-[22px]"} leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]`}>{title}</h2>
        <p className={compact ? "sr-only" : "mt-1 text-[13px] leading-relaxed text-text-secondary"}>{description}</p>
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-text-secondary" data-my-pollas-count={kind === "mine" ? "" : undefined}>{count}</span>
      <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary transition-transform [[open]>summary>&]:rotate-180" />
    </summary>
    <div id={`${id}-content`} className={`space-y-3 border-t border-border-default p-3 ${closed ? "bg-transparent" : "bg-bg-subtle/60"}`}>{children}</div>
  </details>;
}
