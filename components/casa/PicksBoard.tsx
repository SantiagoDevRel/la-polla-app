"use client";

// components/casa/PicksBoard.tsx — donde la gente marca.
//
// Modo 1X2: tres botones cuadrados por partido (LOCAL / EMPATE / VISITANTE),
// que es lo unico que pidio el owner. Modo marcador: dos inputs de goles.
//
// Bajo cada opcion va la barra con el porcentaje de la gente que eligio eso.
// Ese dato es la mitad de la gracia del producto ("¿cuántos pusieron 2-1?"),
// asi que se muestra SIEMPRE que haya al menos un pronostico cargado.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TeamCrest } from "@/components/match/TeamCrest";
import { Label, PctBar } from "@/components/street";
import { formatMatchTime } from "@/lib/casa/format";
import type { CasaDistribution, Pick1x2 } from "@/lib/casa/types";
import { canEditCasaMatch, hasCasaMatchStarted } from "@/lib/casa/match-rules";
import { MatchPicks } from "./MatchPicks";

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
  status: string;
  elapsed?: number | null;
  live_status_detail?: string | null;
  voided_at?: string | null;
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
  /** Participants and admins only; the group picks endpoint answers 403 to anyone else. */
  canViewOthers: boolean;
  lockedReason?: string;
}

const REFRESH_INTERVAL_MS = 30_000;
const REFRESH_LEAD_MS = 10 * 60_000;
const REFRESH_TAIL_MS = 3 * 60 * 60_000;
/** Browsers overflow timers longer than 2^31-1 ms; a longer wait re-evaluates on wake. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type RefreshTiming = Pick<MatchLite, "scheduled_at" | "status" | "final_verified_at" | "voided_at">;

function isPendingResult(match: RefreshTiming) {
  return !match.final_verified_at && !match.voided_at;
}

/**
 * A pending match needs live refreshes only while its result can change:
 * live, finished awaiting verification, or from 10 min before kickoff until
 * about 3 h after it. Outside that window the page stays still (free tier).
 */
export function isLiveRefreshWindow(match: RefreshTiming, now: number) {
  if (!isPendingResult(match)) return false;
  if (match.status === "live" || match.status === "finished") return true;
  const kickoff = Date.parse(match.scheduled_at);
  return Number.isFinite(kickoff) && now >= kickoff - REFRESH_LEAD_MS && now <= kickoff + REFRESH_TAIL_MS;
}

/** Milliseconds until the next pending match enters its refresh window, or null. */
export function msUntilNextRefreshWindow(matches: RefreshTiming[], now: number): number | null {
  let next: number | null = null;
  for (const match of matches) {
    if (!isPendingResult(match)) continue;
    const opensAt = Date.parse(match.scheduled_at) - REFRESH_LEAD_MS;
    if (Number.isFinite(opensAt) && opensAt > now && (next === null || opensAt < next)) next = opensAt;
  }
  return next === null ? null : next - now;
}

/** Nombre corto: "Manchester City FC" no entra en un boton de 110px. */
function corto(nombre: string): string {
  return nombre
    // Solo sufijos/prefijos societarios. "United" y "Club" NO se tocan:
    // sacarle el United a "Manchester United" lo deja como "Manchester",
    // que es exactamente el mismo nombre que el City abreviado.
    .replace(/\s+(FC|CF|AFC|SC|AC|SAD)$/i, "")
    .replace(/^(FC|CF|AFC|SC|AC)\s+/i, "")
    .trim();
}

/**
 * Las tres opciones de un partido. El label sale del EQUIPO, no de
 * "local/visitante": con los escudos chicos y dos nombres que uno no
 * distingue, decir "LOCAL" obliga a la persona a acordarse de cual era
 * cual — y ahi es donde marca el palo equivocado.
 */
function opcionesDe(m: { home_team: string; away_team: string }) {
  return [
    { key: "L" as Pick1x2, label: corto(m.home_team) },
    { key: "E" as Pick1x2, label: "Empate" },
    { key: "V" as Pick1x2, label: corto(m.away_team) },
  ];
}

export function PicksBoard({
  slug,
  scoringMode,
  matches,
  initialPicks,
  distribution,
  canEdit,
  canViewOthers,
  lockedReason,
}: Props) {
  const [picks, setPicks] = useState(initialPicks);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!matches.some(isPendingResult)) return;
    let interval: number | undefined;
    let wake: number | undefined;
    const inWindow = () => matches.some(match => isLiveRefreshWindow(match, Date.now()));
    const schedule = () => {
      window.clearInterval(interval);
      window.clearTimeout(wake);
      interval = wake = undefined;
      if (inWindow()) {
        interval = window.setInterval(() => {
          if (!inWindow()) { schedule(); return; }
          if (!document.hidden) router.refresh();
        }, REFRESH_INTERVAL_MS);
        return;
      }
      const wait = msUntilNextRefreshWindow(matches, Date.now());
      if (wait !== null) wake = window.setTimeout(schedule, Math.min(wait, MAX_TIMEOUT_MS));
    };
    const onVisibility = () => {
      if (document.hidden) return;
      schedule();
      if (inWindow()) router.refresh();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [matches, router]);

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
        .filter((m) => picks[m.id] && canEditCasaMatch(m))
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
        setMsg({ text: json.error ?? "No se pudo guardar.", bad: true });
        return;
      }
      setDirty(false);
      // No decir "quedaste con todo marcado" si faltan partidos: la persona
      // se iba tranquila y el domingo descubria que tenia 5 en blanco.
      const faltan = matches.length - marcados;
      setMsg({
        text: json.avisos?.length
          ? `Guardado. ${json.avisos[0]}`
          : faltan > 0
            ? `Guardado ${marcados} de ${matches.length}. Te faltan ${faltan}.`
            : "Guardado. No te falta ningún partido.",
        bad: faltan > 0,
      });
    } catch {
      setMsg({ text: "Error de conexión. Intenta de nuevo.", bad: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-app-update-blocked={dirty || saving}>
      <ul className="space-y-px">
        {matches.map((m) => {
          const cerrado = !canEditCasaMatch(m, now);
          const started = hasCasaMatchStarted(m, now);
          const editable = canEdit && !cerrado;
          const dist = started ? distribution.resultado?.[m.id] : undefined;
          const total = dist?.total ?? 0;
          const mine = picks[m.id];

          return (
            <li key={m.id} className="bg-bg-card p-4">
              {/* Encabezado del partido: hora + estado */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label>{formatMatchTime(m.scheduled_at)}</Label>
                {m.voided_at ? <span className="text-[13px] text-text-secondary">Anulado · 0 puntos</span> : m.final_verified_at ? (
                  <span className="lp-money text-[13px] text-text-primary">
                    {m.home_score}–{m.away_score}
                  </span>
                ) : cerrado ? (
                  <span className="lp-label text-red-alert">cerrado</span>
                ) : null}
              </div>

              {/* Equipos. Escudos y nombres en su propia fila para que el
                  text-zoom de accesibilidad no los aplaste (regla del repo). */}
              <div className="mb-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/futbol/equipos/home.${m.id}`} aria-label={`Ver equipo: ${m.home_team}`} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-bg-elevated"><TeamCrest team={m.home_team} src={m.home_team_flag} /></Link>
                  <span className="lp-label">vs</span>
                  <Link href={`/futbol/equipos/away.${m.id}`} aria-label={`Ver equipo: ${m.away_team}`} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-bg-elevated"><TeamCrest team={m.away_team} src={m.away_team_flag} /></Link>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-3 text-[14px] font-semibold text-text-primary">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{m.home_team}</span>
                  <span className="min-w-0 text-right [overflow-wrap:anywhere]">{m.away_team}</span>
                </div>
              </div>

              <Link href={`/futbol/partidos/${m.id}`} className="mb-3 flex min-h-11 items-center justify-center rounded-full border border-border-subtle px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-elevated">Ver partido y alineaciones</Link>

              {scoringMode === "1x2" ? (
                <div className="grid grid-cols-3 gap-px">
                  {opcionesDe(m).map((op) => {
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
              {started && scoringMode === "marcador" &&
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
                        ? `Nadie más eligió ${clave}.`
                        : `${n} de ${d.total} eligieron ${clave} (${Math.round((n / d.total) * 100)}%)`}
                    </p>
                  );
                })()}
              {started && canViewOthers && <MatchPicks slug={slug} matchId={m.id} scoringMode={scoringMode} home={m.home_team} away={m.away_team} />}
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
