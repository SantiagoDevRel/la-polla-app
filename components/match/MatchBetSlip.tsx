// components/match/MatchBetSlip.tsx — Tribuna Caliente §3.4
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";

interface Team {
  name: string;
  shortCode: string;
  crestUrl?: string;
}

export type MatchBetSlipState = "upcoming" | "locked" | "final";

export interface MatchBetSlipProps {
  match: {
    id: string;
    homeTeam: Team;
    awayTeam: Team;
    kickoffAt: Date;
    lockAt: Date;
    jornada?: string;
  };
  state: MatchBetSlipState;

  currentPrediction?: { home: number; away: number };
  onPredictionChange?: (home: number, away: number) => void;
  pollaContext?: {
    correctWinnerCount: number;
    total: number;
    avg: { home: number; away: number };
  };
  onSave?: () => Promise<void>;

  actualScore?: { home: number; away: number };
  pointsEarned?: 0 | 1 | 2 | 3 | 5;
  socialContext?: string;
}

function diffHM(target: Date, now: Date): { h: number; m: number; ms: number } {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const totalMin = Math.floor(ms / 60_000);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60, ms };
}

function TeamRow({ team, align }: { team: Team; align: "left" | "right" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        align === "right" && "flex-row-reverse",
      )}
    >
      {team.crestUrl ? (
        <Image
          src={team.crestUrl}
          alt={team.name}
          width={28}
          height={28}
          className="object-contain"
        />
      ) : (
        <div className="w-7 h-7 rounded-sm bg-bg-elevated border border-border-default flex items-center justify-center font-display text-[10px] tracking-[0.04em] text-text-primary">
          {team.shortCode}
        </div>
      )}
      <span className="font-body text-[13px] text-text-primary truncate max-w-[110px]">
        {team.name}
      </span>
    </div>
  );
}

function ScoreCell({
  value,
  editable,
  highlight,
  onChange,
}: {
  value: number | undefined;
  editable: boolean;
  highlight: "gold" | "primary" | "secondary";
  onChange?: (n: number) => void;
}) {
  const colorClass =
    highlight === "gold"
      ? "text-gold"
      : highlight === "primary"
      ? "text-text-primary"
      : "text-text-secondary";
  if (editable) {
    return (
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={20}
        value={value ?? ""}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange?.(Math.max(0, Math.min(20, n)));
          else onChange?.(0);
        }}
        className={cn(
          "w-12 h-14 rounded-md bg-bg-elevated text-center font-display text-[30px] tracking-[0.05em] outline-none tabular-nums",
          "border-2 border-gold/80 focus:border-gold focus:scale-[1.02] transition-transform",
          colorClass,
        )}
        style={{ fontFeatureSettings: '"tnum"' }}
      />
    );
  }
  return (
    <span
      className={cn(
        "w-12 h-14 rounded-md bg-bg-elevated border border-border-default flex items-center justify-center font-display text-[30px] tracking-[0.05em] tabular-nums opacity-[0.85]",
        colorClass,
      )}
      style={{ fontFeatureSettings: '"tnum"' }}
    >
      {value ?? "–"}
    </span>
  );
}

export function MatchBetSlip(props: MatchBetSlipProps) {
  const { match, state, currentPrediction, onPredictionChange, pollaContext, onSave, actualScore, pointsEarned, socialContext } = props;

  const [now, setNow] = useState<Date>(() => new Date());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state !== "upcoming" && state !== "locked") return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [state]);

  const isExact = state === "final" && pointsEarned === 5;
  const borderClass =
    state === "upcoming"
      ? "border-amber/25"
      : state === "final"
      ? isExact
        ? "border-gold/25"
        : pointsEarned && pointsEarned > 0
        ? "border-gold/25"
        : "border-border-subtle"
      : "border-border-subtle";

  const bgStyle =
    state === "upcoming"
      ? { background: "linear-gradient(180deg, rgba(255,159,28,0.06) 0%, var(--bg-card) 60%)" }
      : isExact
      ? { background: "linear-gradient(180deg, rgba(255,215,0,0.05) 0%, var(--bg-card) 60%)" }
      : { background: "var(--bg-card)" };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        borderClass,
      )}
      style={bgStyle}
    >
      {/* Header */}
      {state === "upcoming" ? (
        <div className="flex items-center justify-between mb-3">
          <Chip
            variant="locks"
            label={
              (() => {
                const d = diffHM(match.lockAt, now);
                return `Próximo · bloquea en ${d.h}h ${String(d.m).padStart(2, "0")}m`;
              })()
            }
          />
          {match.jornada ? (
            <span className="font-body text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {match.jornada}
            </span>
          ) : null}
        </div>
      ) : state === "locked" ? (
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-subtle bg-bg-elevated font-body text-[11px] uppercase tracking-[0.08em] text-text-muted">
            <Lock className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
            {(() => {
              const d = diffHM(match.kickoffAt, now);
              return `Bloqueado · empieza en ${d.h}h ${String(d.m).padStart(2, "0")}m`;
            })()}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3">
          {pointsEarned && pointsEarned > 0 ? (
            <Chip variant="live" label={`Final · ganaste ${pointsEarned} pts`} />
          ) : (
            <Chip variant="wrong" label="Final · 0 pts" />
          )}
          {isExact ? <Chip variant="leader" label="Marcador exacto" /> : null}
        </div>
      )}

      {/* Teams + scores row */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamRow team={match.homeTeam} align="left" />
        <div className="flex items-center gap-2">
          <ScoreCell
            value={state === "final" ? actualScore?.home : currentPrediction?.home}
            editable={state === "upcoming"}
            highlight={
              state === "upcoming"
                ? "gold"
                : isExact
                ? "gold"
                : state === "final"
                ? "primary"
                : "secondary"
            }
            onChange={(n) => onPredictionChange?.(n, currentPrediction?.away ?? 0)}
          />
          <span className="font-display text-text-muted">–</span>
          <ScoreCell
            value={state === "final" ? actualScore?.away : currentPrediction?.away}
            editable={state === "upcoming"}
            highlight={
              state === "upcoming"
                ? "gold"
                : isExact
                ? "gold"
                : state === "final"
                ? "primary"
                : "secondary"
            }
            onChange={(n) => onPredictionChange?.(currentPrediction?.home ?? 0, n)}
          />
        </div>
        <TeamRow team={match.awayTeam} align="right" />
      </div>

      {/* Footer */}
      {state === "upcoming" ? (
        <div className="mt-4 flex items-center justify-between">
          {pollaContext ? (
            <span className="font-body text-[12px] text-text-secondary">
              {pollaContext.correctWinnerCount}/{pollaContext.total} pronosticaron · prom{" "}
              <span className="tabular-nums text-text-primary">
                {pollaContext.avg.home}-{pollaContext.avg.away}
              </span>
            </span>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            onClick={async () => {
              if (!onSave) return;
              try {
                setSaving(true);
                await onSave();
              } finally {
                setSaving(false);
              }
            }}
          >
            Guardar
          </Button>
        </div>
      ) : state === "final" ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="font-body text-[12px] text-text-secondary">
            {socialContext ?? ""}
          </span>
          <span
            className={cn(
              "font-display text-[16px] tracking-[0.06em] px-2.5 py-1 rounded-full border tabular-nums",
              isExact
                ? "text-gold border-gold/30 bg-gold/10"
                : pointsEarned && pointsEarned > 0
                ? "text-text-primary border-border-subtle bg-bg-elevated"
                : "text-text-muted border-border-subtle bg-bg-elevated",
            )}
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            +{pointsEarned ?? 0} PTS
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default MatchBetSlip;
