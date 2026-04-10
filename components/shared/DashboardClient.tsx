// components/shared/DashboardClient.tsx — Interactive dashboard sections
// Live matches banner + polla selector tabs + leaderboard
"use client";

import { useState } from "react";
import { TOURNAMENT_ICONS } from "@/components/shared/PollaCard";
import { formatCOP } from "@/lib/formatCurrency";

// ─── Types ───

interface LiveMatch {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  status: "live" | "finished";
  elapsed: number | null;
  tournament: string;
  // User's prediction for this match (if any)
  predicted_home: number | null;
  predicted_away: number | null;
}

interface PollaTab {
  id: string;
  name: string;
  tournament: string;
  tournamentName: string;
  isActive: boolean;
  participantCount: number;
  entryFee: number;
}

interface LeaderboardEntry {
  pollaId: string;
  userId: string;
  displayName: string;
  totalPoints: number;
  rank: number;
}

interface DashboardClientProps {
  liveMatches: LiveMatch[];
  userPollas: PollaTab[];
  leaderboardData: LeaderboardEntry[];
}

const TOURNAMENT_NAMES: Record<string, string> = {
  champions_2025: "Champions League",
  worldcup_2026: "Mundial 2026",
  la_liga_2025: "La Liga",
};

// ─── Live Matches Banner ───

function LiveMatchesBanner({ matches }: { matches: LiveMatch[] }) {
  if (matches.length === 0) return null;

  return (
    <div style={{ margin: "12px 0 14px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f4ff" }}>Partidos en curso</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "#ff3d57", letterSpacing: "0.04em" }}>
          <span className="ldot-red-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff3d57", display: "inline-block" }} />
          En Vivo
        </span>
      </div>

      {/* Scroll container — full bleed */}
      <div
        className="hide-scrollbar"
        style={{
          margin: "0 -15px",
          padding: "0 15px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x",
        }}
      >
        <div style={{ display: "flex", gap: 8, paddingRight: 15, width: "max-content" }}>
          {matches.map((match) => {
            const isFinished = match.status === "finished";
            const predMatches = match.predicted_home !== null &&
              match.predicted_away !== null &&
              match.predicted_home === match.home_score &&
              match.predicted_away === match.away_score;
            const hasPred = match.predicted_home !== null && match.predicted_away !== null;

            return (
              <div
                key={match.id}
                style={{
                  width: 148,
                  flexShrink: 0,
                  background: "#0e1420",
                  border: isFinished ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(255,61,87,0.2)",
                  borderRadius: 12,
                  padding: "9px 10px 8px",
                  opacity: isFinished ? 0.6 : 1,
                }}
              >
                {/* Header: live/final + time */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: isFinished ? "#4a5568" : "#ff3d57" }}>
                    {isFinished ? (
                      <>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3a4454", display: "inline-block" }} />
                        Final
                      </>
                    ) : (
                      <>
                        <span className="ldot-red-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff3d57", display: "inline-block" }} />
                        Vivo
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: "#7a8499" }}>
                    {match.elapsed ? `${match.elapsed}'` : ""}
                  </div>
                </div>

                {/* Teams + Score */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                  {/* Home team */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%", background: "#131d2e",
                      border: "1px solid rgba(255,255,255,0.08)", display: "flex",
                      alignItems: "center", justifyContent: "center", overflow: "hidden",
                    }}>
                      {match.home_team_flag ? (
                        <img src={match.home_team_flag} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: "50%" }} />
                      ) : (
                        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 7, color: "#7a8499", letterSpacing: "0.04em" }}>
                          {match.home_team.substring(0, 3).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#b0b8c8", textAlign: "center", maxWidth: 46, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {match.home_team}
                    </span>
                  </div>

                  {/* Score */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      fontFamily: "'Bebas Neue', sans-serif", fontSize: 26,
                      color: isFinished ? "#7a8499" : "#f0f4ff",
                      letterSpacing: "0.04em", lineHeight: 1,
                      display: "flex", alignItems: "center", gap: 2,
                    }}>
                      <span>{match.home_score ?? 0}</span>
                      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#4a5568" }}>–</span>
                      <span>{match.away_score ?? 0}</span>
                    </div>
                  </div>

                  {/* Away team */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%", background: "#131d2e",
                      border: "1px solid rgba(255,255,255,0.08)", display: "flex",
                      alignItems: "center", justifyContent: "center", overflow: "hidden",
                    }}>
                      {match.away_team_flag ? (
                        <img src={match.away_team_flag} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: "50%" }} />
                      ) : (
                        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 7, color: "#7a8499", letterSpacing: "0.04em" }}>
                          {match.away_team.substring(0, 3).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#b0b8c8", textAlign: "center", maxWidth: 46, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {match.away_team}
                    </span>
                  </div>
                </div>

                {/* Prediction row */}
                <div style={{ fontSize: 8, color: "#4a5568", textAlign: "center", marginTop: 4 }}>
                  {hasPred ? (
                    predMatches ? (
                      <span style={{ color: "#00e676", fontWeight: 700 }}>
                        Tu pred: {match.predicted_home}–{match.predicted_away} ✓
                      </span>
                    ) : (
                      <span style={{ color: "#ff3d57", fontWeight: 700 }}>
                        Tu pred: {match.predicted_home}–{match.predicted_away}
                      </span>
                    )
                  ) : (
                    <span style={{ color: "#4a5568" }}>Sin pronóstico</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Polla Selector + Leaderboard ───

function PollaSelectorWithLeaderboard({
  pollas,
  leaderboardData,
}: {
  pollas: PollaTab[];
  leaderboardData: LeaderboardEntry[];
}) {
  const [selectedPollaId, setSelectedPollaId] = useState(pollas[0]?.id ?? null);

  if (pollas.length === 0) return null;

  const selectedPolla = pollas.find((p) => p.id === selectedPollaId) || pollas[0];
  const leaderboard = leaderboardData
    .filter((e) => e.pollaId === selectedPollaId)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);

  const positionColor = (rank: number) => {
    if (rank === 1) return "#FFD700";
    if (rank === 2) return "#C0C0C0";
    if (rank === 3) return "#CD7F32";
    return "#4a5568";
  };

  return (
    <>
      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 8px" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f4ff" }}>Mis pollas</span>
      </div>

      {/* Polla selector — horizontal scroll */}
      <div
        className="hide-scrollbar"
        style={{
          margin: "0 -15px",
          padding: "0 15px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 7, width: "max-content", paddingRight: 15 }}>
          {pollas.map((polla) => {
            const isSelected = polla.id === selectedPollaId;
            return (
              <button
                key={polla.id}
                onClick={() => setSelectedPollaId(polla.id)}
                style={{
                  flexShrink: 0,
                  background: isSelected ? "rgba(255,215,0,0.05)" : "#0e1420",
                  border: isSelected ? "1px solid rgba(255,215,0,0.35)" : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "8px 12px",
                  cursor: "pointer",
                  minWidth: 128,
                  textAlign: "left",
                  fontFamily: "'Outfit', sans-serif",
                  transition: "border-color 0.2s",
                }}
              >
                {/* Top: tournament + dot */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#7a8499", fontWeight: 500 }}>
                    {TOURNAMENT_ICONS[polla.tournament] ? (
                      <img src={TOURNAMENT_ICONS[polla.tournament]} alt="" style={{ width: 10, height: 10, objectFit: "contain", flexShrink: 0 }} />
                    ) : (
                      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#7a8499" strokeWidth="2" style={{ flexShrink: 0 }}>
                        <path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                        <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0012 0V2z" />
                      </svg>
                    )}
                    {polla.tournamentName}
                  </div>
                  <span
                    className={polla.isActive ? "dot-active-pulse" : ""}
                    style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: polla.isActive ? "#00e676" : "#3a4454",
                      boxShadow: polla.isActive ? "0 0 5px rgba(0,230,118,0.6)" : "none",
                      flexShrink: 0, display: "inline-block",
                    }}
                  />
                </div>
                {/* Polla name */}
                <div style={{
                  fontSize: 13, fontWeight: 600, color: "#f0f4ff",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 116,
                }}>
                  {polla.name}
                </div>
                {/* Meta */}
                <div style={{ fontSize: 10, color: "#7a8499", marginTop: 2 }}>
                  <span style={{ color: "#FFD700", fontWeight: 600 }}>{polla.participantCount}</span> jugadores · <span style={{ color: "#FFD700", fontWeight: 600 }}>{formatCOP(polla.entryFee)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <div style={{
          background: "#0e1420",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          padding: "8px 12px",
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "#7a8499",
            marginBottom: 6, paddingBottom: 6,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}>
            Tabla — {selectedPolla.name}
          </div>
          {leaderboard.map((entry) => (
            <div
              key={entry.userId}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              {/* Position */}
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 18,
                letterSpacing: "0.05em", minWidth: 18, textAlign: "center",
                color: positionColor(entry.rank),
              }}>
                {entry.rank}
              </span>
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                border: "1px solid rgba(255,215,0,0.2)", overflow: "hidden",
                flexShrink: 0,
              }}>
                <img src="/pollitos/logo.png" alt="" style={{ width: 28, height: 28, objectFit: "cover" }} />
              </div>
              {/* Name */}
              <span style={{ fontSize: 12, fontWeight: 600, color: "#f0f4ff", flex: 1 }}>
                {entry.displayName}
              </span>
              {/* Points */}
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#FFD700", letterSpacing: "0.05em" }}>
                {entry.totalPoints}
              </span>
              <span style={{ fontSize: 9, color: "#7a8499" }}>pts</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Main Export ───

export default function DashboardClient({ liveMatches, userPollas, leaderboardData }: DashboardClientProps) {
  return (
    <>
      <LiveMatchesBanner matches={liveMatches} />
      <PollaSelectorWithLeaderboard pollas={userPollas} leaderboardData={leaderboardData} />
    </>
  );
}
