// components/polla/InlineScoringGuide.tsx — expandable scoring tiers
//
// Shared between Perfil's "¿Cómo se puntúa?" and the polla-detail
// Info tab's "Sistema de puntos". Each tier is a tappable row with an
// (i) icon; tapping expands a subrow that spells out — in plain
// Spanish — what the tier means, plus a worked example (tu
// pronóstico → resultado → puntos). Keeps the scoring logic
// explained in one place so Perfil and Info never drift.
//
// Point values come from props.points so a polla with custom scoring
// rules (polla.points_exact / _goal_diff / _correct_result /
// _one_team) still renders accurate numbers. Defaults match the app-
// wide 5/3/2/1/0 ladder.

"use client";

import { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ScoringPoints {
  exact?: number;
  goalDiff?: number;
  winner?: number;
  oneTeam?: number;
}

interface Row {
  label: string;
  pts: number;
  ptsLabel: string;
  color: string;
  explanation: string;
  example: { pred: string; result: string };
}

function buildRows(
  p: ScoringPoints,
  t: (key: string, values?: Record<string, string | number>) => string,
): Row[] {
  const exact = p.exact ?? 5;
  const goalDiff = p.goalDiff ?? 3;
  const winner = p.winner ?? 2;
  const oneTeam = p.oneTeam ?? 1;
  return [
    {
      label: t("tier1Label"),
      pts: exact,
      ptsLabel: t("ptsCount", { count: exact }),
      color: "#FFD700",
      explanation: t("tier1Explanation"),
      example: { pred: "2-1", result: "2-1" },
    },
    {
      label: t("tier2Label"),
      pts: goalDiff,
      ptsLabel: t("ptsCount", { count: goalDiff }),
      color: "#f0f4ff",
      explanation: t("tier2Explanation"),
      example: { pred: "3-2", result: "2-1" },
    },
    {
      label: t("tier3Label"),
      pts: winner,
      ptsLabel: t("ptsCount", { count: winner }),
      color: "#f0f4ff",
      explanation: t("tier3Explanation"),
      example: { pred: "3-0", result: "2-1" },
    },
    {
      label: t("tier4Label"),
      pts: oneTeam,
      ptsLabel: t("ptsCount", { count: oneTeam }),
      color: "#f0f4ff",
      explanation: t("tier4Explanation"),
      example: { pred: "2-3", result: "2-1" },
    },
    {
      label: t("tier5Label"),
      pts: 0,
      ptsLabel: t("ptsCount", { count: 0 }),
      color: "#4a5568",
      explanation: t("tier5Explanation"),
      example: { pred: "0-0", result: "2-1" },
    },
  ];
}

export interface InlineScoringGuideProps {
  /** Polla-specific point values. Omit to fall back to 5/3/2/1/0. */
  points?: ScoringPoints;
}

export function InlineScoringGuide({ points }: InlineScoringGuideProps) {
  const t = useTranslations("Scoring");
  const rows = buildRows(points ?? {}, t);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div>
      {rows.map((row, i) => {
        const isExpanded = expanded === i;
        return (
          <div
            key={row.label}
            style={{
              borderBottom:
                i < rows.length - 1
                  ? "1px solid rgba(255,255,255,0.04)"
                  : "none",
            }}
          >
            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : i)}
              aria-expanded={isExpanded}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "9px 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#f0f4ff",
                }}
              >
                {row.label}
                <Info
                  className="w-3.5 h-3.5"
                  style={{ color: "#AEB7C7" }}
                  aria-hidden="true"
                />
              </span>
              <span
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  className="font-display"
                  style={{
                    fontSize: 18,
                    color: row.color,
                    letterSpacing: "0.05em",
                  }}
                >
                  {row.ptsLabel}
                </span>
                <ChevronDown
                  className="w-3.5 h-3.5 transition-transform"
                  style={{
                    color: "#AEB7C7",
                    transform: isExpanded
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                  }}
                  aria-hidden="true"
                />
              </span>
            </button>
            {isExpanded ? (
              <div
                style={{
                  paddingBottom: 10,
                  paddingLeft: 2,
                  paddingRight: 2,
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: "#d8dee8",
                }}
              >
                <p style={{ marginBottom: 8 }}>{row.explanation}</p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "#AEB7C7",
                      }}
                    >
                      {t("yourPred")}
                    </div>
                    <div
                      className="font-display"
                      style={{
                        fontSize: 18,
                        color: "#f0f4ff",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {row.example.pred}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "#AEB7C7" }}>→</span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "#AEB7C7",
                      }}
                    >
                      {t("result")}
                    </div>
                    <div
                      className="font-display"
                      style={{
                        fontSize: 18,
                        color: "#f0f4ff",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {row.example.result}
                    </div>
                  </div>
                  <div
                    className="font-display"
                    style={{
                      fontSize: 20,
                      color: row.color,
                      letterSpacing: "0.05em",
                      paddingLeft: 6,
                      borderLeft: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    {row.ptsLabel}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default InlineScoringGuide;
