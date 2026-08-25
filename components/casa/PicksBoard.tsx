"use client";

// components/casa/PicksBoard.tsx — donde la gente marca.
//
// Modo 1X2: tres botones cuadrados por partido (LOCAL / EMPATE / VISITANTE),
// que es lo unico que pidio el owner. Modo marcador: dos inputs de goles.
//
// Bajo cada opcion va la barra con el porcentaje de la gente que eligio eso.
// Ese dato es la mitad de la gracia del producto ("¿cuántos pusieron 2-1?"),
// asi que se muestra SIEMPRE que haya al menos un pronostico cargado.

import { useMemo, useState } from "react";
import Image from "next/image";
import { Label, PctBar } from "@/components/street";
import { formatMatchTime } from "@/lib/casa/format";
import type { CasaDistribution, Pick1x2 } from "@/lib/casa/types";

interface MatchLite {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  home_score: number | null;
  away_score: number | null;
  final_verified_at: string | null;
}

interface Props {
  slug: string;
  scoringMode: "1x2" | "marcador";
  matches: MatchLite[];
  /** picks actuales del usuario, indexados por match_id */
  initialPicks: Record<
    string,
    { pick1x2: Pick1x2 | null; homeScore: number | null; awayScore: number | null }
  >;
  distribution: CasaDistribution;
  /** false = ya cerro, o el usuario todavia no se inscribio */
  canEdit: boolean;
  lockedReason?: string;
}

const OPCIONES: { key: Pick1x2; label: string }[] = [
  { key: "L", label: "LOCAL" },
  { key: "E", label: "EMPATE" },
  { key: "V", label: "VISITA" },
];

/** 5 minutos antes del pitazo se traba, igual que el resto del repo. */
const LOCK_MS = 5 * 60_000;

export function PicksBoard({
  slug,
  scoringMode,
  matches,
  initialPicks,
  distribution,
  canEdit,
  lockedReason,
}: Props) {
  const [picks, setPicks] = useState(initialPicks);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);

  const marcados = useMemo(
    () =>
      matches.filter((m) => {
        const p = picks[m.id];
        if (!p) return false;
        return scoringMode === "1x2"
          ? p.pick1x2 != null
          : p.homeScore != null && p.awayScore != null;
      }).length,
    [picks, matches, scoringMode],
  );

  function set1x2(matchId: string, value: Pick1x2) {
    setPicks((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], pick1x2: value, homeScore: null, awayScore: null },
    }));
    setDirty(true);
    setMsg(null);
  }

  function setScore(matchId: string, side: "home" | "away", raw: string) {
    const n = raw === "" ? null : Math.max(0, Math.min(30, Number(raw)));
    setPicks((prev) => ({
      ...prev,
      [matchId]: {
        pick1x2: null,
        homeScore: side === "home" ? n : (prev[matchId]?.homeScore ?? null),
        awayScore: side === "away" ? n : (prev[matchId]?.awayScore ?? null),
      },
    }));
    setDirty(true);
    setMsg(null);
  }

  async function guardar() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = matches
        .filter((m) => picks[m.id])
        .map((m) => ({
          matchId: m.id,
          pick1x2: picks[m.id]?.pick1x2 ?? null,
          homeScore: picks[m.id]?.homeScore ?? null,
          awayScore: picks[m.id]?.awayScore ?? null,
        }));

      const res = await fetch(`/api/casa/pollas/${slug}/picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks: payload }),
      });
      const json = await res.json();

      if (!res.ok) {
        setMsg({ text: json.error ?? "No pude guardar.", bad: true });
        return;
      }
      setDirty(false);
      setMsg({
        text: json.avisos?.length
          ? `Guardado. ${json.avisos[0]}`
          : "Guardado, quedaste con todo marcado.",
      });
    } catch {
      setMsg({ text: "Se cayó la conexión. Prueba otra vez.", bad: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ul className="space-y-px">
        {matches.map((m) => {
          const cerrado =
            new Date(m.scheduled_at).getTime() - LOCK_MS <= Date.now();
          const editable = canEdit && !cerrado;
          const dist = distribution.resultado?.[m.id];
          const total = dist?.total ?? 0;
          const mine = picks[m.id];

          return (
            <li key={m.id} className="bg-bg-card p-4">
              {/* Encabezado del partido: hora + estado */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label>{formatMatchTime(m.scheduled_at)}</Label>
                {m.final_verified_at ? (
                  <span className="lp-money text-[13px] text-text-primary">
                    {m.home_score}–{m.away_score}
                  </span>
                ) : cerrado ? (
                  <span className="lp-label text-red-alert">cerrado</span>
                ) : null}
              </div>

              {/* Equipos. Escudos y nombres en su propia fila para que el
                  text-zoom de accesibilidad no los aplaste (regla del repo). */}
              <div className="mb-3 flex items-center gap-2">
                <TeamFlag src={m.home_team_flag} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-primary">
                  {m.home_team}
                </span>
                <span className="lp-label shrink-0">vs</span>
                <span className="min-w-0 flex-1 truncate text-right text-[14px] font-semibold text-text-primary">
                  {m.away_team}
                </span>
                <TeamFlag src={m.away_team_flag} />
              </div>

              {scoringMode === "1x2" ? (
                <div className="grid grid-cols-3 gap-px">
                  {OPCIONES.map((op) => {
                    const elegido = mine?.pick1x2 === op.key;
                    const n = dist?.conteo?.[op.key] ?? 0;
                    const pct = total > 0 ? (n / total) * 100 : 0;
                    return (
                      <div key={op.key}>
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => set1x2(m.id, op.key)}
                          aria-pressed={elegido}
                          className={[
                            "lp-btn w-full text-[13px]",
                            elegido
                              ? "lp-btn-primary"
                              : "lp-btn-ghost bg-bg-elevated",
                            !editable ? "cursor-not-allowed opacity-45" : "",
                          ].join(" ")}
                        >
                          {op.label}
                        </button>
                        {total > 0 && (
                          <PctBar pct={pct} showValue={false} className="mt-1.5" />
                        )}
                        {total > 0 && (
                          <span className="lp-money mt-1 block text-center text-[10px] text-text-muted">
                            {Math.round(pct)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    disabled={!editable}
                    value={mine?.homeScore ?? ""}
                    onChange={(e) => setScore(m.id, "home", e.target.value)}
                    aria-label={`Goles de ${m.home_team}`}
                    className="lp-input lp-money h-[52px] w-[64px] text-center text-[22px]"
                  />
                  <span className="h-[2px] w-3 bg-border-strong" aria-hidden />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    disabled={!editable}
                    value={mine?.awayScore ?? ""}
                    onChange={(e) => setScore(m.id, "away", e.target.value)}
                    aria-label={`Goles de ${m.away_team}`}
                    className="lp-input lp-money h-[52px] w-[64px] text-center text-[22px]"
                  />
                </div>
              )}

              {/* "cuántos pusieron este marcador" — solo en modo marcador */}
              {scoringMode === "marcador" &&
                mine?.homeScore != null &&
                mine?.awayScore != null &&
                (() => {
                  const d = distribution.marcador?.[m.id];
                  const clave = `${mine.homeScore}-${mine.awayScore}`;
                  const n = d?.conteo?.[clave] ?? 0;
                  if (!d?.total) return null;
                  return (
                    <p className="mt-3 text-center text-[11px] text-text-muted">
                      {n === 0
                        ? `Nadie más puso ${clave}.`
                        : `${n} de ${d.total} pusieron ${clave} (${Math.round((n / d.total) * 100)}%)`}
                    </p>
                  );
                })()}
            </li>
          );
        })}
      </ul>

      {/* Barra de guardado: pegada abajo, encima del nav. */}
      {canEdit && (
        <div className="sticky bottom-[88px] z-20 mt-4 border-t border-border-default bg-bg-base px-4 pb-3 pt-3">
          {msg && (
            <p
              className={`mb-2 border p-2 text-center text-[12px] ${
                msg.bad
                  ? "border-red-alert/40 bg-red-alert/10 text-red-alert"
                  : "border-turf/40 bg-turf/10 text-turf"
              }`}
            >
              {msg.text}
            </p>
          )}
          <button
            type="button"
            onClick={guardar}
            disabled={saving || !dirty}
            className="lp-btn lp-btn-primary w-full"
          >
            {saving
              ? "Guardando..."
              : dirty
                ? `Guardar (${marcados}/${matches.length})`
                : `Guardado ${marcados}/${matches.length}`}
          </button>
        </div>
      )}

      {!canEdit && lockedReason && (
        <p className="mt-4 border border-border-default bg-bg-elevated p-3 text-center text-[12px] text-text-secondary">
          {lockedReason}
        </p>
      )}
    </div>
  );
}

function TeamFlag({ src }: { src: string | null }) {
  if (!src) {
    return <span className="h-6 w-6 shrink-0 bg-bg-elevated" aria-hidden />;
  }
  return (
    <Image
      src={src}
      alt=""
      width={24}
      height={24}
      unoptimized
      className="h-6 w-6 max-w-none shrink-0 object-contain"
    />
  );
}
