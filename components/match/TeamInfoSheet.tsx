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

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { X, CalendarDays, Shield } from "lucide-react";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import { getTeamFacts } from "@/lib/teams/worldcup-facts";
import { DURATION, EASE } from "@/lib/animations";

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

// ─── Componente ───

export default function TeamInfoSheet({ team, fallbackFlag, tournament, onClose }: TeamInfoSheetProps) {
  const t = useTranslations("TeamInfo");
  const locale = useLocale();
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Portal a document.body: los ancestros del page traen transforms de
  // framer-motion que crean stacking contexts y dejarían el sheet DEBAJO
  // del BottomNav (z-50) aunque tenga z mayor. mounted evita el portal
  // durante SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: DURATION.medium, ease: EASE.default }}
      >
        <div className="bg-card border border-border-subtle rounded-t-[24px] sm:rounded-[24px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[85vh] overflow-y-auto overscroll-contain">
          {/* Grab handle + close */}
          <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm pt-3 pb-2 px-4 rounded-t-[24px]">
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

          {/* pb generoso + safe-area: el último item nunca queda pegado
              al borde inferior ni tapado en iPhones con home indicator. */}
          <div className="px-4 space-y-5" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
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
                      {t("groupTitle")}
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
                        const rival = m.home_team === team ? m.away_team : m.home_team;
                        const rivalFlag = m.home_team === team ? m.away_team_flag : m.home_team_flag;
                        const isLive = m.status === "live";
                        return (
                          <li key={m.id} className="flex items-center gap-2 bg-bg-elevated border border-border-subtle rounded-xl px-3 py-2">
                            {/* [bandera del equipo del sheet] vs [bandera rival] Rival —
                                ancla visual de a quién pertenece la ficha (feedback
                                user: "vs Chequia" solo no se entendía). */}
                            <FlagCircle team={team} apiFlag={info.flag ?? fallbackFlag} size={20} />
                            <span className="flex-shrink-0 text-[10px] font-semibold uppercase text-text-muted">
                              {t("vs")}
                            </span>
                            <FlagCircle team={rival} apiFlag={rivalFlag} size={20} />
                            <span className="flex-1 min-w-0 text-xs text-text-primary [overflow-wrap:anywhere] line-clamp-1">
                              {displayName(rival)}
                            </span>
                            {isLive ? (
                              <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-red-alert/15 border border-red-alert/30 text-red-alert text-[10px] font-bold uppercase tracking-[0.08em]">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-alert animate-pulse" />
                                {t("liveBadge")}
                              </span>
                            ) : (
                              <span className="flex-shrink-0 text-[10px] text-text-secondary text-right leading-tight">
                                {fmtShortDate(m.scheduled_at, locale)}
                                {m.venue ? <span className="block text-text-muted">{m.venue}</span> : null}
                              </span>
                            )}
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
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
