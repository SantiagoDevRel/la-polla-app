import type { ReactNode } from "react";
import { ChevronDown, DoorOpen, History, Ticket } from "lucide-react";

/**
 * Una sección de pollas del inicio o del perfil.
 *
 * (2026-09-18, pedido del dueño) En el inicio, «Mis pollas» y «Para entrar» son
 * `flat`: las tarjetas salen de una, sin desplegable que abrir ni subtítulo que
 * leer. Antes cada sección era un acordeón con título + frase + contador +
 * flecha, y había que abrir una carpeta para llegar a la polla. Lo que distingue
 * una sección de otra ya no es la frase sino la forma: las mías llevan el filo
 * verde, las que se pueden entrar traen el botón con el precio, y las terminadas
 * van grises, con su fecha, plegadas al fondo.
 *
 * El desplegable se conserva para las terminadas (son historial) y para Perfil.
 */
export function PollaSection({ id, title, description, count, kind, defaultOpen = false, compact = false, flat = false, children }: {
  id: string; title: string;
  /** Solo para lectores de pantalla: a la vista no va ninguna frase. */
  description?: string;
  count: ReactNode;
  kind: "open" | "mine" | "closed"; defaultOpen?: boolean;
  /** Perfil: desplegable bajo (título de sección 20 px). */
  compact?: boolean;
  /** Inicio: sin desplegable; el título es una etiqueta y las tarjetas van debajo. */
  flat?: boolean;
  children: ReactNode;
}) {
  const Icon = kind === "mine" ? Ticket : kind === "open" ? DoorOpen : History;
  const iconTone = kind === "mine" ? "text-turf" : kind === "open" ? "text-text-primary" : "text-text-secondary";

  if (flat) return <section id={id} aria-labelledby={`${id}-title`} data-polla-section={kind} data-my-pollas={kind === "mine" ? "" : undefined} className="scroll-mt-20">
    <div className="mb-2 flex items-center gap-2 px-1">
      <Icon aria-hidden="true" className={`h-5 w-5 max-w-none shrink-0 ${iconTone}`} />
      <h2 id={`${id}-title`} className="min-w-0 font-display text-[22px] leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]">{title}</h2>
      <span className="text-[13px] font-semibold tabular-nums text-text-secondary" data-my-pollas-count={kind === "mine" ? "" : undefined}>{count}</span>
      {description && <span className="sr-only">{description}</span>}
    </div>
    <div className="space-y-3">{children}</div>
  </section>;

  // Cerradas = pollas terminadas: casi negro neutro y más translúcido que el
  // vidrio azul de las otras dos secciones.
  const closed = kind === "closed";
  return <details id={id} open={defaultOpen} data-polla-section={kind} data-my-pollas={kind === "mine" ? "" : undefined} className={`group/polla-section lp-card scroll-mt-20 overflow-hidden ${closed ? "bg-bg-base/45" : ""}`}>
    <summary aria-controls={`${id}-content`} className={`flex cursor-pointer list-none items-center gap-3 px-4 transition-colors ${compact ? "min-h-12 py-2.5" : "min-h-14 py-3"} hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden`}>
      <Icon aria-hidden="true" className={`h-5 w-5 max-w-none shrink-0 ${iconTone}`} />
      <div className="min-w-0 flex-1">
        <h2 className={`font-display ${compact ? "text-[20px]" : "text-[22px]"} leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]`}>{title}</h2>
        {description && <p className="sr-only">{description}</p>}
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-text-secondary" data-my-pollas-count={kind === "mine" ? "" : undefined}>{count}</span>
      <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary transition-transform [[open]>summary>&]:rotate-180" />
    </summary>
    <div id={`${id}-content`} className={`space-y-3 border-t border-border-default p-3 ${closed ? "bg-transparent" : "bg-bg-subtle/60"}`}>{children}</div>
  </details>;
}
