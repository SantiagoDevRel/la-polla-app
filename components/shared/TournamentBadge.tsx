// components/shared/TournamentBadge.tsx — Reusable tournament logo + name display
// Single source of truth for rendering tournament identity across the app
"use client";

import { getTournamentBySlug } from "@/lib/tournaments";

interface TournamentBadgeProps {
  tournamentSlug: string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}

const SIZES = {
  sm: { logo: 16, text: 11 },
  md: { logo: 20, text: 13 },
  lg: { logo: 28, text: 15 },
} as const;

function FallbackTrophy({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#7a8499"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M4 22h16" />
      <path d="M18 2H6v7a6 6 0 0012 0V2z" />
    </svg>
  );
}

export default function TournamentBadge({
  tournamentSlug,
  size = "sm",
  showName = true,
  className,
}: TournamentBadgeProps) {
  const tournament = getTournamentBySlug(tournamentSlug);
  const { logo: logoSize, text: textSize } = SIZES[size];

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size === "lg" ? 8 : 5,
      }}
    >
      {tournament ? (
        <img
          src={tournament.logoPath}
          alt={tournament.name}
          width={logoSize}
          height={logoSize}
          style={{
            width: logoSize,
            height: logoSize,
            objectFit: "contain",
            flexShrink: 0,
          }}
        />
      ) : (
        <FallbackTrophy size={logoSize} />
      )}
      {showName && (
        <span
          style={{
            fontSize: textSize,
            fontWeight: 600,
            color: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {tournament?.name || tournamentSlug}
        </span>
      )}
    </span>
  );
}
