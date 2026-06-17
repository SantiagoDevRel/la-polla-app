// components/admin/ScoringSurveyCard.tsx — Resultados de la encuesta de
// sistema de puntos en /admin. Muestra el tally (Sí/No/Faltan), una
// comparativa "cómo está vs cómo quedaría" con goles_v2, y botones para
// aplicar o mantener. Se auto-oculta si no hay encuesta ni polla en goles_v2.
"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface Row {
  userId: string;
  name: string;
  avatar: string | null;
  currentPoints: number;
  currentRank: number;
  projectedPoints: number;
  projectedRank: number;
  vote: "si" | "no" | null;
}

interface SurveyData {
  pollaId: string;
  pollaName: string;
  pollaSlug: string;
  scoringMode: string;
  surveyOpen: boolean;
  counts: { total: number; si: number; no: number; pending: number };
  rows: Row[];
}

function rankDelta(curr: number, proj: number) {
  // rank más bajo = mejor. Sube si proj < curr.
  if (proj < curr) return { txt: `▲${curr - proj}`, color: "#1FD87F" };
  if (proj > curr) return { txt: `▼${proj - curr}`, color: "#FF3D57" };
  return { txt: "=", color: "#6B7689" };
}

export default function ScoringSurveyCard() {
  const { showToast } = useToast();
  const [data, setData] = useState<SurveyData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await axios.get<{ survey: SurveyData | null }>(
        "/api/admin/scoring-survey",
      );
      setData(body.survey);
    } catch {
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (action: "apply" | "keep") => {
      if (!data) return;
      const msg =
        action === "apply"
          ? `¿Aplicar el NUEVO sistema (goles_v2) a "${data.pollaName}"? Se recalculan todos los puntos de esta polla. Las demás pollas no se tocan.`
          : `¿Cerrar la encuesta y MANTENER el sistema actual en "${data.pollaName}"?`;
      if (!window.confirm(msg)) return;
      setActing(true);
      try {
        await axios.post("/api/admin/scoring-survey", {
          pollaId: data.pollaId,
          action,
        });
        showToast(
          action === "apply"
            ? "Nuevo sistema aplicado y puntos recalculados"
            : "Encuesta cerrada, sistema actual mantenido",
          "success",
        );
        await load();
      } catch {
        showToast("No se pudo procesar la acción", "error");
      } finally {
        setActing(false);
      }
    },
    [data, load, showToast],
  );

  if (!loaded || !data) return null;

  const { counts } = data;
  const decided = counts.si + counts.no;
  const majorityYes = counts.si > counts.total / 2;
  const majorityNo = counts.no >= counts.total / 2;
  const applied = data.scoringMode === "goles_v2";

  return (
    <section
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: "rgba(255,215,0,0.06)",
        border: "1px solid rgba(255,215,0,0.25)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[18px] tracking-[0.03em] text-text-primary">
            Encuesta · nuevo puntaje
          </h3>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {data.pollaName}
            {applied ? (
              <span className="ml-2 rounded-full bg-turf/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-turf">
                Aplicado
              </span>
            ) : data.surveyOpen ? (
              <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
                Abierta
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Cerrada
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Tally */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-bg-elevated px-3 py-2 text-center">
          <div className="font-display text-[22px] text-turf">{counts.si}</div>
          <div className="text-[10px] uppercase tracking-wide text-text-muted">Sí</div>
        </div>
        <div className="rounded-xl bg-bg-elevated px-3 py-2 text-center">
          <div className="font-display text-[22px] text-red-alert">{counts.no}</div>
          <div className="text-[10px] uppercase tracking-wide text-text-muted">No</div>
        </div>
        <div className="rounded-xl bg-bg-elevated px-3 py-2 text-center">
          <div className="font-display text-[22px] text-text-secondary">{counts.pending}</div>
          <div className="text-[10px] uppercase tracking-wide text-text-muted">Faltan</div>
        </div>
      </div>
      <p className="text-[11.5px] text-text-secondary">
        {decided} de {counts.total} votaron.{" "}
        {majorityYes ? (
          <span className="text-turf">Mayoría a favor del nuevo sistema.</span>
        ) : majorityNo ? (
          <span className="text-text-secondary">Mayoría por mantener el actual.</span>
        ) : (
          <span className="text-text-muted">Sin mayoría todavía.</span>
        )}
      </p>

      {/* Comparativa de tabla */}
      <div className="overflow-hidden rounded-xl border border-border-subtle">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-x-2 border-b border-border-subtle bg-bg-elevated px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          <span>Jugador</span>
          <span className="text-center">Hoy</span>
          <span className="text-center text-gold">Nuevo</span>
          <span className="w-10 text-center">Voto</span>
        </div>
        {data.rows.map((r, i) => {
          const d = rankDelta(r.currentRank, r.projectedRank);
          return (
            <div
              key={r.userId}
              className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-x-2 px-3 py-1.5"
              style={{ borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)" }}
            >
              <span className="truncate text-[12px] text-text-primary">{r.name}</span>
              <span className="text-center text-[12px] text-text-secondary">
                <span className="text-text-muted">#{r.currentRank}</span>{" "}
                <span className="font-display text-[14px]">{r.currentPoints}</span>
              </span>
              <span className="text-center text-[12px]">
                <span style={{ color: d.color }}>#{r.projectedRank}</span>{" "}
                <span className="font-display text-[14px] text-text-primary">
                  {r.projectedPoints}
                </span>
                <span className="ml-1 text-[10px]" style={{ color: d.color }}>
                  {d.txt}
                </span>
              </span>
              <span className="w-10 text-center text-[11px]">
                {r.vote === "si" ? (
                  <span className="text-turf">Sí</span>
                ) : r.vote === "no" ? (
                  <span className="text-red-alert">No</span>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10.5px] leading-snug text-text-muted">
        &quot;Hoy&quot; = puntaje actual (classic). &quot;Nuevo&quot; = proyección con goles_v2
        sobre los partidos ya verificados. ▲ = sube puestos, ▼ = baja.
      </p>

      {/* Acciones */}
      {!applied ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={() => decide("apply")}
            className="flex-1 rounded-full bg-gold py-2.5 font-display text-[13px] tracking-[0.05em] text-bg-base transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            Aplicar nuevo sistema
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => decide("keep")}
            className="flex-1 rounded-full border border-border-subtle py-2.5 font-display text-[13px] tracking-[0.05em] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
          >
            Mantener actual
          </button>
        </div>
      ) : (
        <p className="pt-1 text-[12px] text-turf">
          Sistema goles_v2 aplicado a esta polla. Los puntos ya se recalcularon.
        </p>
      )}
    </section>
  );
}
