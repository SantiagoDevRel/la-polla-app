// components/polla/MatchPredictionCard.tsx — Tarjeta para ingresar pronósticos de un partido
"use client";

import { useState } from "react";

interface MatchPredictionCardProps {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  date: string;
  onPredict?: (matchId: number, homeScore: number, awayScore: number) => void;
}

export default function MatchPredictionCard({
  matchId,
  homeTeam,
  awayTeam,
  date,
  onPredict,
}: MatchPredictionCardProps) {
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);

  const handleSave = () => {
    onPredict?.(matchId, homeScore, awayScore);
  };

  return (
    <div className="rounded-xl p-4 bg-bg-card border border-border-subtle">
      <p className="text-xs text-text-muted text-center mb-3">{date}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 text-right">
          <p className="font-medium text-sm text-text-primary truncate">{homeTeam}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={99}
            value={homeScore}
            onChange={(e) => setHomeScore(parseInt(e.target.value) || 0)}
            className="w-12 h-12 text-center rounded-lg score-font text-xl outline-none transition-colors bg-bg-elevated border-2 border-border-medium text-text-primary focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
          />
          <span className="text-text-muted font-bold">-</span>
          <input
            type="number"
            min={0}
            max={99}
            value={awayScore}
            onChange={(e) => setAwayScore(parseInt(e.target.value) || 0)}
            className="w-12 h-12 text-center rounded-lg score-font text-xl outline-none transition-colors bg-bg-elevated border-2 border-border-medium text-text-primary focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
          />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm text-text-primary truncate">{awayTeam}</p>
        </div>
      </div>
      <button
        onClick={handleSave}
        className="w-full mt-3 bg-gold text-bg-base py-2.5 rounded-lg text-sm font-bold hover:brightness-110 transition-all"
      >
        Guardar pronóstico
      </button>
    </div>
  );
}
