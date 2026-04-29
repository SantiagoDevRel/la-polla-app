// components/match/LiveChip.tsx — Tribuna Caliente §3.7
"use client";

import { cn } from "@/lib/cn";

export interface LiveChipProps {
  kind: "live" | "upcoming";
  homeCode: string;
  awayCode: string;
  /** URL al logo del equipo home (ESPN o football-data). Si está, se
   *  muestra; si no, fallback al code de letras. */
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore?: number;
  awayScore?: number;
  /** Pre-formatted minute label, e.g. "34'" or "90+'". Pass exactly
   *  what should render; the chip no longer does the formatting
   *  itself so callers can share one helper (lib/matches/live-minute). */
  minuteLabel?: string;
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
    homeLogo,
    awayLogo,
    homeScore,
    awayScore,
    minuteLabel,
    kickoffAt,
    myPrediction,
    predictionStatus,
  } = props;

  const isLive = kind === "live";

  function renderTeam(logo: string | null | undefined, code: string) {
    if (logo) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt={code}
          width={24}
          height={24}
          className="object-contain"
          style={{ width: 24, height: 24 }}
          onError={(e) => {
            // Si la imagen falla (ESPN cambió URL, etc.), ocultamos
            // y mostramos el code de letras como fallback. Hacemos
            // el toggle reemplazando el src con un data:1x1 transparente
            // y agregando el code abajo en CSS — en práctica
            // simplemente ocultamos el img y dejamos un span vecino.
            (e.currentTarget as HTMLImageElement).style.display = "none";
            const sibling = (e.currentTarget as HTMLImageElement)
              .nextElementSibling as HTMLElement | null;
            if (sibling) sibling.style.display = "inline";
          }}
        />
      );
    }
    return (
      <span className="font-display text-[16px] tracking-[0.04em] text-text-primary">
        {code}
      </span>
    );
  }

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
              Vivo{minuteLabel ? ` · ${minuteLabel}` : ""}
            </span>
          </>
        ) : (
          <span className="font-display text-[11px] tracking-[0.06em] uppercase text-text-muted">
            {kickoffAt ? formatUpcoming(kickoffAt) : "PRÓXIMO"}
          </span>
        )}
      </div>

      {/* Teams + score row. Mostramos el escudo cuando el provider
          nos lo da (ESPN logo / football-data crest). Fallback al
          code de letras (ATM/ARS/etc.) si no hay logo o falla la
          imagen. El code SIEMPRE se renderiza junto al logo como
          screen-reader / fallback. */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 min-w-0">
          {renderTeam(homeLogo, homeCode)}
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
        <span className="flex items-center gap-1 min-w-0 justify-end">
          {renderTeam(awayLogo, awayCode)}
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
