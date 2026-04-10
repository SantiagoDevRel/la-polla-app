// components/shared/PollaCard.tsx — Polla card matching ui-reference.html .pcard spec
// Status dot (green pulse = active, grey static = ended), no text badges
"use client";

import { formatCOP } from "@/lib/formatCurrency";

interface PollaCardProps {
  name: string;
  tournamentName: string;
  tournamentIconPath: string;
  entryFee: number;
  participantCount: number;
  visibility: "publica" | "privada";
  isActive: boolean;
  onPress: () => void;
}

// Map of known tournament icon paths in /public/tournaments/
const TOURNAMENT_ICONS: Record<string, string> = {
  champions_2025: "/tournaments/champions_league.svg",
  worldcup_2026: "/tournaments/world_cup.svg",
  laliga_2025: "/tournaments/la_liga.png",
  premier_2025: "/tournaments/premier_league.png",
  seriea_2025: "/tournaments/seria_a.png",
  // Legacy slugs (backward compat)
  la_liga_2025: "/tournaments/la_liga.png",
  premier_league: "/tournaments/premier_league.png",
  seria_a: "/tournaments/seria_a.png",
};

function TournamentIcon({ path, size = 13 }: { path: string; size?: number }) {
  // If a valid path is provided, use img tag
  if (path && path.startsWith("/")) {
    return (
      <img
        src={path}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      />
    );
  }
  // Fallback: generic trophy SVG
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#7a8499"
      strokeWidth="2"
      style={{ flexShrink: 0 }}
    >
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M4 22h16" />
      <path d="M18 2H6v7a6 6 0 0012 0V2z" />
    </svg>
  );
}

export default function PollaCard({
  name,
  tournamentName,
  tournamentIconPath,
  entryFee,
  participantCount,
  visibility,
  isActive,
  onPress,
}: PollaCardProps) {
  return (
    <div
      onClick={onPress}
      className="pcard-container cursor-pointer transition-all duration-200"
      style={{
        background: "#0e1420",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 14,
        padding: "12px 14px",
        marginBottom: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "rgba(255,215,0,0.22)";
        e.currentTarget.style.background = "#0f1726";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
        e.currentTarget.style.background = "#0e1420";
      }}
    >
      {/* Top row: tournament + status dot + arrow */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 5, gap: 6 }}>
        {/* Tournament label (takes available space) */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}>
          <TournamentIcon path={tournamentIconPath} size={13} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#7a8499",
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {tournamentName}
          </span>
        </div>
        {/* Right group: dot + arrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span
            className={isActive ? "dot-active-pulse" : ""}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isActive ? "#00e676" : "#3a4454",
              boxShadow: isActive ? "0 0 5px rgba(0,230,118,0.6)" : "none",
              flexShrink: 0,
              display: "inline-block",
            }}
          />
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#4a5568"
            strokeWidth="2"
            style={{ flexShrink: 0 }}
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Card name */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "#f0f4ff",
          marginBottom: 7,
          lineHeight: 1.2,
        }}
      >
        {name}
      </div>

      {/* Footer: participants · fee · visibility */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Participants */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#7a8499" }}>
          <svg
            width={11}
            height={11}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
          {participantCount}
        </div>

        {/* Dot separator */}
        <span
          style={{
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: "#2a3347",
            flexShrink: 0,
          }}
        />

        {/* Entry fee */}
        <span style={{ fontSize: 12, color: "#FFD700", fontWeight: 700 }}>
          {formatCOP(entryFee)}
        </span>

        {/* Dot separator */}
        <span
          style={{
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: "#2a3347",
            flexShrink: 0,
          }}
        />

        {/* Visibility */}
        <span style={{ fontSize: 11, color: "#4a5568" }}>
          {visibility === "publica" ? "Pública" : "Privada"}
        </span>
      </div>
    </div>
  );
}

export { TOURNAMENT_ICONS };
