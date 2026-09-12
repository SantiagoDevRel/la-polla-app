import type { ReactNode } from "react";
import { ChevronDown, DoorOpen, History, Ticket } from "lucide-react";

export function PollaSection({ id, title, description, count, kind, defaultOpen = false, children }: {
  id: string; title: string; description: string; count: ReactNode;
  kind: "open" | "mine" | "closed"; defaultOpen?: boolean; children: ReactNode;
}) {
  const Icon = kind === "mine" ? Ticket : kind === "open" ? DoorOpen : History;
  return <details id={id} open={defaultOpen} data-polla-section={kind} data-my-pollas={kind === "mine" ? "" : undefined} className="group/polla-section lp-card scroll-mt-20 overflow-hidden">
    <summary aria-controls={`${id}-content`} className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-4 transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[22px] leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{description}</p>
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-text-secondary" data-my-pollas-count={kind === "mine" ? "" : undefined}>{count}</span>
      <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary transition-transform group-open/polla-section:rotate-180" />
    </summary>
    <div id={`${id}-content`} className="space-y-3 border-t border-border-default bg-bg-subtle/60 p-3">{children}</div>
  </details>;
}
