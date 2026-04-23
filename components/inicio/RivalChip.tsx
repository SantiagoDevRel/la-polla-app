// components/inicio/RivalChip.tsx — Inicio rival callout
//
// Compact row showing how close the user is to either losing their lead
// (rival chasing) or taking the top spot (chasing a rival). Data comes
// from Inicio's server fetch; this component is purely presentational
// and renders nothing when no rival is available.
//
// No emojis. No server calls. Progress bar is capped at 100% and floored
// at 6% so the fill is always perceptible.

"use client";

import Link from "next/link";
import Image from "next/image";
import { getPollitoBase, DEFAULT_POLLITO } from "@/lib/pollitos";

export interface RivalChipProps {
  /** href to the polla detail page the rival lives in */
  pollaHref: string;
  /** Short polla name for screen-reader context. */
  pollaName: string;
  rivalName: string;
  rivalPollitoType: string | null | undefined;
  userPoints: number;
  rivalPoints: number;
  /** "chasing" = rival is behind user. "behind" = user is behind rival. */
  mode: "chasing" | "behind";
}

function pct(userPoints: number, rivalPoints: number, mode: "chasing" | "behind") {
  const total = Math.max(1, userPoints + rivalPoints);
  const userShare = (userPoints / total) * 100;
  const clamped = Math.min(100, Math.max(6, mode === "chasing" ? userShare : 100 - userShare));
  return clamped;
}

export function RivalChip({
  pollaHref,
  pollaName,
  rivalName,
  rivalPollitoType,
  userPoints,
  rivalPoints,
  mode,
}: RivalChipProps) {
  const gap = Math.abs(userPoints - rivalPoints);
  const fill = pct(userPoints, rivalPoints, mode);
  const headline =
    mode === "chasing"
      ? `${rivalName.toUpperCase()} te está pisando los talones`
      : `Alcanzá a ${rivalName.toUpperCase()}`;

  return (
    <section className="px-4 pb-6">
      <Link
        href={pollaHref}
        className="max-w-lg mx-auto flex items-center gap-3 rounded-[14px] p-3 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/30 transition-colors"
        aria-label={`Rival en ${pollaName}: ${rivalName}`}
      >
        <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-bg-elevated">
          <Image
            src={getPollitoBase(rivalPollitoType || DEFAULT_POLLITO)}
            alt=""
            width={40}
            height={40}
            className="object-cover w-full h-full"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-[10px] font-semibold tracking-[0.04em] text-text-muted truncate">
            {headline}
          </p>
          <div className="h-[5px] rounded-full bg-bg-subtle mt-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full ${mode === "chasing" ? "bg-gold" : "bg-turf"}`}
              style={{ width: `${fill}%` }}
            />
          </div>
          <div className="flex justify-between font-body text-[10px] mt-1">
            <span className={mode === "chasing" ? "text-gold font-bold" : "text-text-secondary font-semibold"}>
              Vos {userPoints} pts
            </span>
            <span className={mode === "behind" ? "text-turf font-bold" : "text-text-secondary font-semibold"}>
              {rivalName} {rivalPoints} pts
            </span>
          </div>
        </div>
        <div className="font-display text-[20px] tracking-[0.04em] text-gold leading-none flex-shrink-0">
          {mode === "chasing" ? "+" : "−"}
          {gap}
        </div>
      </Link>
    </section>
  );
}

export default RivalChip;
