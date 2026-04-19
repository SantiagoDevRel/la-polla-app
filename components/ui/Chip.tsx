// components/ui/Chip.tsx — Tribuna Caliente §3.2
"use client";

import { cn } from "@/lib/cn";

type ChipVariant = "live" | "locks" | "leader" | "final" | "wrong";

export interface ChipProps {
  variant: ChipVariant;
  label: string;
  withPulse?: boolean;
  className?: string;
}

const VARIANT: Record<
  ChipVariant,
  { wrap: string; dot: string; defaultPulse: boolean }
> = {
  live: {
    wrap: "bg-turf/10 text-turf border-turf/25",
    dot: "bg-turf",
    defaultPulse: true,
  },
  locks: {
    wrap: "bg-amber/10 text-amber border-amber/25",
    dot: "bg-amber",
    defaultPulse: true,
  },
  leader: {
    wrap: "bg-gold/10 text-gold border-gold/30",
    dot: "bg-gold",
    defaultPulse: false,
  },
  final: {
    wrap: "bg-bg-elevated text-text-muted border-border-subtle",
    dot: "bg-text-muted",
    defaultPulse: false,
  },
  wrong: {
    wrap: "bg-red-alert/10 text-red-alert border-red-alert/25",
    dot: "bg-red-alert",
    defaultPulse: false,
  },
};

export function Chip({ variant, label, withPulse, className }: ChipProps) {
  const v = VARIANT[variant];
  const showPulse = withPulse ?? v.defaultPulse;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-display uppercase",
        "text-[11px] leading-none tracking-[0.06em]",
        v.wrap,
        className,
      )}
    >
      {showPulse ? (
        <span aria-hidden="true" className="relative inline-block w-1.5 h-1.5">
          <span
            className={cn(
              "absolute inset-0 rounded-full opacity-60 animate-ping",
              v.dot,
            )}
          />
          <span className={cn("absolute inset-0 rounded-full", v.dot)} />
        </span>
      ) : null}
      <span>{label}</span>
    </span>
  );
}

export default Chip;
