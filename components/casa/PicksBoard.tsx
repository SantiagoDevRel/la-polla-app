"use client";

// components/casa/PicksBoard.tsx — donde la gente marca.
//
// (2026-09-16) Rediseño pedido por el dueño: volver a lo que teníamos en la
// polla vieja, «más minimalista, más pequeño pero funcional». Una tarjeta por
// partido, compacta: escudos y marcador en la MISMA fila, nombres debajo, y
// todo lo demás bajo demanda.
//   · Finalizados: desplegable cerrado, del más reciente al más viejo.
//   · En vivo: se están jugando (o cierran ya): se miran, no se editan.
//   · Próximos: por día, cada día abierto; acá se pronostica.
//   · «Ver pronósticos de otros»: cerrado por defecto y con scroll propio.
//
// Modo 1X2 antes del inicio conserva los tres botones que pidió el dueño el
// 2026-09-14 (escudo + nombre ES el botón, «Empate» en el medio). Modo marcador:
// dos casillas de goles entre los escudos, con auto-salto.
//
// Bajo cada opción 1X2 va la barra con el porcentaje de la gente que eligió
// eso; en marcador, «cuántos pusieron 2-1» queda visible bajo su botón.
//
// (2026-09-18) «Todo en una fila» (dueño). La tarjeta tenía cuatro pisos: hora y
// «Ver partido», escudos + marcador, nombres, y «Tu marcador». Ahora son dos:
//   · una línea fina con la hora/estado a la izquierda y, a la derecha, TU
//     pronóstico con sus puntos y la flecha al partido;
//   · el partido: [escudo + nombre] [marcador o casillas] [escudo + nombre].
// El nombre va DEBAJO de su escudo, dentro de su columna, y no al lado: así
// tiene todo el ancho de la columna para partir en dos líneas con texto
// ampliado, en vez de quedar en tres letras por renglón. El centro mide en px
// fijos y no crece con la fuente, que fue lo que rompió el intento de junio.
// Una tarjeta 1X2 pasó de 146 a ~100 px: 13 partidos caben en casi la mitad.

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TeamCrest } from "@/components/match/TeamCrest";
import { PctBar } from "@/components/street";
import { hasPick, liveMinuteLabel, pickLabel, pickOnTrack, shortTeam } from "@/lib/casa/live-status";
import { dayLabel, groupCasaMatchesByDay, type SectionMatch } from "@/lib/casa/picks-sections";
import type { CasaDistribution, Pick1x2 } from "@/lib/casa/types";
import { canEditCasaMatch, hasCasaMatchStarted } from "@/lib/casa/match-rules";
import { MatchPicks } from "./MatchPicks";
import { EntrarSheet } from "./EntrarSheet";
import { UnknownTeamCrest } from "./CampaignDecorations";

interface MatchLite extends SectionMatch {
  planned?: false;
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  scheduled_at_confirmed?: boolean;
  home_score: number | null;
  away_score: number | null;
  final_verified_at: string | null;
  status: string;
  elapsed?: number | null;
  live_status_detail?: string | null;
  voided_at?: string | null;
}

/** Planning slots have no fixture identity or kickoff and never become picks. */
export interface PlannedBoardMatch {
  slot_id: string;
  order: number;
  stage: "cuadrangulares" | "final";
  stage_label: string;
  group: "A" | "B" | null;
  matchday: number | null;
  leg: string | number | null;
  label: string;
  home_label: string;
  away_label: string;
  scheduled_at: null;
}

type PlannedMatchLite = Omit<MatchLite, "planned" | "scheduled_at"> & {
  planned: true;
  scheduled_at: null;
  planningLabel: string;
  groupLabel: string | null;
};
type BoardMatch = MatchLite | PlannedMatchLite;
type BoardGroup = { key: string; label: string; matches: BoardMatch[] };

function groupPlannedMatches(slots: PlannedBoardMatch[]): BoardGroup[] {
  const groups = new Map<string, BoardGroup>();
  for (const slot of [...slots].sort((a, b) => a.order - b.order)) {
    const key = slot.stage === "final" ? slot.slot_id : `${slot.stage}-${slot.matchday}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: slot.stage === "final" ? slot.label : `${slot.stage_label} · Fecha ${slot.matchday}`,
        matches: [],
      });
    }
    groups.get(key)!.matches.push({
      planned: true,
      id: slot.slot_id,
      home_team: slot.home_label,
      away_team: slot.away_label,
      home_team_flag: null,
      away_team_flag: null,
      scheduled_at: null,
      scheduled_at_confirmed: false,
      home_score: null,
      away_score: null,
      final_verified_at: null,
      status: "planned",
      planningLabel: slot.label,
      groupLabel: slot.group ? `Grupo ${slot.group}` : null,
    });
  }
  return [...groups.values()];
}

export interface BoardPick {
  pick1x2: Pick1x2 | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Puntos ya calculados en SQL para ese pronóstico (0 hasta que se verifique). */
  pointsEarned?: number | null;
}

interface Props {
  slug: string;
  /** Participación que se está editando (migración 131). Sin número = la principal. */
  entryNumber?: number | null;
  scoringMode: "1x2" | "marcador";
  matches: MatchLite[];
  /** Presence selects a static draft: no payments, predictions, stats or refreshes. */
  plannedMatches?: PlannedBoardMatch[];
  /** picks actuales del usuario, indexados por match_id */
  initialPicks: Record<string, BoardPick>;
  distribution: CasaDistribution;
  /** false = ya cerro, o el usuario todavia no se inscribio */
  canEdit: boolean;
  /** Participants, admins and public closed pollas; the group picks endpoint answers 403 to anyone else. */
  canViewOthers: boolean;
  /** false = espectador de una polla cerrada pública: sin la línea «Tu pronóstico». */
  showMine?: boolean;
  lockedReason?: string;
  /**
   * (2026-09-18) Quien todavía no está inscrito sí puede TOCAR un partido: en
   * vez de un botón muerto, sube la hoja «paga para guardar tu pronóstico».
   * El bloqueo va después de mirar, no al entrar.
   */
  joinPrompt?: { href: string; entryPriceCop: number };
}

const REFRESH_INTERVAL_MS = 30_000;
const REFRESH_LEAD_MS = 10 * 60_000;
const REFRESH_TAIL_MS = 3 * 60 * 60_000;
/** Browsers overflow timers longer than 2^31-1 ms; a longer wait re-evaluates on wake. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type RefreshTiming = Pick<MatchLite, "scheduled_at" | "status" | "final_verified_at" | "voided_at">;

function isPendingResult(match: Pick<RefreshTiming, "final_verified_at" | "voided_at">) {
  return !match.final_verified_at && !match.voided_at;
}

/** A refresh preserves drafts, but a verified result must show the saved pick and fresh SQL points. */
export function pickForDisplay(match: Pick<RefreshTiming, "final_verified_at" | "voided_at">, draft: BoardPick | undefined, saved: BoardPick | undefined) {
  return isPendingResult(match) ? draft : saved;
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

/**
 * Las tres opciones de un partido. El label sale del EQUIPO, no de
 * "local/visitante": con los escudos chicos y dos nombres que uno no
 * distingue, decir "LOCAL" obliga a la persona a acordarse de cual era
 * cual — y ahi es donde marca el palo equivocado.
 */
function opcionesDe(m: { home_team: string; away_team: string }) {
  return [
    { key: "L" as Pick1x2, label: shortTeam(m.home_team) },
    { key: "E" as Pick1x2, label: "Empate" },
    { key: "V" as Pick1x2, label: shortTeam(m.away_team) },
  ];
}

/** Solo la hora: el día ya lo dice el encabezado del grupo. */
function horaDe(m: BoardMatch): string {
  if (m.planned) return "Fecha por confirmar";
  if (m.scheduled_at_confirmed === false) return "Hora por confirmar";
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(m.scheduled_at));
}

export function PicksBoard({
  slug,
  entryNumber,
  scoringMode,
  matches,
  plannedMatches,
  initialPicks,
  distribution,
  canEdit,
  canViewOthers,
  showMine = true,
  lockedReason,
  joinPrompt,
}: Props) {
  const planning = plannedMatches !== undefined;
  const [picks, setPicks] = useState(initialPicks);
  const [joinOpen, setJoinOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  useEffect(() => {
    if (planning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [planning]);
  useEffect(() => {
    if (planning || !matches.some(isPendingResult)) return;
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
  }, [matches, planning, router]);

  // Orden de empezada, siempre. El estado (en vivo, final, anulado) se pinta
  // dentro de la tarjeta: ningún partido cambia de lugar por haber arrancado.
  const dias = useMemo<BoardGroup[]>(
    () => plannedMatches !== undefined ? groupPlannedMatches(plannedMatches) : groupCasaMatchesByDay(matches, now),
    [matches, now, plannedMatches],
  );
  const baseId = useId();
  const [closedDays, setClosedDays] = useState<Set<string>>(() => new Set());
  const ordenCompleto = useMemo(() => dias.flatMap((group) => group.matches), [dias]);

  const marcados = useMemo(
    () => matches.filter((m) => hasPick(scoringMode, picks[m.id])).length,
    [picks, matches, scoringMode],
  );

  function set1x2(matchId: string, value: Pick1x2) {
    if (planning) return;
    setPicks((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], pick1x2: value, homeScore: null, awayScore: null },
    }));
    setDirty(true);
    setMsg(null);
  }

  function setScore(matchId: string, side: "home" | "away", raw: string) {
    if (planning) return;
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

  /** Auto-jump: local → visitante → local del próximo partido editable; al final cierra el teclado. */
  function saltarDesde(matchId: string, side: "home" | "away") {
    if (side === "home") {
      inputs.current.get(`${matchId}:away`)?.focus();
      return;
    }
    const idx = ordenCompleto.findIndex((m) => m.id === matchId);
    const siguiente = ordenCompleto.slice(idx + 1).map((m) => inputs.current.get(`${m.id}:home`)).find((el) => el && !el.disabled);
    if (siguiente) siguiente.focus();
    else inputs.current.get(`${matchId}:away`)?.blur();
  }

  function toggleDay(key: string) {
    setClosedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function guardar() {
    if (planning) return;
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
        body: JSON.stringify(entryNumber ? { picks: payload, entryNumber } : { picks: payload }),
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

  const renderCard = (m: BoardMatch, showDay: boolean) => (
    <MatchCard
      key={m.id}
      m={m}
      now={now}
      slug={slug}
      scoringMode={scoringMode}
      mine={planning ? undefined : pickForDisplay(m, picks[m.id], initialPicks[m.id])}
      distribution={distribution}
      canEdit={!planning && canEdit}
      canViewOthers={!planning && canViewOthers}
      showMine={!planning && showMine}
      showDay={showDay}
      onBlocked={!planning && joinPrompt ? () => setJoinOpen(true) : undefined}
      inputs={inputs}
      onPick1x2={set1x2}
      onScore={setScore}
      onJump={saltarDesde}
    />
  );

  return (
    <div data-app-update-blocked={dirty || saving} className="space-y-4">
      {/* ── Los partidos, en orden de empezada ───────────────────────────
          Un solo recorrido, de arriba abajo. El día es apenas un separador;
          dentro de cada uno el orden es la hora de inicio y no cambia nunca. */}
      {dias.length > 0 && (
        <section className="space-y-3">
          {dias.map((group) => {
            const open = !closedDays.has(group.key);
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggleDay(group.key)}
                  aria-expanded={open}
                  aria-controls={`${baseId}-dia-${group.key}`}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-1 text-left"
                >
                  <span className="text-[13px] font-semibold text-text-primary">
                    {group.label}
                    <span className="ml-1.5 font-normal text-text-muted">· {group.matches.length}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <div id={`${baseId}-dia-${group.key}`} className="mt-1 space-y-2">{group.matches.map((m) => renderCard(m, false))}</div>}
              </div>
            );
          })}
        </section>
      )}

      {/* Barra de guardado: pegada abajo, encima del nav. (2026-09-18) Solo
          cuando hay cambios o un mensaje: un «Guardado 13/13» fijo tapaba 120 px
          de partidos sin pedir nada. Lo que falta ya lo dice la franja roja. */}
      {!planning && canEdit && (dirty || saving || msg) && (
        <div className="sticky bottom-[88px] z-20 -mx-4 border-t border-border-default bg-bg-base px-4 pb-3 pt-3">
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

      {!planning && !canEdit && lockedReason && (
        // Con la polla abierta esto deja de ser un cartel y pasa a ser la
        // puerta: antes decía «Inscríbete para pronosticar» sin nada que tocar.
        joinPrompt ? (
          <div className="border border-border-default bg-bg-elevated p-3 text-center">
            <p className="text-[13px] text-text-secondary">{lockedReason}</p>
            <Link href={joinPrompt.href} className="lp-btn lp-btn-primary mt-3 w-full !px-4">
              Pagar la entrada y pronosticar
            </Link>
          </div>
        ) : (
          <p className="border border-border-default bg-bg-elevated p-3 text-center text-[12px] text-text-secondary">
            {lockedReason}
          </p>
        )
      )}

      {!planning && joinPrompt && (
        <EntrarSheet open={joinOpen} onClose={() => setJoinOpen(false)} href={joinPrompt.href} entryPriceCop={joinPrompt.entryPriceCop} slug={slug} />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   MatchCard — una tarjeta compacta por partido.
   Fila 1: hora/estado a la izquierda, «Ver partido» a la derecha.
   Fila 2: escudo · marcador (o casillas) · escudo. Solo anchos fijos, para
           que el texto ampliado no aplaste nada.
   Fila 3: nombres, mitad y mitad, sin recorte.
   Fila 4 (desde el inicio): «Tu marcador» y el desplegable de los demás.
   ──────────────────────────────────────────────────────────────────────── */
function MatchCard({
  m, now, slug, scoringMode, mine, distribution, canEdit, canViewOthers, showMine, showDay, inputs, onPick1x2, onScore, onJump, onBlocked,
}: {
  m: BoardMatch;
  now: number;
  slug: string;
  scoringMode: "1x2" | "marcador";
  mine: BoardPick | undefined;
  distribution: CasaDistribution;
  canEdit: boolean;
  canViewOthers: boolean;
  showMine: boolean;
  /** En Finalizados y En vivo no hay encabezado de día: la tarjeta lo dice. */
  showDay: boolean;
  inputs: React.MutableRefObject<Map<string, HTMLInputElement | null>>;
  onPick1x2: (matchId: string, value: Pick1x2) => void;
  onScore: (matchId: string, side: "home" | "away", raw: string) => void;
  onJump: (matchId: string, side: "home" | "away") => void;
  /** Sin inscripción: tocar un partido abre la hoja de pago en vez de no hacer nada. */
  onBlocked?: () => void;
}) {
  const cerrado = !m.planned && !canEditCasaMatch(m, now);
  const started = !m.planned && hasCasaMatchStarted(m, now);
  const editable = !m.planned && canEdit && !cerrado;
  // Se puede tocar aunque no esté inscrito: el toque abre la hoja de pago.
  const invitando = !m.planned && !canEdit && !cerrado && Boolean(onBlocked);
  const live = m.status === "live";
  const voided = Boolean(m.voided_at);
  const scored = Boolean(m.final_verified_at) || voided;
  const finished = scored || m.status === "finished";
  // 1X2 reparte por L/E/V; marcador, por «2-1». El total es cuántos pronosticaron.
  const dist = started && scoringMode === "1x2" ? distribution.resultado?.[m.id] : undefined;
  const total = (started ? (scoringMode === "1x2" ? dist?.total : distribution.marcador?.[m.id]?.total) : 0) ?? 0;
  const tengoPick = hasPick(scoringMode, mine);
  const label = pickLabel(scoringMode, mine, m.home_team, m.away_team);
  const points = scored ? mine?.pointsEarned ?? 0 : null;
  const onTrack = live ? pickOnTrack(scoringMode, mine, { home: m.home_score, away: m.away_score }) : null;
  const marcadorDist = scoringMode === "marcador" && started && tengoPick ? distribution.marcador?.[m.id] : undefined;
  const clave = `${mine?.homeScore}-${mine?.awayScore}`;
  const summary = marcadorDist?.total
    ? (marcadorDist.conteo?.[clave] ?? 0) === 0
      ? `Nadie más puso ${clave}.`
      : `${marcadorDist.conteo?.[clave]} de ${marcadorDist.total} pusieron ${clave} (${Math.round(((marcadorDist.conteo?.[clave] ?? 0) / marcadorDist.total) * 100)}%).`
    : null;
  const minute = !m.planned && live ? liveMinuteLabel(m) : "";
  // Pasó la hora de inicio y la fuente todavía no reporta el partido: se dice, no se muestran guiones sueltos.
  const waiting = !m.planned && !started && !finished && !voided && Date.parse(m.scheduled_at) <= now;
  const showButtons1x2 = scoringMode === "1x2" && !started && !finished;

  const estado = m.planned ? (
    <span className="text-text-muted">{m.groupLabel ? `${m.groupLabel} · ` : ""}Fecha por confirmar</span>
  ) : voided ? (
    <span className="text-text-muted">Anulado · 0 puntos</span>
  ) : live ? (
    <span className="flex items-center gap-1.5 text-red-alert">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-alert motion-safe:animate-pulse" />
      Vivo{minute ? ` · ${minute}` : ""}
    </span>
  ) : finished ? (
    <span className="text-text-muted">Final{!scored ? " · verificando" : ""}{showDay ? ` · ${dayLabel(m.scheduled_at, now)}` : ""}</span>
  ) : waiting ? (
    <span className="text-amber">Esperando datos · {horaDe(m)}</span>
  ) : (
    <span className="text-text-muted">{showDay ? `${dayLabel(m.scheduled_at, now)} · ${horaDe(m)}` : horaDe(m)}</span>
  );

  // Medidas en px fijos a propósito: el tamaño de texto de la app escala los
  // rem, y un centro que crece aplasta los nombres (ver la cabecera).
  const cell = (value: number | null) => (
    <span className="lp-money grid h-[44px] w-[34px] shrink-0 place-items-center overflow-hidden text-[28px] text-text-primary [-webkit-text-size-adjust:none]">
      {started || finished ? value ?? "–" : "–"}
    </span>
  );
  const dash = <span aria-hidden="true" className="h-[2px] w-[10px] shrink-0 bg-border-strong" />;

  /** Escudo con el nombre debajo; toca el equipo. */
  const side = (which: "home" | "away") => {
    const name = which === "home" ? m.home_team : m.away_team;
    const flag = which === "home" ? m.home_team_flag : m.away_team_flag;
    if (m.planned) return (
      <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-md py-0.5 text-center">
        <UnknownTeamCrest className="h-[28px] w-[28px]" />
        <span className="w-full text-[13px] font-semibold leading-tight text-text-primary [overflow-wrap:anywhere]">{shortTeam(name)}</span>
      </div>
    );
    return (
      <Link href={`/futbol/equipos/${which}.${m.id}`} aria-label={`Ver equipo: ${name}`} className="flex min-w-0 flex-col items-center gap-0.5 rounded-md py-0.5 text-center transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
        <TeamCrest team={name} src={flag} className="h-[28px] w-[28px] max-w-none shrink-0" />
        {/* Sin recorte a propósito: con texto ampliado un nombre largo parte en dos líneas. */}
        <span className="w-full text-[13px] font-semibold leading-tight text-text-primary [overflow-wrap:anywhere]">{shortTeam(name)}</span>
      </Link>
    );
  };

  // Tu pronóstico y sus puntos, desde que el partido cierra: van en la línea de
  // arriba, a la derecha, y no en un piso propio.
  const showMineInline = showMine && (started || cerrado || finished) && !showButtons1x2;

  return (
    <article className={`lp-card lp-match relative px-[12px] py-[10px] ${voided ? "opacity-70" : ""}`} aria-label={m.planned ? m.planningLabel : `${m.home_team} contra ${m.away_team}`}>
      {/* La flecha al partido va fuera del flujo (esquina): su área de toque
          de 32 px no le suma alto a la línea. */}
      <div className="flex min-h-[20px] flex-wrap items-center justify-between gap-x-2 pr-[28px]">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] font-semibold uppercase tracking-[0.08em]">
          {estado}
          {editable && !tengoPick && (
            <span className="rounded-md border border-red-alert/40 bg-red-alert/15 px-1.5 py-0.5 text-[10px] text-red-alert">Falta</span>
          )}
          {cerrado && !started && !finished && !voided && !waiting && <span className="text-red-alert">Cerrado</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {showMineInline && (
            <span className="flex items-center gap-1.5 text-[13px]">
              <span className="text-text-secondary">Tú</span>
              <span className={`font-semibold ${!tengoPick ? "text-text-muted" : onTrack || (points ?? 0) > 0 ? "text-turf" : "text-text-primary"}`}>
                {label ?? "sin pronóstico"}
              </span>
              {points != null && tengoPick && (
                // (2026-09-17) Los aciertos en verde y los 0 pts en amarillo, fáciles de leer.
                <span className={`lp-money rounded-md px-1.5 text-[14px] ${points > 0 ? "bg-turf/15 text-turf" : "bg-amber/15 text-amber"}`}>
                  {points > 0 ? `+${points}` : "0"}<span className="sr-only"> puntos</span>
                </span>
              )}
            </span>
          )}
          {!m.planned && <Link href={`/futbol/partidos/${m.id}`} aria-label={`Ver partido: ${m.home_team} contra ${m.away_team}`} title="Ver partido"
            className="absolute right-[4px] top-[4px] grid h-[32px] w-[32px] place-items-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
            <ChevronRight aria-hidden="true" className="h-[16px] w-[16px] max-w-none" />
          </Link>}
        </span>
      </div>

      {showButtons1x2 ? (
        /* (2026-09-14) Pedido del dueño: el escudo con el nombre debajo ES el
           botón de cada equipo y «Empate» ocupa el lugar del «vs». Columnas con
           minmax(0,1fr): con texto ampliado el nombre baja de línea. */
        <div role="group" aria-label={`Tu pronóstico: ${m.home_team} contra ${m.away_team}`} className={`mt-1 grid gap-[8px] ${m.planned ? "grid-cols-3" : "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"}`}>
          {opcionesDe(m).map((op) => {
            const elegido = mine?.pick1x2 === op.key;
            const equipo = op.key === "L" ? { name: m.home_team, flag: m.home_team_flag } : op.key === "V" ? { name: m.away_team, flag: m.away_team_flag } : null;
            return (
              <button
                key={op.key}
                type="button"
                disabled={!editable && !invitando}
                onClick={() => (invitando ? onBlocked?.() : onPick1x2(m.id, op.key))}
                aria-pressed={elegido}
                aria-label={equipo ? `Gana ${equipo.name}` : "Empate"}
                className={[
                  "flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-1.5 text-center transition-colors",
                  equipo || m.planned ? "" : "px-3",
                  elegido
                    ? "border-gold bg-gold/15 text-gold"
                    : editable || invitando
                      ? "border-border-default bg-bg-elevated text-text-primary hover:border-gold/30"
                      : "border-border-subtle text-text-primary",
                  editable || invitando ? "cursor-pointer" : "cursor-default",
                ].join(" ")}
              >
                {equipo ? (
                  <>
                    {m.planned
                      ? <UnknownTeamCrest className="h-[28px] w-[28px]" />
                      : <TeamCrest team={equipo.name} src={equipo.flag} className="h-[28px] w-[28px] max-w-none shrink-0" />}
                    <span className="w-full text-[13px] font-semibold leading-tight [overflow-wrap:anywhere]">{op.label}</span>
                  </>
                ) : (
                  <span className="max-w-full text-[13px] font-semibold [overflow-wrap:anywhere]">Empate</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="lp-match-row mt-1">
          {side("home")}
          <div className="lp-match-center">
            {invitando && scoringMode === "marcador" ? (
              // Casillas que invitan a pagar: el toque abre la hoja, no edita.
              <button
                type="button"
                onClick={() => onBlocked?.()}
                aria-label="Pagar la entrada para pronosticar"
                className="lp-money flex h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-3 text-[22px] text-text-muted transition-colors hover:border-gold/30"
              >
                <span>–</span>{dash}<span>–</span>
              </button>
            ) : editable && scoringMode === "marcador" ? (
              (["home", "away"] as const).map((sideKey, i) => (
                <Fragment key={sideKey}>
                  {i === 1 && dash}
                  <input
                    ref={(el) => { inputs.current.set(`${m.id}:${sideKey}`, el); }}
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="next"
                    min={0}
                    max={30}
                    value={(sideKey === "home" ? mine?.homeScore : mine?.awayScore) ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      onScore(m.id, sideKey, e.target.value);
                      // Un dígito completa la casilla: salta a la siguiente.
                      // Para 10 o más, se vuelve a tocar la casilla y se agrega el segundo.
                      if (e.target.value.length === 1) onJump(m.id, sideKey);
                    }}
                    aria-label={`Goles de ${sideKey === "home" ? m.home_team : m.away_team}`}
                    className={`lp-input lp-money !h-[44px] !w-[44px] shrink-0 !px-0 text-center text-[22px] [-webkit-text-size-adjust:none] ${!tengoPick ? "!border-red-alert/60" : ""}`}
                  />
                </Fragment>
              ))
            ) : (
              <>
                {cell(m.home_score)}
                {dash}
                {cell(m.away_score)}
              </>
            )}
          </div>
          {side("away")}
        </div>
      )}

      {/* Porcentajes 1X2 una vez empezado: una barra por opción, sin repetir botones. */}
      {scoringMode === "1x2" && started && total > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {opcionesDe(m).map((op) => {
            const n = dist?.conteo?.[op.key] ?? 0;
            const pct = total > 0 ? (n / total) * 100 : 0;
            return (
              <div key={op.key} className="min-w-0">
                <PctBar pct={pct} showValue={false} />
                <span className="mt-0.5 block text-center text-[11px] leading-tight text-text-muted [overflow-wrap:anywhere]">
                  <span className="lp-money">{Math.round(pct)}%</span> {op.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {started && canViewOthers && (
        <MatchPicks slug={slug} matchId={m.id} scoringMode={scoringMode} home={m.home_team} away={m.away_team} count={total || null} summary={summary}
          resultRevision={`${m.final_verified_at ?? ""}:${m.voided_at ?? ""}:${scored ? `${m.home_score ?? ""}:${m.away_score ?? ""}` : ""}`} />
      )}
    </article>
  );
}
