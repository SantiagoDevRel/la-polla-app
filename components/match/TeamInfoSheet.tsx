// components/match/TeamInfoSheet.tsx — Bottom sheet con la ficha de un
// equipo: facts estáticos (ranking FIFA, confederación, historia
// mundialista — lib/teams/worldcup-facts.ts) + data viva de nuestra DB
// vía /api/teams/info (forma, números, mini-tabla del grupo, próximos).
// Se abre al tocar la bandera/nombre de un equipo en la card del partido.
//
// Responsive: bottom sheet full-width en mobile, centrado max-w-md en
// pantallas ≥sm. Cierra con backdrop, X o Escape. Los nombres usan
// line-clamp/overflow-wrap (nunca truncate horizontal contra un centro
// fijo) para sobrevivir text-zoom de accesibilidad.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import axios from "axios";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useDragControls, type PanInfo } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { X, CalendarDays, Shield, Check, ExternalLink, Users, Newspaper, LayoutGrid } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import { getTeamFacts } from "@/lib/teams/worldcup-facts";
import { DURATION } from "@/lib/animations";
import type { SquadPlayer, PlayerLine, NewsItem } from "@/lib/espn/teams";

// ─── Tipos (espejo del payload de /api/teams/info) ───

interface SheetMatch {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  phase: string | null;
}

interface StandingRow {
  team: string;
  flag: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  points: number;
}

interface TeamInfo {
  team: string;
  flag: string | null;
  played: SheetMatch[];
  live: SheetMatch[];
  upcoming: SheetMatch[];
  stats: { wins: number; draws: number; losses: number; gf: number; ga: number; cleanSheets: number };
  group: StandingRow[] | null;
}

interface TeamInfoSheetProps {
  /** Nombre del equipo tal cual viene en matches.home_team/away_team. */
  team: string;
  /** Flag URL del provider (fallback si no hay bandera de país). */
  fallbackFlag: string | null;
  tournament: string;
  onClose: () => void;
  /** Contexto de polla: habilita inputs de pronóstico en "Próximos".
   *  Guarda por el MISMO endpoint que el resto de la app
   *  (POST /api/pollas/[slug]/predictions — único source of truth). */
  pollaSlug?: string;
  pollaName?: string;
  /** pollas.match_ids — solo los partidos de la polla son pronosticables.
   *  null/undefined = polla dinámica (todos los del torneo valen; el
   *  server valida igual). */
  pollaMatchIds?: string[] | null;
  /** Avisar al caller que se guardó (el page de la polla refetchea su
   *  estado para que /pollas muestre el mismo dato al instante). */
  onPredictionSaved?: () => void;
}

/** Lock espejo del trigger check_prediction_lock: 5 min antes del kickoff. */
function isLockedForPrediction(scheduledAt: string): boolean {
  return new Date(scheduledAt).getTime() - 5 * 60 * 1000 <= Date.now();
}

// ─── Helpers ───

function FlagCircle({ team, apiFlag, size }: { team: string; apiFlag: string | null; size: number }) {
  const [errored, setErrored] = useState(false);
  const src = flagUrlForTeam(team) ?? apiFlag;
  if (src && !errored) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="flex-shrink-0"
        style={{ objectFit: "contain", borderRadius: 4 }}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <span
      className="flex-shrink-0 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center font-bold text-text-primary"
      style={{ width: size, height: size, fontSize: Math.max(8, size / 3) }}
    >
      {team.slice(0, 3).toUpperCase()}
    </span>
  );
}

function fmtShortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Fecha relativa simple ("hace 3h", "ayer", o fecha corta si es viejo). */
function fmtRelativeDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const rtf = new Intl.RelativeTimeFormat(locale === "en" ? "en-US" : "es-CO", { numeric: "auto" });
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return rtf.format(-hrs, "hour");
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 7) return rtf.format(-days, "day");
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CO", {
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

/** Iniciales para el fallback de la foto del jugador (sin headshot). */
function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Orden de líneas para renderizar las secciones del plantel. */
const LINE_ORDER: PlayerLine[] = ["GK", "DEF", "MID", "FWD", "OTH"];
const LINE_KEY: Record<PlayerLine, string> = {
  GK: "lineGK",
  DEF: "lineDEF",
  MID: "lineMID",
  FWD: "lineFWD",
  OTH: "lineOTH",
};

// ─── Foto del jugador con fallback a iniciales/dorsal ───
function PlayerHeadshot({ name, headshot, jersey }: { name: string; headshot: string | null; jersey: string | null }) {
  const [errored, setErrored] = useState(false);
  if (headshot && !errored) {
    return (
      // Plain <img> (ESPN headshots, a.espncdn.com ya en CSP img-src).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={headshot}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        onError={() => setErrored(true)}
        className="h-10 w-10 max-w-none shrink-0 rounded-full object-cover bg-bg-card border border-border-subtle"
      />
    );
  }
  return (
    <span className="h-10 w-10 shrink-0 rounded-full bg-bg-card border border-border-subtle flex items-center justify-center text-[11px] font-bold text-text-secondary" style={{ fontFeatureSettings: '"tnum"' }}>
      {jersey ?? playerInitials(name)}
    </span>
  );
}

// ─── Escudo del club del jugador (selecciones) con fallback a nada ───
function ClubCrest({ crest }: { crest: string | null }) {
  const [errored, setErrored] = useState(false);
  if (!crest || errored) return null;
  return (
    // Plain <img> (a.espncdn.com ya en CSP img-src).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={crest}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      onError={() => setErrored(true)}
      className="h-3.5 w-3.5 max-w-none shrink-0 object-contain"
    />
  );
}

// ─── Tabs del sheet ───
type SheetTab = "resumen" | "plantel" | "noticias";
const TAB_ORDER: SheetTab[] = ["resumen", "plantel", "noticias"];
const SHEET_CLOSE_DRAG_OFFSET = 92;
const SHEET_CLOSE_DRAG_VELOCITY = 720;

// ─── Componente ───

export default function TeamInfoSheet({
  team,
  fallbackFlag,
  tournament,
  onClose,
  pollaSlug,
  pollaMatchIds,
  onPredictionSaved,
}: TeamInfoSheetProps) {
  const t = useTranslations("TeamInfo");
  const locale = useLocale();
  const router = useRouter();
  const { showToast } = useToast();
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Pronósticos guardados del user en esta polla (match_id → score) +
  // drafts de los inputs + qué fila está guardando.
  const [savedPreds, setSavedPreds] = useState<Record<string, { home: number; away: number }>>({});
  const [predDrafts, setPredDrafts] = useState<Record<string, { home: string; away: string }>>({});
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  // Refs de los inputs del rival para el autojump (tipear marcador del
  // equipo → saltar al del rival).
  const rivalScoreRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Portal a document.body: los ancestros del page traen transforms de
  // framer-motion que crean stacking contexts y dejarían el sheet DEBAJO
  // del BottomNav (z-50) aunque tenga z mayor. mounted evita el portal
  // durante SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ── Tabs (Resumen / Plantel / Noticias) ──
  // Navegación por tap + swipe horizontal con CSS scroll-snap. El tab
  // activo se sincroniza con el scroll para que el indicador siga el swipe.
  const [activeTab, setActiveTab] = useState<SheetTab>("resumen");
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const sheetDragControls = useDragControls();
  // Lazy: cada tab fetchea su data solo la primera vez que se abre, para
  // ahorrar requests a ESPN (el user puede no abrir Plantel/Noticias nunca).
  const [roster, setRoster] = useState<SquadPlayer[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsError, setNewsError] = useState(false);
  const rosterRequested = useRef(false);
  const newsRequested = useRef(false);

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

  // Tap en un tab → scrollea el carrusel a su panel (el snap hace el resto).
  const goToTab = useCallback((tab: SheetTab) => {
    setActiveTab(tab);
    const el = panelsRef.current;
    if (!el) return;
    const idx = TAB_ORDER.indexOf(tab);
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  }, []);

  // Swipe → detecta qué panel quedó centrado y actualiza el tab activo.
  const onPanelsScroll = useCallback(() => {
    const el = panelsRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const next = TAB_ORDER[Math.min(Math.max(idx, 0), TAB_ORDER.length - 1)];
    if (next) setActiveTab((prev) => (prev === next ? prev : next));
  }, []);

  // Fetch Plantel la primera vez que el tab se abre.
  useEffect(() => {
    if (activeTab !== "plantel" || rosterRequested.current) return;
    rosterRequested.current = true;
    let cancelled = false;
    setRosterError(false);
    axios
      .get<{ players: SquadPlayer[] }>("/api/teams/roster", { params: { tournament, team } })
      .then((res) => { if (!cancelled) setRoster(res.data.players ?? []); })
      .catch(() => { if (!cancelled) setRosterError(true); });
    return () => { cancelled = true; };
  }, [activeTab, tournament, team]);

  // Fetch Noticias la primera vez que el tab se abre.
  useEffect(() => {
    if (activeTab !== "noticias" || newsRequested.current) return;
    newsRequested.current = true;
    let cancelled = false;
    setNewsError(false);
    axios
      .get<{ news: NewsItem[] }>("/api/teams/news", { params: { tournament, team } })
      .then((res) => { if (!cancelled) setNews(res.data.news ?? []); })
      .catch(() => { if (!cancelled) setNewsError(true); });
    return () => { cancelled = true; };
  }, [activeTab, tournament, team]);

  const facts = getTeamFacts(team);
  // Display: nombre en español en lapollacolombiana, DB name (EN) en
  // chickenpicks. Fallback al nombre de DB si el equipo no está en facts
  // (clubes de otros torneos).
  const displayName = useCallback(
    (name: string) => (locale === "en" ? name : getTeamFacts(name)?.nameEs ?? name),
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setInfo(null);
    axios
      .get<TeamInfo>("/api/teams/info", { params: { tournament, team } })
      .then((res) => { if (!cancelled) setInfo(res.data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [team, tournament, reloadKey]);

  // Pronósticos existentes del user en la polla — prefillean los inputs.
  // Best-effort: si falla, los inputs arrancan vacíos y el POST igual valida.
  useEffect(() => {
    if (!pollaSlug) return;
    let cancelled = false;
    axios
      .get<{ predictions: Array<{ match_id: string; predicted_home: number; predicted_away: number }> }>(
        `/api/pollas/${pollaSlug}/predictions`,
      )
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, { home: number; away: number }> = {};
        for (const p of res.data.predictions) {
          map[p.match_id] = { home: p.predicted_home, away: p.predicted_away };
        }
        setSavedPreds(map);
      })
      .catch(() => { /* inputs vacíos */ });
    return () => { cancelled = true; };
  }, [pollaSlug]);

  // ⚠️ Los drafts del sheet son RELATIVOS al equipo de la ficha (input
  // izquierdo = equipo del sheet, derecho = rival), pero predictions
  // guarda home/away del MATCH. Si el equipo del sheet juega de
  // visitante hay que invertir al guardar y al prefillear — sin esto se
  // guardaba el marcador al revés (bug real cazado en el test del
  // 2026-06-11: "Sudáfrica 2-1" se escribió como Chequia 2-1).
  const savePrediction = async (m: SheetMatch) => {
    if (!pollaSlug || savingMatchId) return;
    const draft = predDrafts[m.id];
    const teamScore = parseInt(draft?.home ?? "", 10);
    const rivalScore = parseInt(draft?.away ?? "", 10);
    if (Number.isNaN(teamScore) || Number.isNaN(rivalScore)) return;
    const teamIsHome = m.home_team === team;
    const home = teamIsHome ? teamScore : rivalScore;
    const away = teamIsHome ? rivalScore : teamScore;
    setSavingMatchId(m.id);
    try {
      await axios.post(`/api/pollas/${pollaSlug}/predictions`, {
        matchId: m.id,
        predictedHome: home,
        predictedAway: away,
      });
      setSavedPreds((prev) => ({ ...prev, [m.id]: { home, away } }));
      // Toast minimalista, no invasivo (pedido user 2026-06-11).
      showToast(t("predSavedMini"), "success");
      onPredictionSaved?.();
      router.refresh();
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : null;
      showToast(msg && msg !== "payment_required" ? msg : t("predSaveError"), "error");
    } finally {
      setSavingMatchId(null);
    }
  };

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

  const playedCount = info?.played.length ?? 0;

  // Resultado desde la perspectiva del equipo → letra + color del badge.
  const resultBadge = (m: SheetMatch) => {
    const isHome = m.home_team === team;
    const scored = (isHome ? m.home_score : m.away_score) ?? 0;
    const conceded = (isHome ? m.away_score : m.home_score) ?? 0;
    if (scored > conceded) return { letter: t("winLetter"), cls: "bg-green-live/15 text-green-live border-green-live/30" };
    if (scored < conceded) return { letter: t("lossLetter"), cls: "bg-red-alert/15 text-red-alert border-red-alert/30" };
    return { letter: t("drawLetter"), cls: "bg-bg-elevated text-text-secondary border-border-subtle" };
  };

  if (!mounted) return null;

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
        aria-label={displayName(team)}
        className="fixed bottom-0 inset-x-0 z-[71] mx-auto w-full sm:max-w-md sm:bottom-6 sm:px-0 px-0"
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
          {/* Grab handle + close (header fijo arriba del carrusel). */}
          <div
            className="shrink-0 cursor-grab touch-none bg-bg-card pt-3 pb-2 px-4 rounded-t-[24px] active:cursor-grabbing"
            onPointerDown={startSheetDrag}
          >
            <div className="w-10 h-1 rounded-full bg-border-subtle mx-auto mb-2 sm:hidden" aria-hidden="true" />
            <div className="flex items-start gap-3">
              <FlagCircle team={team} apiFlag={fallbackFlag} size={44} />
              <div className="flex-1 min-w-0">
                <h2 className="score-font text-[26px] leading-none text-text-primary [overflow-wrap:anywhere]">
                  {displayName(team)}
                </h2>
                {facts ? (
                  <p className="text-[11px] text-text-secondary mt-1">
                    {facts.confederation} · {t("fifaRank", { rank: facts.fifaRank })}
                  </p>
                ) : null}
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
          </div>

          {/* ── Barra de tabs sticky (arriba del carrusel) ── */}
          <div role="tablist" aria-label={displayName(team)} className="shrink-0 bg-bg-card border-b border-border-subtle px-2 flex">
            {(
              [
                { tab: "resumen", label: t("tabResumen"), Icon: LayoutGrid },
                { tab: "plantel", label: t("tabPlantel"), Icon: Users },
                { tab: "noticias", label: t("tabNoticias"), Icon: Newspaper },
              ] as { tab: SheetTab; label: string; Icon: typeof Users }[]
            ).map(({ tab, label, Icon }) => {
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
                      layoutId="team-sheet-tab-underline"
                      className="absolute bottom-0 inset-x-2 h-[2px] rounded-full bg-gold"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* ── Carrusel horizontal (3 paneles, scroll-snap) ── */}
          <div
            ref={panelsRef}
            onScroll={onPanelsScroll}
            className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
          {/* ── Panel 1 · Resumen (contenido original intacto) ── */}
          <div className="snap-center w-full shrink-0 overflow-y-auto overscroll-contain">
          {/* pb generoso + safe-area: el último item nunca queda pegado
              al borde inferior ni tapado en iPhones con home indicator. */}
          <div className="px-4 pt-4 space-y-5" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
            {/* Historia mundialista (estático) */}
            {facts ? (
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 bg-bg-elevated text-text-secondary border border-border-subtle rounded-full px-3 py-1 text-[11px] font-medium">
                  <CalendarDays className="w-3 h-3" aria-hidden="true" />
                  {t("participations", { count: facts.participations })}
                </span>
                <span className="inline-flex items-center gap-1.5 bg-gold/10 text-gold border border-gold/20 rounded-full px-3 py-1 text-[11px] font-medium">
                  <Shield className="w-3 h-3" aria-hidden="true" />
                  {locale === "en" ? facts.bestResultEn : facts.bestResultEs}
                </span>
              </div>
            ) : null}

            {error ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-text-secondary">{t("loadError")}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="border border-border-subtle text-text-primary rounded-xl px-5 py-2 text-sm hover:border-gold/30 transition-all cursor-pointer"
                >
                  {t("retry")}
                </button>
              </div>
            ) : !info ? (
              /* Skeleton — misma forma del contenido */
              <div className="space-y-3 animate-pulse" aria-hidden="true">
                <div className="h-4 w-32 rounded bg-bg-elevated" />
                <div className="h-12 rounded-xl bg-bg-elevated" />
                <div className="h-4 w-24 rounded bg-bg-elevated" />
                <div className="h-28 rounded-xl bg-bg-elevated" />
                <div className="h-4 w-28 rounded bg-bg-elevated" />
                <div className="h-20 rounded-xl bg-bg-elevated" />
              </div>
            ) : (
              <>
                {/* ── Forma en el torneo ── */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">
                      {t("formTitle")}
                    </h3>
                    {playedCount > 0 ? (
                      <span className="text-[11px] text-text-secondary" style={{ fontFeatureSettings: '"tnum"' }}>
                        {t("record", { w: info.stats.wins, d: info.stats.draws, l: info.stats.losses })}
                      </span>
                    ) : null}
                  </div>
                  {playedCount === 0 ? (
                    <p className="text-xs text-text-secondary bg-bg-elevated border border-border-subtle rounded-xl px-3 py-3">
                      {t("formEmpty")}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {info.played.map((m) => {
                        const badge = resultBadge(m);
                        const rival = m.home_team === team ? m.away_team : m.home_team;
                        const rivalFlag = m.home_team === team ? m.away_team_flag : m.home_team_flag;
                        const score = `${m.home_score ?? 0}–${m.away_score ?? 0}`;
                        const teamFirst = m.home_team === team;
                        return (
                          <li key={m.id} className="flex items-center gap-2 bg-bg-elevated border border-border-subtle rounded-xl px-3 py-2">
                            <span className={`flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${badge.cls}`}>
                              {badge.letter}
                            </span>
                            <span className="score-font text-[18px] text-text-primary flex-shrink-0" style={{ fontFeatureSettings: '"tnum"' }}>
                              {teamFirst ? score : `${m.away_score ?? 0}–${m.home_score ?? 0}`}
                            </span>
                            <span className="flex-shrink-0 text-[10px] font-semibold uppercase text-text-muted">
                              {t("vs")}
                            </span>
                            <FlagCircle team={rival} apiFlag={rivalFlag} size={18} />
                            <span className="flex-1 min-w-0 text-xs text-text-secondary [overflow-wrap:anywhere] line-clamp-1">
                              {displayName(rival)}
                            </span>
                            <span className="flex-shrink-0 text-[10px] text-text-muted">
                              {fmtShortDate(m.scheduled_at, locale).split(",")[0]}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* ── Números (solo si ya jugó) ── */}
                {playedCount > 0 ? (
                  <section className="grid grid-cols-4 gap-2">
                    {[
                      { label: t("statGf"), value: info.stats.gf },
                      { label: t("statGa"), value: info.stats.ga },
                      { label: t("statGd"), value: info.stats.gf - info.stats.ga, signed: true },
                      { label: t("statCs"), value: info.stats.cleanSheets },
                    ].map((s) => (
                      <div key={s.label} className="bg-bg-elevated border border-border-subtle rounded-xl px-1 py-2.5 text-center min-w-0">
                        <p className="score-font text-[22px] leading-none text-text-primary" style={{ fontFeatureSettings: '"tnum"' }}>
                          {s.signed && (s.value as number) > 0 ? `+${s.value}` : s.value}
                        </p>
                        <p className="text-[9px] uppercase tracking-[0.06em] text-text-muted mt-1 leading-tight [overflow-wrap:anywhere]">
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </section>
                ) : null}

                {/* ── Su grupo ── */}
                {info.group && info.group.length > 0 ? (
                  <section className="space-y-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">
                      {facts?.group ? t("groupTitleLetter", { letter: facts.group }) : t("groupTitle")}
                    </h3>
                    <div className="bg-bg-elevated border border-border-subtle rounded-xl overflow-hidden">
                      <div className="grid grid-cols-[1.25rem_1fr_2rem_2rem_2.25rem] gap-1 px-3 py-1.5 text-[9px] uppercase tracking-[0.06em] text-text-muted border-b border-border-subtle">
                        <span />
                        <span>{t("thTeam")}</span>
                        <span className="text-center">{t("thPlayed")}</span>
                        <span className="text-center">{t("thDiff")}</span>
                        <span className="text-center">{t("thPoints")}</span>
                      </div>
                      {info.group.map((row, i) => {
                        const isSelf = row.team === team;
                        return (
                          <div
                            key={row.team}
                            className={`grid grid-cols-[1.25rem_1fr_2rem_2rem_2.25rem] gap-1 items-center px-3 py-2 ${
                              isSelf ? "bg-gold/10" : ""
                            } ${i > 0 ? "border-t border-border-subtle/50" : ""}`}
                          >
                            <span className="text-[10px] text-text-muted" style={{ fontFeatureSettings: '"tnum"' }}>{i + 1}</span>
                            <span className="flex items-center gap-1.5 min-w-0">
                              <FlagCircle team={row.team} apiFlag={row.flag} size={16} />
                              <span className={`text-xs min-w-0 [overflow-wrap:anywhere] line-clamp-1 ${isSelf ? "text-gold font-semibold" : "text-text-primary"}`}>
                                {displayName(row.team)}
                              </span>
                            </span>
                            <span className="text-center text-xs text-text-secondary" style={{ fontFeatureSettings: '"tnum"' }}>{row.played}</span>
                            <span className="text-center text-xs text-text-secondary" style={{ fontFeatureSettings: '"tnum"' }}>
                              {row.gf - row.ga > 0 ? `+${row.gf - row.ga}` : row.gf - row.ga}
                            </span>
                            <span className={`text-center text-xs font-bold ${isSelf ? "text-gold" : "text-text-primary"}`} style={{ fontFeatureSettings: '"tnum"' }}>
                              {row.points}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {/* ── Próximos partidos (live primero) ── */}
                {info.live.length + info.upcoming.length > 0 ? (
                  <section className="space-y-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">
                      {t("upcomingTitle")}
                    </h3>
                    <ul className="space-y-1.5">
                      {[...info.live, ...info.upcoming].map((m) => {
                        const teamIsHome = m.home_team === team;
                        const rival = teamIsHome ? m.away_team : m.home_team;
                        const rivalFlag = teamIsHome ? m.away_team_flag : m.home_team_flag;
                        const isLive = m.status === "live";
                        // Pronosticable: hay polla en contexto, el match es de
                        // la polla, está scheduled y faltan >5 min (espejo del
                        // trigger check_prediction_lock — el server revalida).
                        const inPolla = !pollaMatchIds || pollaMatchIds.length === 0 || pollaMatchIds.includes(m.id);
                        const canPredict =
                          Boolean(pollaSlug) && inPolla && m.status === "scheduled" && !isLockedForPrediction(m.scheduled_at);
                        const saved = savedPreds[m.id];
                        // Drafts RELATIVOS al equipo del sheet: home=izq=equipo
                        // de la ficha, away=der=rival. savePrediction invierte
                        // a home/away del match cuando el equipo va de visitante.
                        const savedLeft = saved ? (teamIsHome ? saved.home : saved.away) : null;
                        const savedRight = saved ? (teamIsHome ? saved.away : saved.home) : null;
                        const draft = predDrafts[m.id] ?? {
                          home: savedLeft !== null ? String(savedLeft) : "",
                          away: savedRight !== null ? String(savedRight) : "",
                        };
                        const draftComplete = draft.home !== "" && draft.away !== "";
                        const matchesSaved =
                          saved && draft.home === String(savedLeft) && draft.away === String(savedRight);
                        const setDraft = (side: "home" | "away", val: string) =>
                          setPredDrafts((prev) => ({ ...prev, [m.id]: { ...draft, [side]: val } }));
                        const predInputCls =
                          "w-9 h-9 text-center score-font text-[16px] rounded-[10px] outline-none bg-bg-card text-text-primary border border-border-subtle focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.25)] transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
                        return (
                          <li key={m.id} className="flex items-center gap-1.5 bg-bg-elevated border border-border-subtle rounded-xl px-2.5 py-2">
                            {/* Una sola línea: [bandera equipo] vs [bandera rival]
                                Rival(+fecha chiquita) [input]-[input] [icono ✓].
                                La bandera del equipo de la ficha ancla la fila. */}
                            <FlagCircle team={team} apiFlag={info.flag ?? fallbackFlag} size={18} />
                            <span className="flex-shrink-0 text-[9px] font-semibold uppercase text-text-muted">
                              {t("vs")}
                            </span>
                            <FlagCircle team={rival} apiFlag={rivalFlag} size={18} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-xs text-text-primary [overflow-wrap:anywhere] line-clamp-1">
                                {displayName(rival)}
                              </span>
                              <span className="block text-[9px] text-text-muted leading-tight">
                                {fmtShortDate(m.scheduled_at, locale)}
                              </span>
                            </span>
                            {isLive ? (
                              <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-red-alert/15 border border-red-alert/30 text-red-alert text-[10px] font-bold uppercase tracking-[0.08em]">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-alert animate-pulse" />
                                {t("liveBadge")}
                              </span>
                            ) : canPredict ? (
                              <span className="flex-shrink-0 inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={20}
                                  value={draft.home}
                                  onChange={(e) => {
                                    setDraft("home", e.target.value);
                                    // Autojump al input del rival apenas se tipea.
                                    if (e.target.value.length >= 1) rivalScoreRefs.current[m.id]?.focus();
                                  }}
                                  aria-label={displayName(team)}
                                  className={predInputCls}
                                />
                                <span className="text-text-primary/40 text-[10px] font-bold">–</span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={20}
                                  value={draft.away}
                                  onChange={(e) => setDraft("away", e.target.value)}
                                  ref={(el) => { rivalScoreRefs.current[m.id] = el; }}
                                  aria-label={displayName(rival)}
                                  className={predInputCls}
                                />
                                <button
                                  type="button"
                                  onClick={() => savePrediction(m)}
                                  disabled={!draftComplete || Boolean(matchesSaved) || savingMatchId === m.id}
                                  aria-label={matchesSaved ? t("predSavedChip") : t("predSave")}
                                  title={matchesSaved ? t("predSavedChip") : t("predSave")}
                                  className={`w-9 h-9 rounded-[10px] inline-flex items-center justify-center transition-all cursor-pointer disabled:cursor-default ${
                                    matchesSaved
                                      ? "bg-green-live/15 text-green-live border border-green-live/30"
                                      : "bg-gold text-bg-base hover:brightness-110 disabled:opacity-40"
                                  }`}
                                >
                                  <Check className={`w-4 h-4 ${savingMatchId === m.id ? "animate-pulse" : ""}`} aria-hidden="true" />
                                </button>
                              </span>
                            ) : saved ? (
                              /* Bloqueado pero ya pronosticado: mostrar el pick
                                 relativo al equipo de la ficha. */
                              <span className="flex-shrink-0 score-font text-[15px] text-text-secondary" style={{ fontFeatureSettings: '"tnum"' }}>
                                {savedLeft}–{savedRight}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
              </>
            )}
          </div>
          </div>
          {/* ── Panel 2 · Plantel ── */}
          <div className="snap-center w-full shrink-0 overflow-y-auto overscroll-contain">
            <div className="px-4 pt-4 space-y-5" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
              {rosterError ? (
                <div className="text-center py-10">
                  <p className="text-sm text-text-secondary">{t("rosterError")}</p>
                </div>
              ) : roster === null ? (
                /* Skeleton del plantel mientras carga */
                <div className="space-y-4 animate-pulse" aria-hidden="true">
                  {[0, 1].map((g) => (
                    <div key={g} className="space-y-2">
                      <div className="h-3 w-24 rounded bg-bg-elevated" />
                      {[0, 1, 2].map((r) => (
                        <div key={r} className="flex items-center gap-3 bg-bg-elevated border border-border-subtle rounded-xl px-3 py-2">
                          <div className="h-10 w-10 rounded-full bg-bg-card" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 w-1/2 rounded bg-bg-card" />
                            <div className="h-2.5 w-1/4 rounded bg-bg-card" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : roster.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="w-8 h-8 mx-auto mb-3 text-text-muted" aria-hidden="true" />
                  <p className="text-sm text-text-secondary">{t("rosterEmpty")}</p>
                </div>
              ) : (
                LINE_ORDER.map((line) => {
                  const group = roster.filter((p) => p.line === line);
                  if (group.length === 0) return null;
                  return (
                    <section key={line} className="space-y-2">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary/70">
                        {t(LINE_KEY[line])}
                      </h3>
                      <ul className="space-y-1.5">
                        {group.map((p, i) => (
                          <li
                            key={`${p.name}-${p.jersey ?? i}`}
                            className="flex items-center gap-3 bg-bg-elevated border border-border-subtle rounded-xl px-3 py-2"
                          >
                            <PlayerHeadshot name={p.name} headshot={p.headshot} jersey={p.jersey} />
                            {/* Nombre en su propia columna flex-1 (sobrevive
                                text-zoom: overflow-wrap, sin truncate horizontal
                                contra un centro fijo). */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-text-primary [overflow-wrap:anywhere] leading-tight">
                                {p.name}
                              </p>
                              <p className="text-[11px] text-text-muted leading-tight mt-0.5">
                                {[p.pos, p.age !== null ? t("ageShort", { age: p.age }) : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                              {/* Club actual (selecciones): escudo + nombre. */}
                              {p.club ? (
                                <p className="flex items-center gap-1.5 text-[11px] text-text-secondary leading-tight mt-1 min-w-0">
                                  <ClubCrest crest={p.clubCrest} />
                                  <span className="[overflow-wrap:anywhere] line-clamp-1">{p.club}</span>
                                </p>
                              ) : null}
                            </div>
                            {p.jersey ? (
                              <span
                                className="flex-shrink-0 score-font text-[18px] text-text-secondary"
                                style={{ fontFeatureSettings: '"tnum"' }}
                              >
                                {p.jersey}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>
          </div>
          {/* ── Panel 3 · Noticias ── */}
          <div className="snap-center w-full shrink-0 overflow-y-auto overscroll-contain">
            <div className="px-4 pt-4 space-y-3" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
              {newsError ? (
                <div className="text-center py-10">
                  <p className="text-sm text-text-secondary">{t("newsError")}</p>
                </div>
              ) : news === null ? (
                /* Skeleton de noticias mientras carga */
                <div className="space-y-3 animate-pulse" aria-hidden="true">
                  {[0, 1, 2].map((r) => (
                    <div key={r} className="bg-bg-elevated border border-border-subtle rounded-xl overflow-hidden">
                      <div className="h-32 w-full bg-bg-card" />
                      <div className="p-3 space-y-2">
                        <div className="h-3 w-3/4 rounded bg-bg-card" />
                        <div className="h-2.5 w-1/3 rounded bg-bg-card" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : news.length === 0 ? (
                <div className="text-center py-10">
                  <Newspaper className="w-8 h-8 mx-auto mb-3 text-text-muted" aria-hidden="true" />
                  <p className="text-sm text-text-secondary">{t("newsEmpty")}</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {news.map((n, i) => (
                    <li key={`${n.headline}-${i}`}>
                      <a
                        href={n.url ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block bg-bg-elevated border border-border-subtle rounded-xl overflow-hidden transition-all hover:border-gold/30 ${
                          n.url ? "cursor-pointer" : "pointer-events-none"
                        }`}
                      >
                        {n.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={n.image}
                            alt=""
                            loading="lazy"
                            className="w-full max-w-none h-36 object-cover bg-bg-card"
                          />
                        ) : null}
                        <div className="p-3 space-y-1.5">
                          <p className="text-sm font-semibold text-text-primary [overflow-wrap:anywhere] leading-snug">
                            {n.headline}
                          </p>
                          {n.description ? (
                            <p className="text-xs text-text-secondary [overflow-wrap:anywhere] leading-snug line-clamp-2">
                              {n.description}
                            </p>
                          ) : null}
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[11px] text-text-muted">
                              {fmtRelativeDate(n.publishedAt, locale)}
                            </span>
                            {n.url ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gold">
                                {t("newsReadMore")}
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
