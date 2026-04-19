// components/polla/PollaCard.tsx — Tribuna Caliente §3.5
"use client";

import Image from "next/image";
import Link from "next/link";
import { Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCOP } from "@/lib/formatCurrency";

export interface PollaCardProps {
  polla: {
    id: string;
    slug: string;
    name: string;
    competitionName: string;
    competitionLogoUrl?: string;
    participantCount: number;
    buyInAmount: number;
    totalMatches: number;
    finishedMatches: number;
  };
  userContext: {
    rank?: number;
    totalPoints: number;
    isLeader: boolean;
  };
  variant?: "carousel" | "grid";
  onTap?: () => void;
}

export function PollaCard({
  polla,
  userContext,
  variant = "grid",
  onTap,
}: PollaCardProps) {
  const isLeader = userContext.isLeader;
  const isCarousel = variant === "carousel";
  const pendingMatches = Math.max(0, polla.totalMatches - polla.finishedMatches);

  return (
    <Link
      href={`/pollas/${polla.slug}`}
      onClick={onTap}
      className={cn(
        "relative block overflow-hidden rounded-lg border p-4 transition-transform duration-150 active:scale-[0.985]",
        isCarousel ? "w-[210px] flex-shrink-0" : "w-full",
        isLeader
          ? "border-gold/40 shadow-[0_0_30px_-10px_rgba(255,215,0,0.2)]"
          : "border-border-subtle hover:border-border-default",
      )}
      style={
        isLeader
          ? {
              background:
                "linear-gradient(180deg, rgba(255, 215, 0, 0.06) 0%, var(--bg-card) 100%)",
            }
          : { background: "var(--bg-card)" }
      }
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

      {/* Comp tag row */}
      <div className="flex items-center gap-1.5">
        {polla.competitionLogoUrl ? (
          <Image
            src={polla.competitionLogoUrl}
            alt=""
            width={14}
            height={14}
            className="object-contain"
          />
        ) : null}
        <span className="font-body text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted truncate">
          {polla.competitionName}
        </span>
      </div>

      {/* Polla name */}
      <h3
        className={cn(
          "mt-1.5 font-body font-bold text-text-primary leading-[1.3]",
          isCarousel ? "text-[16px] line-clamp-2" : "text-[18px] line-clamp-1",
        )}
        style={{ letterSpacing: "-0.01em" }}
      >
        {polla.name}
      </h3>

      {/* Stats row */}
      <div className="mt-3 flex items-center gap-3">
        <span
          className="inline-flex items-center gap-1 font-body text-[12px] text-text-secondary tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          <Users className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
          {polla.participantCount}
        </span>
        {polla.buyInAmount > 0 ? (
          <span className="font-body text-[12px] text-text-secondary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
            {formatCOP(polla.buyInAmount)}
          </span>
        ) : (
          <span className="font-body text-[12px] text-text-muted">Gratis</span>
        )}
      </div>

      {/* Progress footer */}
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
          {userContext.totalPoints} PTS
        </span>
        <span className="font-body text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {pendingMatches > 0 ? `${pendingMatches} por jugar` : "Terminada"}
        </span>
      </div>
    </Link>
  );
}

export default PollaCard;
