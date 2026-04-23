// components/match/MatchHero.tsx — Tribuna Caliente §3.3
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

interface Team {
  name: string;
  shortCode: string;
  crestUrl?: string;
}

export interface MatchHeroProps {
  competition: { name: string; logoUrl?: string };
  kickoffAt: Date;
  homeTeam: Team;
  awayTeam: Team;
  myPrediction?: { home: number; away: number };
  pollaAverage?: { home: number; away: number };
  lockAt?: Date;
  onTap?: () => void;
  /**
   * Optional slot rendered in place of the default "Tu pred / Promedio
   * polla" bubbles. Inicio uses this to inline the quick-pick strip so
   * picking a score never leaves the hero card.
   */
  quickPickSlot?: React.ReactNode;
}

function formatKickoff(date: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function diffHoursMinutes(target: Date, now: Date): { h: number; m: number; ms: number } {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const totalMin = Math.floor(ms / 60_000);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60, ms };
}

function Crest({ team, size = 40 }: { team: Team; size?: number }) {
  if (team.crestUrl) {
    return (
      <Image
        src={team.crestUrl}
        alt={team.name}
        width={size}
        height={size}
        className="object-contain"
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-md bg-bg-elevated border border-border-default font-display tracking-[0.04em] text-text-primary"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-label={team.name}
    >
      {team.shortCode}
    </div>
  );
}

export function MatchHero({
  competition,
  kickoffAt,
  homeTeam,
  awayTeam,
  myPrediction,
  pollaAverage,
  lockAt,
  onTap,
  quickPickSlot,
}: MatchHeroProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const showCountdown = lockAt && lockAt.getTime() - now.getTime() <= 24 * 3600_000 && lockAt.getTime() > now.getTime();
  const countdown = lockAt ? diffHoursMinutes(lockAt, now) : null;

  const Wrapper: React.ElementType = onTap ? "button" : "div";

  return (
    <Wrapper
      onClick={onTap}
      className={cn(
        "relative block w-full overflow-hidden text-left",
        "rounded-xl border border-gold/25 p-5",
        "transition-transform duration-150 active:scale-[0.985]",
      )}
      style={{
        background:
          "linear-gradient(180deg, rgba(255, 215, 0, 0.06) 0%, rgba(14, 20, 32, 0.82) 50%)",
      }}
    >
      {/* top-right gold glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          background:
            "radial-gradient(circle, rgba(255, 215, 0, 0.15), transparent 70%)",
        }}
      />

      {/* 1. Meta strip */}
      <div className="flex items-center justify-between relative">
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-bg-elevated border border-border-subtle font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {competition.logoUrl ? (
            <Image
              src={competition.logoUrl}
              alt=""
              width={14}
              height={14}
              className="object-contain"
            />
          ) : null}
          {competition.name}
        </span>
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {formatKickoff(kickoffAt)}
        </span>
      </div>

      {/* 2. Teams row */}
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2">
          <Crest team={homeTeam} size={48} />
          <span className="font-body text-[13px] text-text-primary truncate max-w-full text-center">
            {homeTeam.name}
          </span>
        </div>
        <span
          className="font-display text-[40px] leading-none text-gold tracking-[0.02em]"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          VS
        </span>
        <div className="flex flex-col items-center gap-2">
          <Crest team={awayTeam} size={48} />
          <span className="font-body text-[13px] text-text-primary truncate max-w-full text-center">
            {awayTeam.name}
          </span>
        </div>
      </div>

      {/* 3. Quick-pick slot (falls back to the legacy preds strip when
          the caller does not supply one). Inicio inlines its own picker
          here so the entire pronóstico flow stays inside the hero card. */}
      {quickPickSlot ? (
        <div className="mt-5">{quickPickSlot}</div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-md bg-bg-elevated border border-gold/20 px-3 py-2.5">
            <p className="font-body text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Tu pred
            </p>
            {myPrediction ? (
              <p
                className="font-display text-[22px] leading-none text-gold mt-1"
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {myPrediction.home} — {myPrediction.away}
              </p>
            ) : (
              <p className="font-display text-[16px] leading-none text-gold mt-1 tracking-[0.06em]">
                PRONOSTICÁ
              </p>
            )}
          </div>
          <div className="rounded-md bg-bg-elevated border border-border-subtle px-3 py-2.5">
            <p className="font-body text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Promedio polla
            </p>
            <p
              className="font-display text-[22px] leading-none text-text-secondary mt-1"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {pollaAverage ? `${pollaAverage.home} — ${pollaAverage.away}` : "—"}
            </p>
          </div>
        </div>
      )}

      {/* 4. Countdown strip */}
      {showCountdown && countdown ? (
        <div className="mt-4 flex items-center justify-between rounded-md border border-amber/30 bg-amber/[0.08] px-3 py-2">
          <span className="inline-flex items-center gap-2 font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-amber">
            <span aria-hidden="true" className="relative inline-block w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-amber animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-amber" />
            </span>
            Bloquea en
          </span>
          <span
            className="font-display text-[16px] tracking-[0.06em] text-amber"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {countdown.h}H {String(countdown.m).padStart(2, "0")}M
          </span>
        </div>
      ) : null}
    </Wrapper>
  );
}

export default MatchHero;
