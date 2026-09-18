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
// eso; en marcador, «cuántos pusieron 2-1» vive dentro del desplegable.

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Clock3, Lock } from "lucide-react";
import { TeamCrest } from "@/components/match/TeamCrest";
import { PctBar } from "@/components/street";
import { hasPick, liveMinuteLabel, pickLabel, pickOnTrack, shortTeam } from "@/lib/casa/live-status";
import { dayLabel, partitionCasaMatches, type SectionMatch } from "@/lib/casa/picks-sections";
import type { CasaDistribution, Pick1x2 } from "@/lib/casa/types";
import { canEditCasaMatch, hasCasaMatchStarted } from "@/lib/casa/match-rules";
import { MatchPicks } from "./MatchPicks";
import { EntrarSheet } from "./EntrarSheet";

interface MatchLite extends SectionMatch {
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
function horaDe(m: MatchLite): string {
  if (m.scheduled_at_confirmed === false) return "Hora por confirmar";
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(m.scheduled_at));
}

export function PicksBoard({
  slug,
  entryNumber,
  scoringMode,
  matches,
  initialPicks,
  distribution,
  canEdit,
  canViewOthers,
  showMine = true,
  lockedReason,
  joinPrompt,
}: Props) {
  const [picks, setPicks] = useState(initialPicks);
  const [joinOpen, setJoinOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
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

  const sections = useMemo(() => partitionCasaMatches(matches, now), [matches, now]);
  // Con todo terminado (polla resuelta) no tiene sentido esconder la única lista.
  const [finishedOpen, setFinishedOpen] = useState(() => sections.live.length + sections.upcoming.length === 0);
  // (2026-09-17) «En vivo» también se pliega; empieza abierta.
  const [liveOpen, setLiveOpen] = useState(true);
  const baseId = useId();
  const [closedDays, setClosedDays] = useState<Set<string>>(() => new Set());
  const upcomingOrder = useMemo(() => sections.upcoming.flatMap((group) => group.matches), [sections]);

  const marcados = useMemo(
    () => matches.filter((m) => hasPick(scoringMode, picks[m.id])).length,
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

  /** Auto-jump: local → visitante → local del próximo partido editable; al final cierra el teclado. */
  function saltarDesde(matchId: string, side: "home" | "away") {
    if (side === "home") {
      inputs.current.get(`${matchId}:away`)?.focus();
      return;
    }
    const idx = upcomingOrder.findIndex((m) => m.id === matchId);
    const siguiente = upcomingOrder.slice(idx + 1).map((m) => inputs.current.get(`${m.id}:home`)).find((el) => el && !el.disabled);
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

  const renderCard = (m: MatchLite, showDay: boolean) => (
    <MatchCard
      key={m.id}
      m={m}
      now={now}
      slug={slug}
      scoringMode={scoringMode}
      mine={picks[m.id]}
      distribution={distribution}
      canEdit={canEdit}
      canViewOthers={canViewOthers}
      showMine={showMine}
      showDay={showDay}
      onBlocked={joinPrompt ? () => setJoinOpen(true) : undefined}
      inputs={inputs}
      onPick1x2={set1x2}
      onScore={setScore}
      onJump={saltarDesde}
    />
  );

  return (
    <div data-app-update-blocked={dirty || saving} className="space-y-4">
      {/* ── Finalizados — cerrado por defecto ─────────────────────────── */}
      {sections.finished.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setFinishedOpen((value) => !value)}
            aria-expanded={finishedOpen}
            aria-controls={`${baseId}-finalizados`}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-1 text-left"
          >
            <span className="lp-label flex items-center gap-2 !text-[12px] text-text-secondary">
              <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              Finalizados · {sections.finished.length}
            </span>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200 ${finishedOpen ? "rotate-180" : ""}`} />
          </button>
          {finishedOpen && <div id={`${baseId}-finalizados`} className="mt-1 space-y-2">{sections.finished.map((m) => renderCard(m, true))}</div>}
        </section>
      )}

      {/* ── En vivo — se mira, no se edita. Abierto por defecto, se pliega. ── */}
      {sections.live.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setLiveOpen((value) => !value)}
            aria-expanded={liveOpen}
            aria-controls={`${baseId}-envivo`}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-1 text-left"
          >
            <span className="lp-label flex items-center gap-2 !text-[12px] text-text-secondary">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-alert motion-safe:animate-pulse" />
              En vivo · {sections.live.length}
            </span>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200 ${liveOpen ? "rotate-180" : ""}`} />
          </button>
          {liveOpen && <div id={`${baseId}-envivo`} className="mt-1 space-y-2">{sections.live.map((m) => renderCard(m, true))}</div>}
        </section>
      )}

      {/* ── Próximos — por día, abiertos ──────────────────────────────── */}
      {upcomingOrder.length > 0 && (
        <section className="space-y-3">
          <h3 className="lp-label flex min-h-11 items-center gap-2 px-1 !text-[12px] text-text-secondary">
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-gold" />
            Próximos · {upcomingOrder.length}
          </h3>
          {sections.upcoming.map((group) => {
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

      {/* Barra de guardado: pegada abajo, encima del nav. */}
      {canEdit && (
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

      {!canEdit && lockedReason && (
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

      {joinPrompt && (
        <EntrarSheet open={joinOpen} onClose={() => setJoinOpen(false)} href={joinPrompt.href} entryPriceCop={joinPrompt.entryPriceCop} />
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
  m: MatchLite;
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
  const cerrado = !canEditCasaMatch(m, now);
  const started = hasCasaMatchStarted(m, now);
  const editable = canEdit && !cerrado;
  // Se puede tocar aunque no esté inscrito: el toque abre la hoja de pago.
  const invitando = !canEdit && !cerrado && Boolean(onBlocked);
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
  const minute = live ? liveMinuteLabel(m) : "";
  // Pasó la hora de inicio y la fuente todavía no reporta el partido: se dice, no se muestran guiones sueltos.
  const waiting = !started && !finished && !voided && Date.parse(m.scheduled_at) <= now;
  const showButtons1x2 = scoringMode === "1x2" && !started && !finished;

  const estado = voided ? (
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

  const cell = (value: number | null) => (
    <span className="lp-money grid h-11 w-11 shrink-0 place-items-center overflow-hidden text-[28px] text-text-primary [-webkit-text-size-adjust:none]">
      {started || finished ? value ?? "–" : "–"}
    </span>
  );

  return (
    <article className={`lp-card p-3 ${voided ? "opacity-70" : ""}`} aria-label={`${m.home_team} contra ${m.away_team}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold uppercase tracking-[0.08em]">
          {estado}
          {editable && !tengoPick && (
            <span className="rounded-md border border-red-alert/40 bg-red-alert/15 px-1.5 py-0.5 text-[10px] text-red-alert">Falta</span>
          )}
          {cerrado && !started && !finished && !voided && !waiting && <span className="text-red-alert">Cerrado</span>}
        </span>
        <Link href={`/futbol/partidos/${m.id}`} className="flex min-h-8 shrink-0 items-center gap-0.5 text-[12px] font-semibold text-text-secondary transition-colors hover:text-text-primary">
          Ver partido <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>

      {showButtons1x2 ? (
        /* (2026-09-14) Pedido del dueño: el escudo con el nombre debajo ES el
           botón de cada equipo y «Empate» ocupa el lugar del «vs». Columnas con
           minmax(0,1fr): con texto ampliado el nombre baja de línea. */
        <div role="group" aria-label={`Tu pronóstico: ${m.home_team} contra ${m.away_team}`} className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2">
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
                  "flex min-h-[80px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-md border px-1.5 py-2 text-center transition-colors",
                  equipo ? "" : "px-3",
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
                    <TeamCrest team={equipo.name} src={equipo.flag} className="h-8 w-8" />
                    <span className="w-full text-[13px] font-semibold leading-tight [overflow-wrap:anywhere]">{op.label}</span>
                  </>
                ) : (
                  <span className="text-[13px] font-semibold">Empate</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-center gap-2">
            <Link href={`/futbol/equipos/home.${m.id}`} aria-label={`Ver equipo: ${m.home_team}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-bg-elevated">
              <TeamCrest team={m.home_team} src={m.home_team_flag} className="h-8 w-8" />
            </Link>
            {invitando && scoringMode === "marcador" ? (
              // Casillas que invitan a pagar: el toque abre la hoja, no edita.
              <button
                type="button"
                onClick={() => onBlocked?.()}
                aria-label="Pagar la entrada para pronosticar"
                className="lp-money flex h-12 cursor-pointer items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-3 text-[22px] text-text-muted transition-colors hover:border-gold/30"
              >
                <span>–</span><span aria-hidden="true" className="h-[2px] w-3 bg-border-strong" /><span>–</span>
              </button>
            ) : editable && scoringMode === "marcador" ? (
              (["home", "away"] as const).map((side, i) => (
                <Fragment key={side}>
                  {i === 1 && <span className="h-[2px] w-3 shrink-0 bg-border-strong" aria-hidden />}
                  <input
                    ref={(el) => { inputs.current.set(`${m.id}:${side}`, el); }}
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="next"
                    min={0}
                    max={30}
                    value={(side === "home" ? mine?.homeScore : mine?.awayScore) ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      onScore(m.id, side, e.target.value);
                      // Un dígito completa la casilla: salta a la siguiente.
                      // Para 10 o más, se vuelve a tocar la casilla y se agrega el segundo.
                      if (e.target.value.length === 1) onJump(m.id, side);
                    }}
                    aria-label={`Goles de ${side === "home" ? m.home_team : m.away_team}`}
                    className={`lp-input lp-money h-12 !w-12 shrink-0 !px-0 text-center text-[22px] [-webkit-text-size-adjust:none] ${!tengoPick ? "!border-red-alert/60" : ""}`}
                  />
                </Fragment>
              ))
            ) : (
              <>
                {cell(m.home_score)}
                <span aria-hidden="true" className="h-[2px] w-3 shrink-0 bg-border-strong" />
                {cell(m.away_score)}
              </>
            )}
            <Link href={`/futbol/equipos/away.${m.id}`} aria-label={`Ver equipo: ${m.away_team}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-bg-elevated">
              <TeamCrest team={m.away_team} src={m.away_team_flag} className="h-8 w-8" />
            </Link>
          </div>
          {/* Sin recorte a propósito: con texto ampliado un nombre largo parte en dos líneas. */}
          <div className="mt-1 grid grid-cols-2 gap-x-3 text-center text-[12px] font-semibold leading-tight text-text-primary">
            <span className="min-w-0 [overflow-wrap:anywhere]">{m.home_team}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{m.away_team}</span>
          </div>
        </>
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

      {/* Tu pronóstico y sus puntos, desde que el partido cierra. */}
      {showMine && (started || cerrado || finished) && !showButtons1x2 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="text-text-secondary">{scoringMode === "marcador" ? "Tu marcador:" : "Tu pronóstico:"}</span>
          <span className={`font-semibold ${!tengoPick ? "text-text-muted" : onTrack || (points ?? 0) > 0 ? "text-turf" : "text-text-primary"}`}>
            {label ?? "sin pronóstico"}
          </span>
          {points != null && tengoPick && (
            // (2026-09-17) Los aciertos en verde y los 0 pts en amarillo, fáciles de leer.
            <span className={`lp-money text-[15px] ${points > 0 ? "text-turf" : "text-amber"}`}>
              {points > 0 ? `+${points}` : "0"} pts
            </span>
          )}
        </p>
      )}

      {started && canViewOthers && (
        <MatchPicks slug={slug} matchId={m.id} scoringMode={scoringMode} home={m.home_team} away={m.away_team} count={total || null} summary={summary} />
      )}
    </article>
  );
}
