// components/match/LiveMatchPopup.tsx — Bottom sheet con el detalle en
// vivo de un partido: timeline (goles/tarjetas), stats del boxscore y
// alineaciones. La data sale de /api/matches/[id]/live (ESPN summary).
//
// Mismo patrón que TeamInfoSheet: portal a document.body (los transforms
// de framer-motion en ancestros crean stacking contexts que lo dejarían
// DEBAJO del BottomNav z-50), cierre con X/backdrop/Escape, safe-area en
// el pb. Si el partido está en vivo hace polling cada 30s; si una sección
// viene vacía, se oculta. Loading = skeleton, nunca spinner.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { motion, AnimatePresence, useDragControls, type PanInfo } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, List, UsersRound, X } from "lucide-react";
import { DURATION } from "@/lib/animations";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import type { MatchStat, MatchSummary, TimelineEvent, Lineup, LineupPlayer } from "@/lib/espn/summary";

// Eventos de ESPN que son RUIDO para el resumen: saques, demoras, fin de
// tiempos. Se ocultan para que el timeline muestre solo lo que importa
// (goles, tarjetas, cambios, penales, VAR).
const NOISE_EVENT_TYPES = new Set([
  "Kickoff",
  "Start Delay",
  "End Delay",
  "Delay Over",
  "Half Time",
  "Halftime",
  "End of First Half",
  "End of Second Half",
  "End Regular Time",
  "End of Regulation",
  "Full Time",
  "First Half",
  "Second Half",
  "Game End",
  "End of Period",
  "Period Start",
]);

function isMeaningfulEvent(e: TimelineEvent): boolean {
  if (e.isGoal) return true;
  return e.type !== "" && !NOISE_EVENT_TYPES.has(e.type);
}

// Etiquetas legibles (es/en) para los tipos de evento de ESPN.
const EVENT_LABEL_ES: Record<string, string> = {
  "Goal": "Gol",
  "Penalty - Scored": "Gol de penal",
  "Penalty - Missed": "Penal fallado",
  "Own Goal": "Autogol",
  "Yellow Card": "Tarjeta amarilla",
  "Red Card": "Tarjeta roja",
  "Yellow Red Card": "Doble amarilla",
  "Second Yellow Card": "Doble amarilla",
  "Substitution": "Cambio",
  "VAR": "Revisión VAR",
  "Var Decision": "Revisión VAR",
  "Goal Disallowed": "Gol anulado",
  "Penalty Won": "Penal a favor",
};
const EVENT_LABEL_EN: Record<string, string> = {
  "Penalty - Scored": "Penalty goal",
  "Penalty - Missed": "Penalty missed",
  "Own Goal": "Own goal",
  "Yellow Card": "Yellow card",
  "Red Card": "Red card",
  "Yellow Red Card": "Second yellow",
  "Second Yellow Card": "Second yellow",
  "Substitution": "Substitution",
  "Var Decision": "VAR review",
  "Goal Disallowed": "Goal disallowed",
};

function eventLabel(type: string, locale: string): string {
  if (locale === "en") return EVENT_LABEL_EN[type] ?? type;
  return EVENT_LABEL_ES[type] ?? type;
}

interface LiveMatchPopupProps {
  matchId: string;
  tournament: string;
  homeTeam: string;
  awayTeam: string;
  homeFlag?: string | null;
  awayFlag?: string | null;
  isLive: boolean;
  onClose: () => void;
}

// Cada cuánto refrescamos mientras el partido está en vivo.
const LIVE_POLL_MS = 30_000;

type LiveTab = "lineup" | "summary" | "stats";
// Orden visual del carrusel (pedido user 2026-06-12): Estadísticas primero,
// luego Alineación, Resumen a la derecha. El array `tabs`, los paneles del
// DOM y el activeTab inicial DEBEN seguir este mismo orden o el scroll-snap
// se desincroniza del indicador.
const TAB_ORDER: LiveTab[] = ["stats", "lineup", "summary"];
const SHEET_CLOSE_DRAG_OFFSET = 92;
const SHEET_CLOSE_DRAG_VELOCITY = 720;

const SHORT_TEAM_NAMES: Record<string, string> = {
  "bosnia & herzegovina": "Bosnia-Herz.",
  "bosnia-herzegovina": "Bosnia-Herz.",
  "bosnia y herzegovina": "Bosnia-Herz.",
  "czech republic": "Czechia",
  "democratic republic of congo": "DR Congo",
  "democratic republic of the congo": "DR Congo",
  "republica democratica del congo": "R. D. Congo",
  "united states": "USA",
  "estados unidos": "EE. UU.",
};

function compactTeamName(team: string): string {
  const key = team.trim().toLowerCase();
  return SHORT_TEAM_NAMES[key] ?? team;
}

function teamNameSize(name: string): string {
  if (name.length > 18) return "text-[15px]";
  if (name.length > 13) return "text-[17px]";
  return "text-[20px]";
}

function initials(value: string): string {
  const clean = value.trim();
  if (!clean) return "TBD";
  const parts = clean.split(/[\s-]+/).filter(Boolean);
  const fromParts = parts.map((part) => part[0]).join("");
  return (fromParts.length >= 2 ? fromParts : clean.slice(0, 3)).toUpperCase();
}

// ─── Helpers de presentación ───

/** Bandera real por nombre de país; fallback a iniciales si no existe/carga. */
function TeamFlag({ flag, team, size }: { flag: string | null | undefined; team: string; size: number }) {
  const [errored, setErrored] = useState(false);
  const src = flagUrlForTeam(team) ?? flag;
  if (src && !errored) {
    return (
      // Plain img: las banderas locales y los assets ESPN ya están cubiertos
      // por CSP. max-w-none evita que flex las encoja en headers apretados.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="max-w-none shrink-0 object-contain"
        style={{ width: size, height: size, borderRadius: 4 }}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <span
      className="shrink-0 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center font-bold text-text-primary"
      style={{ width: size, height: size, fontSize: Math.max(8, size / 3) }}
    >
      {initials(team).slice(0, 3)}
    </span>
  );
}

function PlayerHeadshot({ player }: { player: LineupPlayer }) {
  const [errored, setErrored] = useState(false);
  if (player.headshot && !errored) {
    return (
      // Plain <img>: ESPN sirve headshots desde a.espncdn.com.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.headshot}
        alt=""
        width={36}
        height={36}
        loading="lazy"
        onError={() => setErrored(true)}
        className="h-9 w-9 max-w-none shrink-0 rounded-full object-cover bg-bg-card border border-border-subtle"
      />
    );
  }
  return (
    <span
      className="h-9 w-9 shrink-0 rounded-full bg-bg-card border border-border-subtle flex items-center justify-center text-[11px] font-bold text-text-secondary"
      style={{ fontFeatureSettings: '"tnum"' }}
    >
      {player.jersey ?? initials(player.name).slice(0, 2)}
    </span>
  );
}

// ─── Componente ───

export default function LiveMatchPopup({
  matchId,
  tournament,
  homeTeam,
  awayTeam,
  homeFlag,
  awayFlag,
  isLive,
  onClose,
}: LiveMatchPopupProps) {
  const t = useTranslations("LiveMatch");
  const locale = useLocale();
  void tournament; // El server resuelve el torneo desde el row; no se manda.
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Portal sólo tras montar (evita SSR mismatch), igual que TeamInfoSheet.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [activeTab, setActiveTab] = useState<LiveTab>("stats");
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const sheetDragControls = useDragControls();

  const startSheetDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("button,a,input,textarea,select")) return;
      sheetDragControls.start(event);
    },
    [sheetDragControls],
  );

  const closeBySheetDrag = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y > SHEET_CLOSE_DRAG_OFFSET || info.velocity.y > SHEET_CLOSE_DRAG_VELOCITY) {
        onClose();
      }
    },
    [onClose],
  );

  const goToTab = useCallback((tab: LiveTab) => {
    setActiveTab(tab);
    const el = panelsRef.current;
    if (!el) return;
    const idx = TAB_ORDER.indexOf(tab);
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  }, []);

  const onPanelsScroll = useCallback(() => {
    const el = panelsRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const next = TAB_ORDER[Math.min(Math.max(idx, 0), TAB_ORDER.length - 1)];
    if (next) setActiveTab((prev) => (prev === next ? prev : next));
  }, []);

  // Fetch on-mount + polling cada 30s mientras el partido esté en vivo.
  // El interval se limpia en el cleanup (sin fugas si se cierra el popup).
  useEffect(() => {
    let cancelled = false;
    const load = async (showSkeleton: boolean) => {
      if (showSkeleton) setLoading(true);
      try {
        const res = await axios.get<{ summary: MatchSummary | null }>(
          `/api/matches/${matchId}/live`,
        );
        if (cancelled) return;
        setSummary(res.data.summary);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load(true);
    if (!isLive) return () => { cancelled = true; };
    const interval = setInterval(() => void load(false), LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [matchId, isLive]);

  // Escape para cerrar + scroll-lock del body mientras el sheet está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  const timeline = (summary?.timeline ?? []).filter(isMeaningfulEvent);
  const stats = summary?.stats ?? [];
  const lineups = summary?.lineups ?? [];
  const homeLineup = lineups.find((l) => l.side === "home") ?? null;
  const awayLineup = lineups.find((l) => l.side === "away") ?? null;
  const hasAnyContent = timeline.length > 0 || stats.length > 0 || lineups.length > 0;
  const homeDisplayName = compactTeamName(homeTeam);
  const awayDisplayName = compactTeamName(awayTeam);
  const tabs: { tab: LiveTab; label: string; Icon: typeof UsersRound }[] = [
    { tab: "stats", label: t("tabStats"), Icon: BarChart3 },
    { tab: "lineup", label: t("tabLineup"), Icon: UsersRound },
    { tab: "summary", label: t("tabSummary"), Icon: List },
  ];

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.fast }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        key="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${homeTeam} vs ${awayTeam}`}
        className="fixed bottom-0 inset-x-0 z-[71] mx-auto w-full sm:max-w-md sm:bottom-6 px-0"
        drag="y"
        dragControls={sheetDragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 150 }}
        dragElastic={0.08}
        dragMomentum={false}
        dragSnapToOrigin
        onDragEnd={closeBySheetDrag}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        <div className="bg-bg-card border border-border-subtle rounded-t-[24px] sm:rounded-[24px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[85vh] flex flex-col overscroll-contain overflow-hidden">
          {/* Header fijo: equipos balanceados, live centrado y X arriba. */}
          <div
            className="shrink-0 cursor-grab touch-none bg-bg-card pt-3 pb-3 px-4 rounded-t-[24px] border-b border-border-subtle/60 active:cursor-grabbing"
            onPointerDown={startSheetDrag}
          >
            <div className="relative min-h-9">
              <div className="w-10 h-1 rounded-full bg-border-subtle mx-auto sm:hidden" aria-hidden="true" />
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                className="absolute right-0 top-0 w-9 h-9 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mx-auto mt-1 max-w-[350px]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <div className="min-w-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
                  <TeamFlag flag={homeFlag} team={homeTeam} size={28} />
                  <span
                    title={homeTeam}
                    className={`score-font ${teamNameSize(homeDisplayName)} leading-[0.95] text-text-primary text-center [overflow-wrap:anywhere] [text-wrap:balance]`}
                  >
                    {homeDisplayName}
                  </span>
                </div>
                <span className="flex-shrink-0 text-[11px] font-semibold uppercase text-text-muted">
                  {t("vs")}
                </span>
                <div className="min-w-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
                  <span
                    title={awayTeam}
                    className={`score-font ${teamNameSize(awayDisplayName)} leading-[0.95] text-text-primary text-center [overflow-wrap:anywhere] [text-wrap:balance]`}
                  >
                    {awayDisplayName}
                  </span>
                  <TeamFlag flag={awayFlag} team={awayTeam} size={28} />
                </div>
              </div>
            </div>
            {isLive ? (
              <div className="mt-2 flex justify-center">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full bg-red-alert/15 border border-red-alert/30 text-red-alert text-[10px] font-bold uppercase tracking-[0.08em]">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-alert animate-pulse" />
                  {t("liveBadge")}
                </span>
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="flex-1 min-h-[360px] overflow-y-auto px-4 pt-4" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
              <SummarySkeleton />
            </div>
          ) : error ? (
            <div className="flex-1 min-h-[260px] overflow-y-auto px-4 pt-4" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
              <p className="text-center text-sm text-text-secondary py-8">{t("loadError")}</p>
            </div>
          ) : !hasAnyContent ? (
            <div className="flex-1 min-h-[260px] overflow-y-auto px-4 pt-4" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
              <p className="text-center text-sm text-text-secondary py-8">{t("noData")}</p>
            </div>
          ) : (
            <>
              {/* Barra de tabs fija arriba del carrusel. */}
              <div role="tablist" aria-label={`${homeTeam} ${t("vs")} ${awayTeam}`} className="shrink-0 sticky top-0 z-10 bg-bg-card border-b border-border-subtle px-2 flex">
                {tabs.map(({ tab, label, Icon }) => {
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => goToTab(tab)}
                      className="relative flex-1 min-w-0 flex items-center justify-center gap-1.5 py-3 cursor-pointer"
                    >
                      <Icon
                        className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? "text-gold" : "text-text-muted"}`}
                        strokeWidth={isActive ? 2.4 : 2}
                        aria-hidden="true"
                      />
                      <span className={`text-[12px] font-semibold truncate transition-colors ${isActive ? "text-text-primary" : "text-text-muted"}`}>
                        {label}
                      </span>
                      {isActive ? (
                        <motion.span
                          layoutId="live-match-tab-underline"
                          className="absolute bottom-0 inset-x-2 h-[2px] rounded-full bg-gold"
                          transition={{ type: "spring", stiffness: 500, damping: 38 }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* Carrusel horizontal: tap en tab + swipe con scroll-snap. */}
              <div
                ref={panelsRef}
                onScroll={onPanelsScroll}
                className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div role="tabpanel" aria-label={t("tabStats")} className="snap-center w-full shrink-0 overflow-y-auto overscroll-contain">
                  <div className="px-4 pt-4" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
                    <StatsSection stats={stats} title={t("statsTitle")} emptyLabel={t("noData")} />
                  </div>
                </div>
                <div role="tabpanel" aria-label={t("tabLineup")} className="snap-center w-full shrink-0 overflow-y-auto overscroll-contain">
                  <div className="px-4 pt-4" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
                    <LineupsSection
                      home={homeLineup}
                      away={awayLineup}
                      homeTeam={homeTeam}
                      awayTeam={awayTeam}
                      homeFlag={homeFlag}
                      awayFlag={awayFlag}
                      title={t("lineupsTitle")}
                      formationLabel={t("formation")}
                      emptyLabel={t("noData")}
                    />
                  </div>
                </div>
                <div role="tabpanel" aria-label={t("tabSummary")} className="snap-center w-full shrink-0 overflow-y-auto overscroll-contain">
                  <div className="px-4 pt-4" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
                    <TimelineSection
                      events={timeline}
                      title={t("timelineTitle")}
                      goalLabel={t("goal")}
                      assistLabel={t("assist")}
                      locale={locale}
                      emptyLabel={t("noData")}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ─── Secciones ───

/** Timeline de eventos. Goles resaltados con scorer + assist, alineados a
 *  su side (home = izquierda, away = derecha, neutral = centrado). */
function TimelineSection({
  events,
  title,
  goalLabel,
  assistLabel,
  locale,
  emptyLabel,
}: {
  events: TimelineEvent[];
  title: string;
  goalLabel: string;
  assistLabel: string;
  locale: string;
  emptyLabel: string;
}) {
  if (events.length === 0) {
    return <EmptyPanel title={title} message={emptyLabel} />;
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">{title}</h3>
        <span className="text-[11px] tabular-nums text-text-muted" style={{ fontFeatureSettings: '"tnum"' }}>
          {events.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {events.map((e, i) => {
          const alignRight = e.side === "away";
          const alignCenter = e.side === "neutral";
          return (
            <li
              key={`${e.minute}-${e.type}-${i}`}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 border ${
                e.isGoal
                  ? "bg-turf/[0.08] border-turf/25"
                  : "bg-bg-elevated border-border-subtle"
              } ${alignRight ? "flex-row-reverse text-right" : alignCenter ? "justify-center" : ""}`}
            >
              <span
                className="score-font text-[15px] text-text-secondary shrink-0 w-9 text-center"
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {e.minute || "·"}
              </span>
              <div className={`min-w-0 ${alignCenter ? "text-center" : "flex-1"}`}>
                {e.isGoal && e.scorer ? (
                  <>
                    <span className="block text-sm font-semibold text-turf [overflow-wrap:anywhere]">
                      {goalLabel} · {e.scorer}
                    </span>
                    {e.assist ? (
                      <span className="block text-[11px] text-text-muted [overflow-wrap:anywhere]">
                        {assistLabel}: {e.assist}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="block text-xs text-text-secondary [overflow-wrap:anywhere]">
                    {eventLabel(e.type, locale)}
                    {e.player ? ` · ${e.player}` : ""}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Stats del boxscore. Cada fila: label + barra comparativa home/away.
 *  La barra usa el valor numérico (sin "%") para el ancho relativo. */
function StatsSection({ stats, title, emptyLabel }: { stats: MatchStat[]; title: string; emptyLabel: string }) {
  const num = (v: string): number => {
    const n = Number.parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  if (stats.length === 0) {
    return <EmptyPanel title={title} message={emptyLabel} />;
  }
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">{title}</h3>
      <ul className="space-y-2.5">
        {stats.map((s) => {
          const h = num(s.home);
          const a = num(s.away);
          const total = h + a;
          // Fills explícitos por lado. Si un valor es 0 (o ambos), ese lado
          // NO se colorea — una barra de color sobre un "0" confunde (parece
          // que hay algo). total=0 → barra vacía (solo el track gris).
          const homeFill = total > 0 ? Math.round((h / total) * 100) : 0;
          const awayFill = total > 0 ? 100 - homeFill : 0;
          return (
            <li key={s.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className={`score-font text-[15px] tabular-nums ${h === 0 ? "text-text-muted" : "text-text-primary"}`} style={{ fontFeatureSettings: '"tnum"' }}>
                  {s.home}
                </span>
                <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted text-center px-2 [overflow-wrap:anywhere]">
                  {s.label}
                </span>
                <span className={`score-font text-[15px] tabular-nums ${a === 0 ? "text-text-muted" : "text-text-primary"}`} style={{ fontFeatureSettings: '"tnum"' }}>
                  {s.away}
                </span>
              </div>
              <div className="flex items-center gap-1 h-1.5">
                <div className="flex-1 h-full rounded-full bg-bg-elevated overflow-hidden flex justify-end">
                  <div className="h-full bg-text-secondary/50 rounded-full" style={{ width: `${homeFill}%` }} />
                </div>
                <div className="flex-1 h-full rounded-full bg-bg-elevated overflow-hidden">
                  <div className="h-full bg-text-secondary/50 rounded-full" style={{ width: `${awayFill}%` }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Alineaciones por side: formación + titulares/suplentes. */
function LineupsSection({
  home,
  away,
  homeTeam,
  awayTeam,
  homeFlag,
  awayFlag,
  title,
  formationLabel,
  emptyLabel,
}: {
  home: Lineup | null;
  away: Lineup | null;
  homeTeam: string;
  awayTeam: string;
  homeFlag: string | null | undefined;
  awayFlag: string | null | undefined;
  title: string;
  formationLabel: string;
  emptyLabel: string;
}) {
  if ((!home || home.players.length === 0) && (!away || away.players.length === 0)) {
    return <EmptyPanel title={title} message={emptyLabel} />;
  }
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">{title}</h3>
      <div className="space-y-3">
        <LineupCard lineup={home} teamName={homeTeam} flag={homeFlag} formationLabel={formationLabel} emptyLabel={emptyLabel} />
        <LineupCard lineup={away} teamName={awayTeam} flag={awayFlag} formationLabel={formationLabel} emptyLabel={emptyLabel} />
      </div>
    </section>
  );
}

function LineupCard({
  lineup,
  teamName,
  flag,
  formationLabel,
  emptyLabel,
}: {
  lineup: Lineup | null;
  teamName: string;
  flag: string | null | undefined;
  formationLabel: string;
  emptyLabel: string;
}) {
  if (!lineup || lineup.players.length === 0) {
    return (
      <div className="bg-bg-elevated border border-border-subtle rounded-xl px-3 py-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <TeamFlag flag={flag} team={teamName} size={22} />
          <p className="text-sm font-semibold text-text-primary [overflow-wrap:anywhere]">
            {lineup?.team || teamName}
          </p>
        </div>
        <p className="mt-2 text-xs text-text-muted">{emptyLabel}</p>
      </div>
    );
  }
  const starters = lineup.players.filter((p) => p.starter);
  const subs = lineup.players.filter((p) => !p.starter);
  const displayTeam = lineup.team || teamName;
  return (
    <div className="bg-bg-elevated border border-border-subtle rounded-xl px-3 py-3 min-w-0">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <TeamFlag flag={flag} team={teamName} size={22} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary [overflow-wrap:anywhere] leading-tight">
              {displayTeam}
            </p>
            {lineup.formation ? (
              <p className="text-[11px] text-text-muted mt-0.5" style={{ fontFeatureSettings: '"tnum"' }}>
                {formationLabel}: {lineup.formation}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <ul className="mt-3 space-y-1">
        {starters.map((p, i) => (
          <LineupPlayerRow key={`s-${p.name}-${p.jersey ?? i}`} player={p} />
        ))}
      </ul>
      {subs.length > 0 ? (
        <ul className="space-y-1 mt-2.5 pt-2.5 border-t border-border-subtle/60">
          {subs.map((p, i) => (
            <LineupPlayerRow key={`b-${p.name}-${p.jersey ?? i}`} player={p} muted />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LineupPlayerRow({ player, muted = false }: { player: LineupPlayer; muted?: boolean }) {
  return (
    <li className={`flex items-center gap-2.5 min-w-0 py-1 ${muted ? "opacity-65" : ""}`}>
      <PlayerHeadshot player={player} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-tight [overflow-wrap:anywhere] ${muted ? "text-text-muted" : "text-text-primary"}`}>
          {player.name}
        </p>
        <p className="mt-0.5 text-[11px] leading-tight text-text-muted" style={{ fontFeatureSettings: '"tnum"' }}>
          {[player.pos, player.jersey ? `#${player.jersey}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
    </li>
  );
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">{title}</h3>
      <div className="rounded-xl border border-border-subtle bg-bg-elevated px-3 py-8">
        <p className="text-center text-sm text-text-secondary">{message}</p>
      </div>
    </section>
  );
}

/** Skeleton con la forma aproximada del contenido (no spinner). */
function SummarySkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-bg-elevated" />
        <div className="h-12 rounded-xl bg-bg-elevated" />
        <div className="h-12 rounded-xl bg-bg-elevated" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-bg-elevated" />
        <div className="h-6 rounded bg-bg-elevated" />
        <div className="h-6 rounded bg-bg-elevated" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="h-32 rounded-xl bg-bg-elevated" />
        <div className="h-32 rounded-xl bg-bg-elevated" />
      </div>
    </div>
  );
}
