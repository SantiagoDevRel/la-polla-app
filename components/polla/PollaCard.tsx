// components/polla/PollaCard.tsx — Tribuna Caliente §3.5
"use client";

import Image from "next/image";
import Link from "next/link";
import { Users, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCOP } from "@/lib/formatCurrency";

export interface PollaCardProps {
  polla: {
    id: string;
    slug: string;
    name: string;
    competitionName: string;
    competitionLogoUrl?: string;
    /** Stack de logos cuando la polla es combinada (>= 2 torneos).
     *  Si está y tiene > 1, reemplaza el single-logo header. */
    competitionLogos?: string[];
    participantCount: number;
    buyInAmount: number;
    /** Pozo total acumulado (buy_in × seats que ya cuentan según
     *  payment_mode). Se muestra al lado de la cuota individual. */
    potTotal?: number;
    totalMatches: number;
    finishedMatches: number;
  };
  userContext?: {
    rank?: number;
    totalPoints?: number;
    isLeader?: boolean;
  };
  endedState?: {
    winnerName: string;
    winnerPoints: number;
  };
  variant?: "carousel" | "grid";
  onTap?: () => void;
}

export function PollaCard({
  polla,
  userContext,
  endedState,
  variant = "grid",
  onTap,
}: PollaCardProps) {
  const isLeader = !!userContext?.isLeader && !endedState;
  const isCarousel = variant === "carousel";
  const hasMatchProgress = polla.totalMatches > 0;
  const isComplete = hasMatchProgress && polla.finishedMatches >= polla.totalMatches;
  const progressPct = hasMatchProgress
    ? Math.round((polla.finishedMatches / polla.totalMatches) * 100)
    : 0;
  const hasPlayedMatches = polla.finishedMatches > 0;

  // Show the rank/points footer for any active polla where the user is
  // a participant. When match progress data is missing (match_ids NULL for
  // non-'custom' scopes) we just drop the progress segment instead of
  // hiding the whole footer — otherwise rank + points disappear too.
  const showProgressFooter = !endedState && !!userContext;
  const showEndedFooter = !!endedState;

  return (
    <Link
      href={`/pollas/${polla.slug}`}
      onClick={onTap}
      className={cn(
        "relative block overflow-hidden p-4 transition-transform duration-150 active:scale-[0.985]",
        isLeader ? "lp-card-hero" : "lp-card",
        isCarousel ? "w-[210px] flex-shrink-0" : "w-full",
        endedState && "opacity-75",
      )}
    >
      {isLeader ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--gold), transparent)",
          }}
        />
      ) : null}

      {/* Polla name — primer header. Antes había una row separada con
          logo+nombre del torneo, pero la quitamos para ahorrar espacio
          vertical. Los logos van en la stats row a la derecha. */}
      <h3
        className={cn(
          "font-body font-bold text-text-primary leading-[1.3]",
          isCarousel ? "text-[16px] line-clamp-2" : "text-[18px] line-clamp-1",
        )}
        style={{ letterSpacing: "-0.01em" }}
      >
        {polla.name}
      </h3>

      {/* Stats row + logos a la derecha. Separadores '·' como elementos
          aparte (no incrustados en el texto) para que el spacing sea
          consistente. 'POZO' como label uppercase pequeño antes del
          monto gold — mismo tamaño que las otras stats, balanceado. */}
      <div className="mt-2 flex items-center justify-between gap-3">
        <div
          className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0 font-body text-[12px] text-text-secondary tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
            {polla.participantCount}
          </span>
          {polla.buyInAmount > 0 ? (
            <>
              <span className="text-text-muted/50" aria-hidden="true">·</span>
              <span>{formatCOP(polla.buyInAmount)} c/u</span>
              {polla.potTotal && polla.potTotal > 0 ? (
                <>
                  <span className="text-text-muted/50" aria-hidden="true">·</span>
                  <span
                    className="inline-flex items-baseline gap-1 text-gold"
                    title="Pozo total acumulado"
                  >
                    <span className="text-[10px] uppercase tracking-[0.08em] text-gold/70">
                      Pozo
                    </span>
                    <span>{formatCOP(polla.potTotal)}</span>
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <>
              <span className="text-text-muted/50" aria-hidden="true">·</span>
              <span className="text-text-muted">Gratis</span>
            </>
          )}
        </div>

        {/* Logos del torneo (1 = primary, > 1 = combinada). Cada logo
            va en un circle con fondo claro para que los logos oscuros
            (Bancolombia amarillo o Champions azul) tengan contraste
            sobre el fondo dark del card. */}
        <div
          className="flex items-center gap-1.5 flex-shrink-0"
          title={
            polla.competitionLogos && polla.competitionLogos.length > 1
              ? `Combinada · ${polla.competitionLogos.length} torneos`
              : polla.competitionName
          }
        >
          {polla.competitionLogos && polla.competitionLogos.length > 1
            ? polla.competitionLogos.slice(0, 4).map((logo, i) => (
                <span
                  key={i}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/50 ring-1 ring-white/15"
                >
                  <Image
                    src={logo}
                    alt=""
                    width={20}
                    height={20}
                    className="object-contain"
                  />
                </span>
              ))
            : polla.competitionLogoUrl
              ? (
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/50 ring-1 ring-white/15">
                  <Image
                    src={polla.competitionLogoUrl}
                    alt=""
                    width={20}
                    height={20}
                    className="object-contain"
                  />
                </span>
              )
              : null}
        </div>
      </div>

      {/* Rank row — shown alongside endedState when userContext is also present */}
      {endedState && userContext ? (
        <div
          className={cn(
            "mt-3 flex items-center justify-between rounded-sm px-2 py-1.5",
            isLeader ? "bg-gold/10 border border-gold/25" : "bg-bg-elevated border border-border-subtle",
          )}
        >
          <span className="font-body text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {userContext.rank ? `#${userContext.rank}` : "Sin rank"}
          </span>
          <span
            className={cn(
              "font-display text-[14px] tracking-[0.06em] tabular-nums",
              isLeader ? "text-gold" : "text-text-primary",
            )}
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {userContext.totalPoints ?? 0} PTS
          </span>
        </div>
      ) : null}

      {/* Progress footer — active pollas with rank + progress data */}
      {showProgressFooter ? (
        <div
          className={cn(
            "mt-3 relative rounded-sm px-2 pt-3 pb-1.5",
            isLeader ? "bg-gold/10 border border-gold/25" : "bg-bg-elevated border border-border-subtle",
          )}
        >
          {/* thin progress track */}
          <div className="absolute inset-x-2 top-1 h-[3px] rounded-full bg-white/5 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isLeader ? "bg-gold" : "bg-text-secondary/60",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="font-body text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {userContext!.rank ? `#${userContext!.rank}` : "Sin rank"}
            </span>
            {hasPlayedMatches ? (
              <span
                className={cn(
                  "font-display text-[14px] tracking-[0.06em] tabular-nums",
                  isLeader ? "text-gold" : "text-text-primary",
                )}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {userContext!.totalPoints ?? 0} PTS
              </span>
            ) : null}
            {hasMatchProgress ? (
              <span className="font-body text-[10px] uppercase tracking-[0.08em] text-text-muted tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                {isComplete
                  ? "Terminada"
                  : `${polla.finishedMatches} de ${polla.totalMatches} partidos`}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Ended footer — winner row */}
      {showEndedFooter ? (
        <div className="mt-3 flex items-center gap-2 rounded-sm px-2 py-1.5 bg-bg-elevated border border-gold/20">
          <Trophy size={14} className="text-gold flex-shrink-0" aria-hidden="true" />
          <span className="font-body text-[12px] text-text-primary truncate flex-1">
            {endedState!.winnerName}
          </span>
          <span
            className="font-display text-[13px] tracking-[0.05em] text-gold tabular-nums"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {endedState!.winnerPoints} PTS
          </span>
        </div>
      ) : null}
    </Link>
  );
}

export default PollaCard;
