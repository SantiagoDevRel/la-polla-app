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
    <div className="bg-white rounded-xl shadow-sm p-4">
      <p className="text-xs text-gray-500 text-center mb-3">{date}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 text-right">
          <p className="font-medium text-sm text-colombia-blue truncate">{homeTeam}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={99}
            value={homeScore}
            onChange={(e) => setHomeScore(parseInt(e.target.value) || 0)}
            className="w-12 h-12 text-center border border-gray-300 rounded-lg text-lg font-bold focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none"
          />
          <span className="text-gray-400 font-bold">-</span>
          <input
            type="number"
            min={0}
            max={99}
            value={awayScore}
            onChange={(e) => setAwayScore(parseInt(e.target.value) || 0)}
            className="w-12 h-12 text-center border border-gray-300 rounded-lg text-lg font-bold focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none"
          />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm text-colombia-blue truncate">{awayTeam}</p>
        </div>
      </div>
      <button
        onClick={handleSave}
        className="w-full mt-3 bg-colombia-blue text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors"
      >
        Guardar pronóstico
      </button>
    </div>
  );
}
