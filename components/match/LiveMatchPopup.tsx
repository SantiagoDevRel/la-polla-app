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

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, X } from "lucide-react";
import { DURATION, EASE } from "@/lib/animations";
import type { MatchSummary, TimelineEvent, Lineup } from "@/lib/espn/summary";

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

// ─── Helpers de presentación ───

/** Logo/bandera del equipo con fallback a iniciales si la imagen falla. */
function TeamFlag({ flag, team, size }: { flag: string | null | undefined; team: string; size: number }) {
  const [errored, setErrored] = useState(false);
  if (flag && !errored) {
    return (
      // ESPN sirve a.espncdn.com (ya en el CSP img-src). plain <img> por
      // pedido — next/image se encogería dentro del flex comprimido.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={flag}
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
      {team.slice(0, 3).toUpperCase()}
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
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: DURATION.medium, ease: EASE.default }}
      >
        <div className="bg-bg-card border border-border-subtle rounded-t-[24px] sm:rounded-[24px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[85vh] overflow-y-auto overscroll-contain">
          {/* Header sticky: equipos + badge LIVE + cerrar */}
          <div className="sticky top-0 z-10 bg-bg-card/95 backdrop-blur-sm pt-3 pb-3 px-4 rounded-t-[24px] border-b border-border-subtle/60">
            <div className="w-10 h-1 rounded-full bg-border-subtle mx-auto mb-3 sm:hidden" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                <TeamFlag flag={homeFlag} team={homeTeam} size={26} />
                <span className="score-font text-[20px] leading-none text-text-primary [overflow-wrap:anywhere] line-clamp-1">
                  {homeTeam}
                </span>
              </div>
              <span className="flex-shrink-0 text-[11px] font-semibold uppercase text-text-muted">
                {t("vs")}
              </span>
              <div className="flex-1 min-w-0 flex items-center gap-2 justify-end overflow-hidden">
                <span className="score-font text-[20px] leading-none text-text-primary [overflow-wrap:anywhere] line-clamp-1 text-right">
                  {awayTeam}
                </span>
                <TeamFlag flag={awayFlag} team={awayTeam} size={26} />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                className="flex-shrink-0 w-9 h-9 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
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

          {/* Contenido. pb generoso + safe-area para iPhones con home indicator. */}
          <div className="px-4 py-4 space-y-6" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
            {loading ? (
              <SummarySkeleton />
            ) : error ? (
              <p className="text-center text-sm text-text-secondary py-8">{t("loadError")}</p>
            ) : !hasAnyContent ? (
              <p className="text-center text-sm text-text-secondary py-8">{t("noData")}</p>
            ) : (
              <>
                {timeline.length > 0 ? (
                  <TimelineSection
                    events={timeline}
                    title={t("timelineTitle")}
                    goalLabel={t("goal")}
                    assistLabel={t("assist")}
                    locale={locale}
                  />
                ) : null}
                {stats.length > 0 ? (
                  <StatsSection stats={stats} title={t("statsTitle")} />
                ) : null}
                {lineups.length > 0 ? (
                  <LineupsSection
                    home={homeLineup}
                    away={awayLineup}
                    homeTeam={homeTeam}
                    awayTeam={awayTeam}
                    title={t("lineupsTitle")}
                    formationLabel={t("formation")}
                  />
                ) : null}
              </>
            )}
          </div>
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
}: {
  events: TimelineEvent[];
  title: string;
  goalLabel: string;
  assistLabel: string;
  locale: string;
}) {
  // Colapsable, CERRADO por default: el resumen ocupa mucho y la data más
  // interesante (stats, alineaciones) queda visible primero. El user lo
  // abre si quiere ver el minuto a minuto.
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-bg-elevated/60"
      >
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">{title}</h3>
        <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-text-muted">
          {events.length}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {open ? (
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
      ) : null}
    </section>
  );
}

/** Stats del boxscore. Cada fila: label + barra comparativa home/away.
 *  La barra usa el valor numérico (sin "%") para el ancho relativo. */
function StatsSection({ stats, title }: { stats: { label: string; home: string; away: string }[]; title: string }) {
  const num = (v: string): number => {
    const n = Number.parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
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
  title,
  formationLabel,
}: {
  home: Lineup | null;
  away: Lineup | null;
  homeTeam: string;
  awayTeam: string;
  title: string;
  formationLabel: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">{title}</h3>
      <div className="grid grid-cols-2 gap-2">
        <LineupColumn lineup={home} teamName={homeTeam} formationLabel={formationLabel} />
        <LineupColumn lineup={away} teamName={awayTeam} formationLabel={formationLabel} />
      </div>
    </section>
  );
}

function LineupColumn({
  lineup,
  teamName,
  formationLabel,
}: {
  lineup: Lineup | null;
  teamName: string;
  formationLabel: string;
}) {
  if (!lineup || lineup.players.length === 0) {
    return (
      <div className="bg-bg-elevated border border-border-subtle rounded-xl px-3 py-2 min-w-0">
        <p className="text-xs font-semibold text-text-primary [overflow-wrap:anywhere] line-clamp-1">
          {lineup?.team || teamName}
        </p>
      </div>
    );
  }
  const starters = lineup.players.filter((p) => p.starter);
  const subs = lineup.players.filter((p) => !p.starter);
  return (
    <div className="bg-bg-elevated border border-border-subtle rounded-xl px-3 py-2.5 min-w-0">
      <p className="text-xs font-semibold text-text-primary [overflow-wrap:anywhere] line-clamp-1">
        {lineup.team || teamName}
      </p>
      {lineup.formation ? (
        <p className="text-[10px] text-text-muted mb-1.5" style={{ fontFeatureSettings: '"tnum"' }}>
          {formationLabel}: {lineup.formation}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {starters.map((p, i) => (
          <li key={`s-${p.name}-${i}`} className="flex items-baseline gap-1.5 text-[11px] min-w-0">
            <span className="text-text-muted w-5 text-right shrink-0 tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
              {p.jersey ?? ""}
            </span>
            <span className="text-text-secondary [overflow-wrap:anywhere] line-clamp-1">{p.name}</span>
          </li>
        ))}
      </ul>
      {subs.length > 0 ? (
        <ul className="space-y-0.5 mt-1.5 pt-1.5 border-t border-border-subtle/50">
          {subs.map((p, i) => (
            <li key={`b-${p.name}-${i}`} className="flex items-baseline gap-1.5 text-[11px] min-w-0 opacity-70">
              <span className="text-text-muted w-5 text-right shrink-0 tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                {p.jersey ?? ""}
              </span>
              <span className="text-text-muted [overflow-wrap:anywhere] line-clamp-1">{p.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
