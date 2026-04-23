// components/match/LiveChip.tsx — Tribuna Caliente §3.7
"use client";

import { cn } from "@/lib/cn";

export interface LiveChipProps {
  kind: "live" | "upcoming";
  homeCode: string;
  awayCode: string;
  homeScore?: number;
  awayScore?: number;
  minute?: number;
  kickoffAt?: Date;
  myPrediction?: { home: number; away: number };
  predictionStatus?: "correct" | "wrong" | "pending";
}

function formatUpcoming(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const sameTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();

  const time = new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (sameDay) return `HOY · ${time}`;
  if (sameTomorrow) return `MAÑANA · ${time}`;
  const weekday = new Intl.DateTimeFormat("es-CO", { weekday: "short" })
    .format(date)
    .replace(".", "")
    .toUpperCase();
  return `${weekday} · ${time}`;
}

export function LiveChip(props: LiveChipProps) {
  const {
    kind,
    homeCode,
    awayCode,
    homeScore,
    awayScore,
    minute,
    kickoffAt,
    myPrediction,
    predictionStatus,
  } = props;

  const isLive = kind === "live";

  return (
    <div
      className={cn(
        "flex-shrink-0 min-w-[150px] rounded-md px-3 py-2 flex flex-col gap-1.5 border",
        // Red accents for live rows so Inicio matches the Partidos tab's
        // language ("live == red"). Previously used turf/green which
        // fought against the Partidos pill and read inconsistent.
        isLive ? "border-red-alert/40 bg-red-alert/[0.06]" : "border-border-subtle bg-bg-card",
      )}
    >
      {/* Top row: status. Minute surfaces as "VIVO · 34'" when the
          football-data payload carries a numeric minute. Scheduled
          rows show their formatted kickoff instead. */}
      <div className="flex items-center gap-1.5">
        {isLive ? (
          <>
            <span aria-hidden="true" className="relative inline-block w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-red-alert animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-red-alert" />
            </span>
            <span className="font-display text-[11px] tracking-[0.06em] uppercase text-red-alert">
              Vivo{typeof minute === "number" ? ` · ${minute}'` : ""}
            </span>
          </>
        ) : (
          <span className="font-display text-[11px] tracking-[0.06em] uppercase text-text-muted">
            {kickoffAt ? formatUpcoming(kickoffAt) : "PRÓXIMO"}
          </span>
        )}
      </div>

      {/* Teams + score row */}
      <div className="flex items-center justify-between">
        <span className="font-display text-[16px] tracking-[0.04em] text-text-primary">
          {homeCode}
        </span>
        {isLive ? (
          <span
            className="font-display text-[18px] tracking-[0.04em] text-gold tabular-nums"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {homeScore ?? 0} — {awayScore ?? 0}
          </span>
        ) : (
          <span className="font-display text-[16px] tracking-[0.04em] text-text-muted">—</span>
        )}
        <span className="font-display text-[16px] tracking-[0.04em] text-text-primary">
          {awayCode}
        </span>
      </div>

      {/* Prediction footer.
           • myPrediction → "Tu pred: H-A" (+ "vas bien" on correct)
           • predictionStatus 'pending' AND no pred → "Falta pronóstico"
           • otherwise nothing so chips outside the user's pollas stay quiet */}
      {myPrediction || predictionStatus === "pending" ? (
        <div className="border-t border-dashed border-border-subtle pt-1.5">
          <span
            className={cn(
              "font-body text-[11px]",
              predictionStatus === "correct" && "text-turf",
              predictionStatus === "wrong" && "text-red-alert",
              !predictionStatus && myPrediction && "text-text-primary",
              predictionStatus === "pending" && !myPrediction && "text-amber",
            )}
          >
            {myPrediction
              ? `Pronóstico: ${myPrediction.home}-${myPrediction.away}${
                  predictionStatus === "correct" ? " · vas bien" : ""
                }`
              : "Falta pronóstico"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default LiveChip;
