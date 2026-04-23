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

function buildRows(p: ScoringPoints = {}): Row[] {
  const exact = p.exact ?? 5;
  const goalDiff = p.goalDiff ?? 3;
  const winner = p.winner ?? 2;
  const oneTeam = p.oneTeam ?? 1;
  return [
    {
      label: "Resultado exacto",
      pts: exact,
      ptsLabel: `${exact} pts`,
      color: "#FFD700",
      explanation: "Le clavaste al marcador exacto del partido.",
      example: { pred: "2-1", result: "2-1" },
    },
    {
      label: "Ganador + diferencia",
      pts: goalDiff,
      ptsLabel: `${goalDiff} pts`,
      color: "#f0f4ff",
      explanation:
        "Acertaste quién gana Y la misma diferencia de goles, pero no el marcador exacto.",
      example: { pred: "3-2", result: "2-1" },
    },
    {
      label: "Ganador correcto",
      pts: winner,
      ptsLabel: `${winner} pts`,
      color: "#f0f4ff",
      explanation:
        "Acertaste quién gana el partido, pero no la diferencia de goles.",
      example: { pred: "3-0", result: "2-1" },
    },
    {
      label: "Goles de un equipo",
      pts: oneTeam,
      ptsLabel: oneTeam === 1 ? "1 pt" : `${oneTeam} pts`,
      color: "#f0f4ff",
      explanation:
        "Acertaste los goles de al menos uno de los dos equipos, así el otro resultado esté mal.",
      example: { pred: "2-3", result: "2-1" },
    },
    {
      label: "Sin aciertos",
      pts: 0,
      ptsLabel: "0 pts",
      color: "#4a5568",
      explanation:
        "No le achuntaste a nada: ni al ganador, ni a la diferencia, ni a los goles de ninguno.",
      example: { pred: "0-0", result: "2-1" },
    },
  ];
}

export interface InlineScoringGuideProps {
  /** Polla-specific point values. Omit to fall back to 5/3/2/1/0. */
  points?: ScoringPoints;
}

export function InlineScoringGuide({ points }: InlineScoringGuideProps) {
  const rows = buildRows(points);
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
                      Tu pronóstico
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
                      Resultado
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
