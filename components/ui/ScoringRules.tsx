// components/ui/ScoringRules.tsx — Tribuna Caliente §3.10
"use client";

import { Target, ArrowUpDown, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ScoringRulesProps {
  compact?: boolean;
}

const ROWS = [
  {
    Icon: Target,
    label: "Marcador exacto",
    points: "5 PTS",
    color: "text-gold",
    iconBoxColor: "text-gold",
    alwaysShow: true,
  },
  {
    Icon: ArrowUpDown,
    label: "Ganador + diferencia",
    points: "3 PTS",
    color: "text-text-primary",
    iconBoxColor: "text-text-primary",
    alwaysShow: true,
  },
  {
    Icon: Check,
    label: "Ganador correcto",
    points: "2 PTS",
    color: "text-text-primary",
    iconBoxColor: "text-text-primary",
    alwaysShow: true,
  },
  {
    Icon: null, // custom "1" box
    label: "Goles de un equipo",
    points: "1 PT",
    color: "text-text-secondary",
    iconBoxColor: "text-text-secondary",
    alwaysShow: false,
  },
  {
    Icon: XCircle,
    label: "Sin aciertos",
    points: "0 PTS",
    color: "text-text-muted",
    iconBoxColor: "text-text-muted",
    alwaysShow: false,
  },
] as const;

export function ScoringRules({ compact = false }: ScoringRulesProps) {
  const rows = compact ? ROWS.filter((r) => r.alwaysShow) : ROWS;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const { Icon } = row;
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 lp-card",
              row.color,
            )}
          >
            <span
              className={cn(
                "inline-flex items-center justify-center w-[22px] h-[22px] rounded-sm border border-current",
                row.iconBoxColor,
              )}
              aria-hidden="true"
            >
              {Icon ? (
                <Icon className="w-[14px] h-[14px]" strokeWidth={2} />
              ) : (
                <span className="font-display text-[13px] leading-none">1</span>
              )}
            </span>
            <span className="flex-1 font-body text-[14px] leading-none">{row.label}</span>
            <span
              className="font-display text-[15px] tracking-[0.05em] tabular-nums"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {row.points}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default ScoringRules;
