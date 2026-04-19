// components/leaderboard/PodiumLeaderboard.tsx — Tribuna Caliente §3.6
"use client";

import Image from "next/image";
import { cn } from "@/lib/cn";

export interface PodiumEntry {
  userId: string;
  name: string;
  avatarUrl?: string;
  points: number;
}

export interface PodiumLeaderboardProps {
  pollaName?: string;
  top3: PodiumEntry[];
  currentUserId?: string;
}

type Rank = 1 | 2 | 3;

const RANK_STYLE: Record<
  Rank,
  {
    avatarSize: number;
    avatarBorder: string;
    avatarGlow?: string;
    pointsColor: string;
    barClass: string;
    barHeight: number;
  }
> = {
  1: {
    avatarSize: 52,
    avatarBorder: "border-gold",
    avatarGlow: "shadow-[0_0_18px_-2px_rgba(255,215,0,0.55)]",
    pointsColor: "text-gold",
    barClass: "bg-gradient-to-t from-gold to-amber",
    barHeight: 64,
  },
  2: {
    avatarSize: 40,
    avatarBorder: "border-text-secondary",
    pointsColor: "text-text-secondary",
    barClass: "bg-gradient-to-t from-text-secondary/70 to-text-secondary/40",
    barHeight: 44,
  },
  3: {
    avatarSize: 40,
    avatarBorder: "border-amber",
    pointsColor: "text-amber",
    barClass: "bg-gradient-to-t from-amber/80 to-amber/40",
    barHeight: 32,
  },
};

function PodiumColumn({
  rank,
  entry,
  highlighted,
}: {
  rank: Rank;
  entry: PodiumEntry | null;
  highlighted: boolean;
}) {
  const s = RANK_STYLE[rank];
  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-end h-full gap-2">
        <div
          className="rounded-full bg-bg-elevated border border-dashed border-border-subtle flex items-center justify-center text-text-muted font-display"
          style={{ width: s.avatarSize, height: s.avatarSize }}
          aria-hidden="true"
        >
          –
        </div>
        <span className="font-body text-[11px] text-text-muted">—</span>
        <div
          className="w-full rounded-t-md bg-bg-elevated border border-border-subtle flex items-start justify-center pt-1"
          style={{ height: s.barHeight }}
        >
          <span className="font-display text-[20px] text-text-muted leading-none">{rank}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-end h-full gap-2">
      <div
        className={cn(
          "relative rounded-full overflow-hidden border-[2.5px] bg-bg-elevated",
          s.avatarBorder,
          s.avatarGlow,
          highlighted && "ring-2 ring-offset-2 ring-offset-bg-base ring-gold",
        )}
        style={{ width: s.avatarSize, height: s.avatarSize }}
      >
        {entry.avatarUrl ? (
          <Image
            src={entry.avatarUrl}
            alt={entry.name}
            fill
            sizes={`${s.avatarSize}px`}
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-display text-text-primary text-[20px]">
            {entry.name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-body text-[11px] text-text-primary truncate max-w-[90px]">
          {entry.name}
        </span>
        <span
          className={cn("font-display text-[15px] tracking-[0.04em] tabular-nums", s.pointsColor)}
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {entry.points} PTS
        </span>
      </div>
      <div
        className={cn(
          "w-full rounded-t-md flex items-start justify-center pt-1",
          s.barClass,
        )}
        style={{ height: s.barHeight }}
      >
        <span
          className="font-display text-[20px] text-bg-base leading-none"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {rank}
        </span>
      </div>
    </div>
  );
}

export function PodiumLeaderboard({ pollaName, top3, currentUserId }: PodiumLeaderboardProps) {
  // Left: #2, Center: #1, Right: #3. Pad with nulls if fewer entries.
  const ranked: (PodiumEntry | null)[] = [0, 1, 2].map((i) => top3[i] ?? null);
  const [first, second, third] = ranked;

  return (
    <div className="w-full">
      {pollaName ? (
        <p className="mb-2 font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {pollaName}
        </p>
      ) : null}
      <div
        className="grid gap-3 items-end"
        style={{ gridTemplateColumns: "1fr 1.2fr 1fr", height: 150 }}
      >
        <PodiumColumn
          rank={2}
          entry={second}
          highlighted={!!currentUserId && second?.userId === currentUserId}
        />
        <PodiumColumn
          rank={1}
          entry={first}
          highlighted={!!currentUserId && first?.userId === currentUserId}
        />
        <PodiumColumn
          rank={3}
          entry={third}
          highlighted={!!currentUserId && third?.userId === currentUserId}
        />
      </div>
    </div>
  );
}

export default PodiumLeaderboard;
