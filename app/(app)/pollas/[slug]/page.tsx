// app/(app)/pollas/[slug]/page.tsx — Vista completa de polla "estadio de noche"
// 4 tabs: Partidos, Ranking, Pagos, Info — con marcadores Bebas Neue y inputs gold glow
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";
import ParticipantPayment from "@/components/polla/ParticipantPayment";
import OrganizerPanel from "@/components/polla/OrganizerPanel";
import PrizeDistributionEditor from "@/components/polla/PrizeDistributionEditor";
import PrizeDistributionView from "@/components/polla/PrizeDistributionView";
import EmptyState from "@/components/ui/EmptyState";
import InviteModal from "@/components/polla/InviteModal";
import PhoneInput from "@/components/ui/PhoneInput";
import ScoringExplanation from "@/components/polla/ScoringExplanation";
import InlineScoringGuide from "@/components/polla/InlineScoringGuide";
import TournamentBadge from "@/components/shared/TournamentBadge";
import UserAvatar from "@/components/ui/UserAvatar";
import { getTournamentBySlug, getTournamentName, TOURNAMENT_ICONS } from "@/lib/tournaments";
import { getPollitoByPosition } from "@/lib/pollitos";
import { Trophy, Banknote, Info, Lock, Share2, Handshake, Settings, ChevronDown, Clock } from "lucide-react";

// Soccer-pitch icon for the Partidos tab — lucide's `Goal` glyph
// reads as a flag/post at small sizes, so we render a miniature
// soccer field (outer rect, halfway line, centre circle) instead.
function PitchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
import { TERMINAL_MATCH_STATUSES } from "@/lib/matches/constants";
import { computeLiveMinute, formatLiveMinute } from "@/lib/matches/live-minute";
import FootballLoader from "@/components/ui/FootballLoader";

// ─── Tipos ───

interface Polla {
  id: string; slug: string; name: string; description: string;
  tournament: string; status: string; buy_in_amount: number; currency: string;
  payment_mode: string; points_exact: number; points_winner: number;
  points_goal_diff: number; points_correct_result: number;
  points_one_team: number; created_by: string; scope: string; type: string;
  admin_payment_instructions: string | null;
  join_code: string | null;
  match_ids?: string[] | null;
  prize_distribution: {
    mode: "percentage" | "cop";
    prizes: { position: number; value: number }[];
  } | null;
}
interface Participant {
  id: string; user_id: string; role: string; status: string; total_points: number; rank: number;
  paid: boolean;
  payment_status: string;
  joined_at: string;
  users: { id: string; display_name: string; whatsapp_number: string; avatar_url: string | null };
}
interface Match {
  id: string; home_team: string; away_team: string; home_team_flag: string;
  away_team_flag: string; scheduled_at: string; status: string;
  home_score: number | null; away_score: number | null; phase: string | null;
  match_day: number | null;
  elapsed: number | null;
}
interface Prediction {
  id: string; match_id: string; predicted_home: number; predicted_away: number;
  locked: boolean; visible: boolean; points_earned: number;
}

type TabType = "partidos" | "ranking" | "pagos" | "info" | "organizar";

// TeamCrest — renders flag URL via next/image proxy, falls back to 3-letter abbreviation
function PaymentPendingBanner({ onGo }: { onGo: () => void }) {
  return (
    <div className="rounded-xl p-3 flex items-center gap-3 bg-gold/10 border border-gold/30">
      <Banknote className="w-5 h-5 text-gold shrink-0" aria-hidden="true" />
      <p className="text-xs text-text-primary flex-1 leading-snug">
        Tu pago está pendiente de aprobación. Ve a la tab Pagos para confirmar.
      </p>
      <button
        type="button"
        onClick={onGo}
        className="text-xs font-semibold bg-gold text-bg-base px-3 py-1.5 rounded-lg hover:brightness-110 transition-all shrink-0"
      >
        Ir a Pagos
      </button>
    </div>
  );
}

function TeamCrest({ flagUrl, teamName }: { flagUrl: string | null; teamName: string }) {
  if (flagUrl) {
    return (
      <Image
        src={flagUrl}
        alt={teamName}
        width={24}
        height={24}
        style={{ objectFit: "contain", borderRadius: "50%" }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <span style={{
      width: 24, height: 24, borderRadius: "50%",
      background: "#1a2540", display: "flex",
      alignItems: "center", justifyContent: "center",
      fontSize: 8, fontWeight: 700, color: "#F5F7FA",
    }}>
      {teamName.slice(0, 3).toUpperCase()}
    </span>
  );
}

// Shared single-line formatter for the match-row kickoff pill. "mar 23 ·
// 19:30" — same locale-aware output the old fmtDate helper produced,
// extracted so MatchRow can live at module scope without needing
// closure over the component state.
function formatKickoffShort(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Group date key (YYYY-MM-DD in the user's local timezone) used to bucket
// upcoming matches by kickoff day. Local timezone matters so a match at
// 19:30 CO time on Apr 24 never sneaks into the Apr 25 bucket just
// because UTC rolls over.
function dateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Human-friendly date header, e.g. "HOY · MIÉ 23 ABR" or "JUEVES 24 ABR".
function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const base = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(d);
  const pretty = base.replace(/\./g, "").toUpperCase();
  if (sameDay) return `HOY · ${pretty}`;
  if (isTomorrow) return `MAÑANA · ${pretty}`;
  return pretty;
}

// Spanish labels for the phase column. When the match sits in a league
// format (regular_season / league_stage) the tournament name — with its
// own logo — replaces the phase label so "regular_season" never leaks
// into the UI.
const PHASE_ES: Record<string, string> = {
  group_stage: "Fase de grupos",
  round_of_32: "16avos",
  round_of_16: "Octavos",
  quarter_finals: "Cuartos",
  semi_finals: "Semifinales",
  final: "Final",
  third_place: "Tercer puesto",
  playoff: "Repechaje",
};

function isLeagueFormatPhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  const p = phase.toLowerCase();
  return p === "regular_season" || p === "league_stage";
}

function phaseLabel(
  phase: string | null | undefined,
  tournamentSlug: string,
  matchDay: number | null | undefined,
): string {
  // League-format matches carry a match_day number (jornada). Surface it
  // so the user sees "Jornada 33" instead of just the tournament name.
  if (!phase || isLeagueFormatPhase(phase)) {
    if (matchDay) return `Jornada ${matchDay}`;
    return getTournamentName(tournamentSlug) ?? "Liga";
  }
  const normalised = phase.toLowerCase();
  return (
    PHASE_ES[normalised] ??
    phase.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function pointsTierClasses(points: number): string {
  if (points >= 5) return "bg-gold/15 text-gold border-gold/30";
  if (points >= 3) return "bg-turf/15 text-turf border-turf/30";
  if (points >= 2) return "bg-[#4fc3f7]/15 text-[#4fc3f7] border-[#4fc3f7]/30";
  if (points >= 1) return "bg-bg-elevated text-text-primary border-border-subtle";
  return "bg-bg-elevated text-text-primary/50 border-border-subtle";
}

function matchStatusAccent(m: Match, pointsEarned: number | null): string {
  if (m.status === "live") return "#FF3D57";
  if (m.status === "finished" && (pointsEarned ?? 0) >= 3) return "#1FD87F";
  if (m.status === "finished") return "rgba(255,255,255,0.08)";
  if (m.status === "cancelled" || m.status === "awarded") return "rgba(255,255,255,0.08)";
  return "#FFD700";
}

interface OtherPrediction {
  user_id: string;
  predicted_home: number;
  predicted_away: number;
  points_earned: number | null;
  display_name: string | null;
  avatar_url: string | null;
  is_me?: boolean;
}

interface MatchRowProps {
  match: Match;
  pred: Prediction | undefined;
  draft: { home: string; away: string } | undefined;
  editable: boolean;
  touched: boolean;
  onDraftChange: (side: "home" | "away", val: string) => void;
  onJumpNext: () => void;
  homeRef: ((el: HTMLInputElement | null) => void) | null;
  awayRef: ((el: HTMLInputElement | null) => void) | null;
  /** Polla's tournament slug. Drives the league-format phase label
   *  fallback so regular_season rows surface the tournament name +
   *  logo instead of raw enum text. */
  tournamentSlug: string;
  /** Pronósticos de los demás participantes para este partido. Solo se
   *  muestran cuando el match ya está bloqueado (live/finished o a <=5
   *  min del kickoff) — el server filtra eso. Pasar [] cuando todavía
   *  no hay nada que revelar. */
  otherPredictions: OtherPrediction[];
  locked: boolean;
}

function MatchRow({
  match,
  pred,
  draft,
  editable,
  touched,
  onDraftChange,
  onJumpNext,
  homeRef,
  awayRef,
  tournamentSlug,
  otherPredictions,
  locked,
}: MatchRowProps) {
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const pointsEarned = pred?.points_earned ?? null;
  const accent = matchStatusAccent(match, pointsEarned);
  const effectiveDraft = draft ?? {
    home: pred?.predicted_home?.toString() ?? "",
    away: pred?.predicted_away?.toString() ?? "",
  };

  return (
    <div className="lp-card relative overflow-hidden flex">
      {/* Left-edge status accent */}
      <div
        className={isLive ? "animate-pulse" : ""}
        style={{ width: 3, background: accent, flexShrink: 0 }}
      />
      <div className="flex-1 min-w-0 p-3">
        {/* Phase label + kickoff pill. League-format matches get the
            tournament logo + name; knockout phases get the Spanish
            phase translation. */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-text-primary/70 truncate">
            {isLeagueFormatPhase(match.phase) && TOURNAMENT_ICONS[tournamentSlug] ? (
              <Image
                src={TOURNAMENT_ICONS[tournamentSlug]!}
                alt=""
                width={12}
                height={12}
                className="object-contain flex-shrink-0"
              />
            ) : null}
            <span className="truncate">{phaseLabel(match.phase, tournamentSlug, match.match_day)}</span>
          </span>
          {isLive ? (() => {
            // Always compute locally — football-data's minute is
            // unreliable and our elapsed column mirrors it. The helper
            // deducts a 15-minute halftime allowance so the clock
            // aligns with broadcast time, and returns "90+" for
            // stoppage.
            const minuteLabel = formatLiveMinute(
              computeLiveMinute(match.scheduled_at),
            );
            return (
              <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-red-alert/15 border border-red-alert/30 text-red-alert text-[10px] font-bold uppercase tracking-[0.08em]">
                <span className="w-1.5 h-1.5 rounded-full bg-red-alert animate-pulse" />
                En vivo{minuteLabel ? ` · ${minuteLabel}` : ""}
              </span>
            );
          })() : isFinished ? (
            <span className="inline-flex items-center px-2 py-[2px] rounded-full bg-bg-elevated border border-border-subtle text-text-primary/70 text-[10px] font-bold uppercase tracking-[0.08em]">
              Final
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-[2px] rounded-full bg-gold/10 border border-gold/30 text-gold text-[10px] font-bold uppercase tracking-[0.08em]">
              {formatKickoffShort(match.scheduled_at)}
            </span>
          )}
        </div>

        {/* Teams + score / inputs */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <p className="font-semibold text-[13px] text-text-primary truncate min-w-0">
                {match.home_team}
              </p>
              <span className="flex-shrink-0">
                <TeamCrest flagUrl={match.home_team_flag} teamName={match.home_team} />
              </span>
            </div>
          </div>

          <div className="flex-shrink-0 flex items-center gap-2">
            {!editable ? (
              <div className="flex items-center gap-1.5 px-1.5">
                <span
                  className={`score-font leading-none ${
                    isLive ? "text-gold text-[36px]" : "text-text-primary text-[30px]"
                  }`}
                  style={{ fontFeatureSettings: '"tnum"' }}
                >
                  {match.home_score ?? "—"}
                </span>
                <span className="text-text-primary/40 text-lg">—</span>
                <span
                  className={`score-font leading-none ${
                    isLive ? "text-gold text-[36px]" : "text-text-primary text-[30px]"
                  }`}
                  style={{ fontFeatureSettings: '"tnum"' }}
                >
                  {match.away_score ?? "—"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={effectiveDraft.home}
                  ref={homeRef ?? undefined}
                  onChange={(e) => onDraftChange("home", e.target.value)}
                  placeholder=""
                  className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-[14px] outline-none bg-bg-elevated text-text-primary transition-all ${
                    touched
                      ? "border-amber shadow-[0_0_0_2px_rgba(255,159,28,0.25)]"
                      : "border-border-subtle focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                  }`}
                  style={{ border: "2px solid" }}
                />
                <span className="text-text-primary/40 font-bold">—</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={effectiveDraft.away}
                  ref={awayRef ?? undefined}
                  onChange={(e) => {
                    onDraftChange("away", e.target.value);
                    if (e.target.value.length >= 1) onJumpNext();
                  }}
                  placeholder=""
                  className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-[14px] outline-none bg-bg-elevated text-text-primary transition-all ${
                    touched
                      ? "border-amber shadow-[0_0_0_2px_rgba(255,159,28,0.25)]"
                      : "border-border-subtle focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                  }`}
                  style={{ border: "2px solid" }}
                />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span className="flex-shrink-0">
                <TeamCrest flagUrl={match.away_team_flag} teamName={match.away_team} />
              </span>
              <p className="font-semibold text-[13px] text-text-primary truncate min-w-0">
                {match.away_team}
              </p>
            </div>
          </div>
        </div>

        {/* Locked-but-predicted (live-section rows) */}
        {isLive && pred ? (
          <div className="mt-2 text-center">
            <p className="text-[11px] text-text-primary/70">
              Tu pronóstico · {pred.predicted_home}-{pred.predicted_away}
            </p>
          </div>
        ) : null}

        {/* Finished-match tier-coloured chip */}
        {isFinished && pred ? (
          <div className="mt-3 flex justify-center">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-[0.08em] ${pointsTierClasses(
                pointsEarned ?? 0,
              )}`}
            >
              Tu {pred.predicted_home}-{pred.predicted_away} ·{" "}
              {(pointsEarned ?? 0) > 0 ? `+${pointsEarned}` : "0"} pts
            </span>
          </div>
        ) : null}

        {/* Pronósticos de los demás — solo se muestra una vez el match
            está bloqueado (live/finished o <=5 min al kickoff). Hasta
            entonces los pronósticos siguen siendo privados. El server
            ya filtra qué predictions devuelve por match, así que aquí
            solo renderizamos lo que llegó. */}
        {locked && otherPredictions.length > 0 ? (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <p className="text-[10px] uppercase tracking-[0.1em] text-text-primary/60 mb-2">
              Pronósticos del parche · {otherPredictions.length}
            </p>
            <ul className="space-y-1.5">
              {otherPredictions.map((op) => {
                const showPoints = isFinished;
                const tierCls = showPoints
                  ? pointsTierClasses(op.points_earned ?? 0)
                  : "bg-bg-elevated text-text-primary border-border-subtle";
                return (
                  <li
                    key={op.user_id}
                    className={`flex items-center justify-between gap-2 ${
                      op.is_me ? "rounded-md bg-gold/8 px-1.5 -mx-1.5 py-0.5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar
                        avatarUrl={op.avatar_url}
                        displayName={op.display_name ?? "Jugador"}
                        size="sm"
                        className="!w-6 !h-6"
                      />
                      <span
                        className={`text-[12px] truncate ${
                          op.is_me ? "text-gold font-semibold" : "text-text-primary/85"
                        }`}
                      >
                        {op.display_name ?? "Jugador"}
                        {op.is_me ? <span className="text-[10px] text-gold/80 ml-1">(tú)</span> : null}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-[2px] rounded-full border text-[11px] font-semibold tabular-nums ${tierCls}`}
                      style={{ fontFeatureSettings: '"tnum"' }}
                    >
                      {op.predicted_home}-{op.predicted_away}
                      {showPoints ? (
                        <span className="text-[10px] opacity-80">
                          ·{" "}
                          {(op.points_earned ?? 0) > 0
                            ? `+${op.points_earned}`
                            : "0"}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PollaSlugPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const slug = params.slug as string;

  // Honor ?tab= on entry so deep-links from Inicio (RivalChip) land
  // directly on Tabla/Pagos/etc instead of the default Partidos view.
  const initialTab: TabType = (() => {
    const raw = searchParams.get("tab");
    const allowed: TabType[] = ["partidos", "ranking", "pagos", "info", "organizar"];
    return (allowed as string[]).includes(raw ?? "") ? (raw as TabType) : "partidos";
  })();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [polla, setPolla] = useState<Polla | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [allPredictions, setAllPredictions] = useState<
    Array<{
      match_id: string;
      user_id: string;
      predicted_home: number;
      predicted_away: number;
      points_earned: number | null;
    }>
  >([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [currentUserStatus, setCurrentUserStatus] = useState("approved");
  const [currentUserPaid, setCurrentUserPaid] = useState(true);
  const defaultTabAppliedRef = useRef(false);

  const [drafts, setDrafts] = useState<Record<string, { home: string; away: string }>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [touchedMatches, setTouchedMatches] = useState<Set<string>>(new Set());
  const [finishedOpen, setFinishedOpen] = useState(false);
  // Which upcoming-date groups are currently expanded. Defaults to the
  // earliest date on load so the next action is always visible; users
  // can collapse days they do not care about and expand the rest.
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  // Status-grouped partitions driving the Partidos tab. Timeline order:
  // Finalizados (collapsed history) → En vivo (locked display) →
  // Próximos (editable with auto-jump). Locked scheduled matches (kickoff
  // within 5 min) render alongside live in the En vivo section because
  // both share the "can no longer predict" behavior.
  const upcomingMatches = useMemo(
    () => matches.filter((m) => m.status === "scheduled" && !isLocked(m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, polla?.status],
  );
  const liveMatches = useMemo(
    () =>
      matches.filter(
        (m) =>
          m.status === "live" ||
          (m.status === "scheduled" && isLocked(m)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, polla?.status],
  );
  const finishedMatches = useMemo(
    () => matches.filter((m) => TERMINAL_MATCH_STATUSES.has(m.status)),
    [matches],
  );

  // Upcoming matches bucketed by local calendar date, in chronological
  // order. Each group gets a collapsible header in the Próximos section.
  const upcomingByDate = useMemo(() => {
    const bucketMap = new Map<string, Match[]>();
    for (const m of upcomingMatches) {
      const key = dateKey(m.scheduled_at);
      const list = bucketMap.get(key);
      if (list) list.push(m);
      else bucketMap.set(key, [m]);
    }
    return Array.from(bucketMap.entries()).map(([key, list]) => ({
      key,
      matches: list,
    }));
  }, [upcomingMatches]);

  // Default state: only TODAY's upcoming-date group starts expanded so
  // people who open the polla can see the matches they need to
  // predict right now. Everything else starts collapsed, including
  // tomorrow and beyond. Users manually expand the days they care
  // about. Preserves prior toggles by only touching the set while
  // it is still empty.
  useEffect(() => {
    if (upcomingByDate.length === 0) return;
    setExpandedDates((prev) => {
      if (prev.size > 0) return prev;
      const todayKey = dateKey(new Date().toISOString());
      const todayGroup = upcomingByDate.find((g) => g.key === todayKey);
      return todayGroup ? new Set([todayKey]) : new Set();
    });
  }, [upcomingByDate]);

  function toggleDate(key: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Focus the home input of the next upcoming match (after `fromId`).
  // Only walks the upcoming list so focus never lands on a live /
  // finished row. If the target match lives in a collapsed date group,
  // expand it first and defer focus to the next frame so the input DOM
  // exists when focus() fires.
  function focusNextUpcomingHome(fromId: string) {
    const idx = upcomingMatches.findIndex((m) => m.id === fromId);
    for (let i = idx + 1; i < upcomingMatches.length; i++) {
      const next = upcomingMatches[i];
      const el = homeInputRefs.current[next.id];
      if (el) {
        el.focus();
        return;
      }
      const nextKey = dateKey(next.scheduled_at);
      setExpandedDates((prev) => {
        if (prev.has(nextKey)) return prev;
        const updated = new Set(prev);
        updated.add(nextKey);
        return updated;
      });
      requestAnimationFrame(() => {
        homeInputRefs.current[next.id]?.focus();
      });
      return;
    }
  }
  // PhoneInput emits the full E.164 string (e.g. "+573001234567"). The invite
  // API normalizes by stripping "+" server-side, so we pass it through as-is.
  const [invitePhoneFull, setInvitePhoneFull] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const awayInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const homeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPolla(data.polla);
      setParticipants(data.participants);
      setMatches(data.matches);
      setPredictions(data.predictions);
      setAllPredictions(data.allPredictions || []);
      setCurrentUserId(data.currentUserId);
      setCurrentUserRole(data.currentUserRole);
      setCurrentUserStatus(data.currentUserStatus || "approved");
      setCurrentUserPaid(data.currentUserPaid ?? true);
      const d: Record<string, { home: string; away: string }> = {};
      data.predictions.forEach((p: Prediction) => {
        d[p.match_id] = { home: p.predicted_home.toString(), away: p.predicted_away.toString() };
      });
      setDrafts(d);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error cargando la polla");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadData(); }, [loadData]);

  // One-shot default-tab routing: admin_collects participants who have not
  // been confirmed by the organizer land on Pagos first. Ref guard avoids
  // overriding a later manual tab switch even if data re-loads.
  useEffect(() => {
    if (defaultTabAppliedRef.current) return;
    if (!polla) return;
    if (
      polla.payment_mode === "admin_collects" &&
      currentUserPaid === false &&
      currentUserRole !== "admin"
    ) {
      setActiveTab("pagos");
    }
    defaultTabAppliedRef.current = true;
  }, [polla, currentUserPaid, currentUserRole]);

  // Get match IDs that have been touched and have both scores filled
  const pendingSaveIds = Array.from(touchedMatches).filter((matchId) => {
    const d = drafts[matchId];
    return d && d.home !== "" && d.away !== "" && !isLocked(matches.find((m) => m.id === matchId)!);
  });

  async function saveAllPreds() {
    if (pendingSaveIds.length === 0) return;
    setSavingAll(true);
    try {
      await Promise.all(
        pendingSaveIds.map((matchId) => {
          const d = drafts[matchId];
          return axios.post(`/api/pollas/${slug}/predictions`, {
            matchId, predictedHome: parseInt(d.home), predictedAway: parseInt(d.away),
          });
        })
      );
      showToast(`${pendingSaveIds.length} pronóstico${pendingSaveIds.length > 1 ? "s" : ""} guardado${pendingSaveIds.length > 1 ? "s" : ""}`, "success");
      setTouchedMatches(new Set());
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPredictions(data.predictions);
      setAllPredictions(data.allPredictions || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error guardando", "error");
    } finally {
      setSavingAll(false);
    }
  }

  function getPred(matchId: string) { return predictions.find((p) => p.match_id === matchId); }

  function isLocked(m: Match) {
    if (polla?.status === "ended") return true;
    if (m.status === "live" || m.status === "finished") return true;
    return Date.now() >= new Date(m.scheduled_at).getTime() - 5 * 60 * 1000;
  }

  // Map de user_id -> {display_name, avatar_url} solo de participantes
  // approved+paid. Se usa para enriquecer los pronósticos de los demás
  // que devuelve el server (que no incluye user data) y para filtrar a
  // gente que ya no debería aparecer (rejected/unpaid).
  const participantInfoById = useMemo(() => {
    const m = new Map<string, { display_name: string | null; avatar_url: string | null }>();
    participants
      .filter((p) => p.status === "approved" && p.paid)
      .forEach((p) => {
        m.set(p.user_id, {
          display_name: p.users?.display_name ?? null,
          avatar_url: p.users?.avatar_url ?? null,
        });
      });
    return m;
  }, [participants]);

  // Agrupa los pronósticos de TODOS por match_id (incluido el usuario
  // actual marcado con is_me=true para que pueda verse junto a los demás).
  // Descarta los que ya no están en la lista de participantes approved+paid.
  const otherPredsByMatch = useMemo(() => {
    const out = new Map<string, OtherPrediction[]>();
    for (const ap of allPredictions) {
      const info = participantInfoById.get(ap.user_id);
      if (!info) continue;
      const arr = out.get(ap.match_id) ?? [];
      arr.push({
        user_id: ap.user_id,
        predicted_home: ap.predicted_home,
        predicted_away: ap.predicted_away,
        points_earned: ap.points_earned,
        display_name: info.display_name,
        avatar_url: info.avatar_url,
        is_me: ap.user_id === currentUserId,
      });
      out.set(ap.match_id, arr);
    }
    // Orden estable: por puntos (más a menos) cuando ya hay puntos,
    // si no por nombre.
    out.forEach((arr) => {
      arr.sort((a: OtherPrediction, b: OtherPrediction) => {
        const pa = a.points_earned ?? -1;
        const pb = b.points_earned ?? -1;
        if (pa !== pb) return pb - pa;
        return (a.display_name ?? "").localeCompare(b.display_name ?? "");
      });
    });
    return out;
  }, [allPredictions, currentUserId, participantInfoById]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="mb-3 flex justify-center"><FootballLoader /></div>
          <p className="text-text-secondary font-medium">Cargando polla...</p>
        </div>
      </div>
    );
  }

  if (error || !polla) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full lp-card">
          <div className="mb-3"><Info className="w-10 h-10 text-text-muted mx-auto" /></div>
          <p className="text-text-primary font-medium mb-4">{error || "Polla no encontrada"}</p>
          <button onClick={() => router.push("/inicio")} className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold">
            Volver
          </button>
        </div>
      </div>
    );
  }

  const isOrganizer = currentUserRole === "admin";

  // admin_collects pending: participant joined but the organizer has not
  // approved the comprobante. Gates the Partidos tab waiting state and
  // drives the amber banner on other tabs. Admins never see either.
  const showPaymentPending =
    polla.payment_mode === "admin_collects" &&
    currentUserPaid === false &&
    !isOrganizer;
  const TABS: { key: TabType; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "partidos", label: "Partidos", icon: <PitchIcon className="w-4 h-4" />, show: true },
    { key: "ranking", label: "Tabla", icon: <Trophy className="w-4 h-4" />, show: true },
    { key: "pagos", label: "Pagos", icon: <Banknote className="w-4 h-4" />, show: polla.payment_mode !== "pay_winner" },
    { key: "organizar", label: "Admin", icon: <Settings className="w-4 h-4" />, show: isOrganizer },
    { key: "info", label: "Info", icon: <Info className="w-4 h-4" />, show: true },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => router.push("/pollas")} className="text-text-secondary text-xl">←</button>
            <h1 className="text-lg font-bold text-text-primary truncate flex-1">{polla.name}</h1>
            <span
              className="text-[11px] text-text-secondary rounded-full flex items-center"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 20,
                padding: "4px 10px",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TournamentBadge tournamentSlug={polla.tournament} size="sm" />
            </span>
          </div>
        </div>
      </header>

      {/* Pot band — single-line summary of the pot + a compact scoring
          helper icon. The previous rank/points/payment-status band was
          redundant with the ranking tab and crowded the header; the
          pot + (i) is the only context strip now. */}
      {polla.buy_in_amount > 0 && (() => {
        // En 'admin_collects' (pago de entrada) el pozo solo refleja la
        // plata efectivamente recaudada — solo cuentan los participantes
        // marcados como pagados. En 'pay_winner' no hay flujo de pagos
        // intermedio, así que se cuentan todos los aprobados.
        const countedCount =
          polla.payment_mode === "admin_collects"
            ? participants.filter((p) => p.status === "approved" && p.paid).length
            : participants.filter((p) => p.status === "approved").length;
        const total = polla.buy_in_amount * countedCount;
        return (
          <div className="px-4 py-1.5 bg-bg-elevated border-b border-border-subtle">
            <div className="max-w-lg mx-auto text-center text-xs text-text-primary flex items-center justify-center gap-1.5">
              <span>
                Pozo: <span className="font-semibold text-gold">${total.toLocaleString("es-CO")}</span> total{" "}
                <span className="text-text-primary/70">(${polla.buy_in_amount.toLocaleString("es-CO")} por persona)</span>
              </span>
              <ScoringExplanation compact />
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4 pt-3">
        <div className="flex overflow-x-auto gap-0 border-b border-border-subtle" style={{ scrollbarWidth: "none" }}>
          {TABS.filter((t) => t.show).map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-1.5 ${
                activeTab === t.key ? "text-gold border-gold" : "text-text-muted border-transparent hover:text-text-secondary"
              }`}
              style={{ color: activeTab === t.key ? "#FFD700" : "#F5F7FA" }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        {/* ── TAB PARTIDOS ── */}
        {activeTab === "partidos" && showPaymentPending && (
          <div className="rounded-2xl p-6 text-center lp-card space-y-3">
            <Banknote className="w-10 h-10 text-gold mx-auto" />
            <div>
              <h2 className="text-lg font-bold text-text-primary mb-1">Esperando aprobación del organizador</h2>
              <p className="text-sm text-text-secondary">
                Una vez confirmado tu pago, vas a poder pronosticar.
              </p>
            </div>
            <button
              onClick={() => setActiveTab("pagos")}
              className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all"
            >
              Ir a Pagos
            </button>
          </div>
        )}
        {activeTab === "partidos" && !showPaymentPending && (
          <>
            {currentUserStatus === "rejected" && (
              <div className="rounded-xl p-4 bg-red-alert/10 border border-red-alert/20 text-center mb-3">
                <p className="text-sm text-red-alert font-semibold">Tu solicitud fue rechazada</p>
                <p className="text-xs text-text-secondary mt-1">El admin de esta polla rechazó tu solicitud de ingreso.</p>
              </div>
            )}
            {matches.length === 0 ? (
              <div className="lp-card p-6 text-center" style={{ backgroundColor: "rgba(14, 20, 32, 0.4)" }}>
                <p className="text-text-primary">No hay partidos cargados aun. Los partidos se actualizaran cuando el calendario sea confirmado.</p>
              </div>
            ) : (
              <div className="space-y-5 pb-32">
                {/* ── Finalizados — plain collapsible header, match cards
                    render directly below without a surrounding card so
                    we avoid the "card-in-card" look. ── */}
                {finishedMatches.length > 0 && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setFinishedOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-1 py-1"
                      aria-expanded={finishedOpen}
                    >
                      <span className="lp-section-title flex items-center gap-2" style={{ fontSize: 14 }}>
                        <Lock className="w-3.5 h-3.5 text-text-primary/60" />
                        Finalizados
                        <span className="text-text-primary/60 font-normal">· {finishedMatches.length}</span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-text-primary/70 transition-transform ${finishedOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    {finishedOpen && (
                      <div className="space-y-3">
                        {finishedMatches.map((match) => (
                          <MatchRow
                            key={match.id}
                            match={match}
                            pred={getPred(match.id)}
                            draft={drafts[match.id]}
                            editable={false}
                            touched={touchedMatches.has(match.id)}
                            onDraftChange={() => { /* not editable */ }}
                            onJumpNext={() => { /* not editable */ }}
                            homeRef={null}
                            awayRef={null}
                            tournamentSlug={polla.tournament}
                            otherPredictions={otherPredsByMatch.get(match.id) ?? []}
                            locked={isLocked(match)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── En vivo — live + locked-scheduled; non-editable display ── */}
                {liveMatches.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="lp-section-title flex items-center gap-2 px-1" style={{ fontSize: 14 }}>
                      <span className="w-2 h-2 rounded-full bg-red-alert animate-pulse" />
                      En vivo
                      <span className="text-text-primary/60 font-normal">· {liveMatches.length}</span>
                    </h3>
                    <div className="space-y-3">
                      {liveMatches.map((match) => (
                        <MatchRow
                          key={match.id}
                          match={match}
                          pred={getPred(match.id)}
                          draft={drafts[match.id]}
                          editable={false}
                          touched={touchedMatches.has(match.id)}
                          onDraftChange={() => { /* not editable */ }}
                          onJumpNext={() => { /* not editable */ }}
                          homeRef={null}
                          awayRef={null}
                          tournamentSlug={polla.tournament}
                          otherPredictions={otherPredsByMatch.get(match.id) ?? []}
                          locked={isLocked(match)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Próximos — grouped by kickoff day; each day is a
                    plain collapsible (no surrounding card). First day
                    expanded by default. Auto-jump across days works
                    because focusNextUpcomingHome auto-expands the
                    target group when it is collapsed. ── */}
                {upcomingMatches.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="lp-section-title flex items-center gap-2 px-1" style={{ fontSize: 14 }}>
                      <Clock className="w-3.5 h-3.5 text-gold" />
                      Próximos
                      <span className="text-text-primary/60 font-normal">· {upcomingMatches.length}</span>
                    </h3>
                    {upcomingByDate.map((group) => {
                      const open = expandedDates.has(group.key);
                      return (
                        <div key={group.key} className="space-y-2">
                          <button
                            type="button"
                            onClick={() => toggleDate(group.key)}
                            className="w-full flex items-center justify-between px-1 py-1"
                            aria-expanded={open}
                          >
                            <span className="text-[11px] font-bold tracking-[0.08em] uppercase text-text-primary/80">
                              {formatDateHeader(group.matches[0].scheduled_at)}
                              <span className="text-text-primary/50 font-normal ml-1.5">· {group.matches.length}</span>
                            </span>
                            <ChevronDown
                              className={`w-4 h-4 text-text-primary/70 transition-transform ${open ? "rotate-180" : ""}`}
                              aria-hidden="true"
                            />
                          </button>
                          {open && (
                            <div className="space-y-3">
                              {group.matches.map((match) => (
                                <MatchRow
                                  key={match.id}
                                  match={match}
                                  pred={getPred(match.id)}
                                  draft={drafts[match.id]}
                                  editable={true}
                                  touched={touchedMatches.has(match.id)}
                                  onDraftChange={(side, val) => {
                                    const cur = drafts[match.id] ?? { home: "", away: "" };
                                    setDrafts((prev) => ({ ...prev, [match.id]: { ...cur, [side]: val } }));
                                    setTouchedMatches((prev) => new Set(prev).add(match.id));
                                    if (side === "home" && val.length >= 1) {
                                      awayInputRefs.current[match.id]?.focus();
                                    }
                                  }}
                                  onJumpNext={() => focusNextUpcomingHome(match.id)}
                                  homeRef={(el) => { homeInputRefs.current[match.id] = el; }}
                                  awayRef={(el) => { awayInputRefs.current[match.id] = el; }}
                                  tournamentSlug={polla.tournament}
                                  otherPredictions={otherPredsByMatch.get(match.id) ?? []}
                                  locked={isLocked(match)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Sticky bulk save button — hidden once polla ends. Uses
                bottom-26 (104px) so it sits above the BottomNav (90px tall
                + 14px from screen bottom) instead of tucking under it. */}
            {polla.status !== "ended" && pendingSaveIds.length > 0 && (
              <div className="fixed bottom-[104px] left-0 right-0 px-4 z-30">
                <div className="max-w-lg mx-auto">
                  <button
                    onClick={saveAllPreds}
                    disabled={savingAll}
                    className="w-full bg-gold text-bg-base font-display text-lg tracking-wide py-3.5 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 shadow-[0_0_24px_rgba(255,215,0,0.25)] cursor-pointer"
                  >
                    {savingAll ? "Guardando..." : `GUARDAR ${pendingSaveIds.length} PRONÓSTICO${pendingSaveIds.length > 1 ? "S" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── TAB RANKING ── */}
        {activeTab === "ranking" && (
          <div className="space-y-3">
            {showPaymentPending && <PaymentPendingBanner onGo={() => setActiveTab("pagos")} />}
            {polla.status === "ended" && participants[0] && (
              <div
                className="w-full rounded-2xl px-4 py-3 flex items-center gap-3"
                style={{
                  background: "#FFD700",
                  color: "#080c10",
                  boxShadow: "0 0 24px rgba(255,215,0,0.25)",
                }}
              >
                <Trophy className="w-6 h-6 flex-shrink-0" />
                <p className="text-sm font-bold leading-snug">
                  {participants[0].users?.display_name || "El ganador"} ganó esta polla con {participants[0].total_points} puntos
                </p>
              </div>
            )}
            <div className="rounded-2xl overflow-hidden lp-card">
            {participants.length === 0 ? (
              <EmptyState
                title="Aún no hay participantes"
                subtitle="Comparte el link de invitación desde la pestaña Organizar para empezar."
              />
            ) : (
              <>
                {matches.every((m) => m.status === "scheduled") && (
                  <div className="px-4 py-3 text-xs text-text-secondary text-center" style={{ backgroundColor: "var(--bg-card-elevated)" }}>
                    El ranking se actualiza cuando terminen los partidos
                  </div>
                )}
                {/* Leaderboard excludes paid=false rows: admin_collects
                    participants awaiting approval. Those rows still show
                    up in the Pagos tab for admin review. */}
                {participants
                  .filter((p) => p.paid)
                  .sort((a, b) => {
                    // Sort by cached rank ascending (RANK() window function
                    // gives ties the same rank). Secondary sort by joined_at
                    // so tied rows display in a stable "earliest joiner
                    // first" order.
                    const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
                    const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
                    if (ra !== rb) return ra - rb;
                    return (a.joined_at || "").localeCompare(b.joined_at || "");
                  })
                  .map((p) => {
                    const isMe = p.user_id === currentUserId;
                    const rankLabel = p.rank ? `#${p.rank}` : "—";
                    const rankColor =
                      p.rank === 1
                        ? "text-gold"
                        : p.rank && p.rank <= 3
                        ? "text-gold"
                        : "text-text-muted";

                    return (
                      <div key={p.id}
                        className={`flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 ${isMe ? "bg-gold-dim" : ""}`}
                        style={isMe ? { borderLeft: "2px solid var(--gold)" } : undefined}
                      >
                        <span className={`score-font text-[18px] w-10 text-center tabular-nums ${rankColor}`} style={{ fontFeatureSettings: '"tnum"' }}>
                          {rankLabel}
                        </span>
                        <img
                          src={getPollitoByPosition(p.users?.avatar_url, p.rank || 999, participants.length)}
                          alt={p.users?.display_name || ""}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm truncate ${isMe ? "text-gold font-bold" : "text-text-primary"}`}>
                            {p.users?.display_name || "Usuario"}
                            {isMe && <span className="ml-1 text-xs text-gold">(tú)</span>}
                          </p>
                          {polla.payment_mode === "admin_collects" && (
                            <p className="text-xs text-text-muted">{p.paid ? "Pagado" : "Pendiente"}</p>
                          )}
                        </div>
                        <span className="score-font text-[18px] text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>{p.total_points}</span>
                      </div>
                    );
                  })}
              </>
            )}
            </div>

            {/* Prize distribution lives inside Tabla so all participants
                can see what's at stake. Admins get the editor in-place;
                everyone else sees the read-only view. El pot se calcula
                igual que el header: en 'admin_collects' solo cuentan los
                pagados, en 'pay_winner' todos los aprobados. */}
            {(() => {
              const countedCount =
                polla.payment_mode === "admin_collects"
                  ? participants.filter((p) => p.status === "approved" && p.paid).length
                  : participants.filter((p) => p.status === "approved").length;
              const pot = polla.buy_in_amount * countedCount;
              return isOrganizer ? (
                <PrizeDistributionEditor
                  pollaSlug={polla.slug}
                  pot={pot}
                  initial={polla.prize_distribution ?? null}
                />
              ) : (
                <PrizeDistributionView
                  pot={pot}
                  distribution={polla.prize_distribution ?? null}
                />
              );
            })()}
          </div>
        )}

        {/* ── TAB PAGOS ── */}
        {activeTab === "pagos" && polla.payment_mode !== "pay_winner" && (
          <ParticipantPayment pollaSlug={polla.slug} currentUserId={currentUserId} currentUserRole={currentUserRole} />
        )}

        {/* ── TAB ORGANIZAR (admin only) ── */}
        {activeTab === "organizar" && isOrganizer && (
          <OrganizerPanel
            pollaSlug={polla.slug}
            pollaName={polla.name}
            pollaStatus={polla.status}
            paymentMode={polla.payment_mode}
            buyInAmount={polla.buy_in_amount}
            matchIds={matches.map((m) => m.id)}
            joinCode={polla.join_code}
          />
        )}

        {/* ── TAB INFO ── */}
        {activeTab === "info" && (
          <div className="space-y-4">
            {showPaymentPending && <PaymentPendingBanner onGo={() => setActiveTab("pagos")} />}
            <div className="rounded-2xl p-5 space-y-3 lp-card">
              <h3 className="font-bold text-text-primary">{polla.name}</h3>
              {polla.description && <p className="text-sm text-text-secondary">{polla.description}</p>}
              <div className="grid grid-cols-3 gap-2 text-sm">
                {[
                  { label: "Torneo", value: getTournamentBySlug(polla.tournament)?.name || polla.tournament },
                  { label: "Participantes", value: String(participants.length) },
                  {
                    label: "Pago",
                    value:
                      polla.payment_mode === "admin_collects"
                        ? "Pago al principio"
                        : polla.payment_mode === "pay_winner"
                          ? "Pago al final"
                          : "Pago digital",
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl p-2 bg-bg-elevated">
                    <p className="text-[10px] text-text-muted">{item.label}</p>
                    <p className="font-medium text-text-primary text-sm">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-5 lp-card">
              <h4 className="font-bold text-text-primary mb-3">Sistema de puntos</h4>
              <InlineScoringGuide
                points={{
                  exact: polla.points_exact,
                  goalDiff: polla.points_goal_diff ?? 3,
                  winner: polla.points_correct_result ?? 2,
                  oneTeam: polla.points_one_team,
                }}
              />
            </div>

            {/* WhatsApp invite for the admin to share the polla */}
            {currentUserRole === "admin" && (
              <div className="rounded-2xl p-5 lp-card space-y-3">
                <h4 className="font-bold text-text-primary flex items-center gap-2">
                  <Handshake className="w-4 h-4 text-gold" /> Invitar participante
                </h4>
                <p className="text-xs text-text-secondary">Envía una invitación por WhatsApp a esta polla privada.</p>
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <PhoneInput
                      onChange={(val) => {
                        setInvitePhoneFull(val);
                        setInviteMsg(null);
                      }}
                    />
                  </div>
                  <button
                    disabled={
                      inviteSending ||
                      invitePhoneFull.replace(/\D/g, "").length < 9
                    }
                    onClick={async () => {
                      setInviteSending(true);
                      setInviteMsg(null);
                      try {
                        const { data: res } = await axios.post(`/api/pollas/${slug}/invite`, { whatsapp_number: invitePhoneFull });
                        if (res.unregistered && res.shareLink) {
                          setInviteMsg({ text: `No registrado. Comparte este link: ${res.shareLink}`, type: "success" });
                        } else {
                          setInviteMsg({ text: "¡Invitación enviada!", type: "success" });
                        }
                        setInvitePhoneFull("");
                      } catch (err: unknown) {
                        const e = err as { response?: { data?: { error?: string } } };
                        setInviteMsg({ text: e.response?.data?.error || "Error enviando", type: "error" });
                      } finally {
                        setInviteSending(false);
                      }
                    }}
                    className="bg-gold text-bg-base font-semibold px-4 py-3 rounded-xl text-sm hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer"
                  >
                    {inviteSending ? "..." : "Enviar"}
                  </button>
                </div>
                {inviteMsg && (
                  <p className={`text-xs ${inviteMsg.type === "success" ? "text-green-live" : "text-red-alert"}`}>
                    {inviteMsg.text}
                  </p>
                )}
              </div>
            )}

            <button onClick={() => setShowInviteModal(true)} className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all">
              <Share2 className="w-4 h-4 inline-block mr-1" /> Invitar amigos
            </button>
          </div>
        )}
      </main>

      {showInviteModal && (
        <InviteModal
          pollaSlug={polla.slug}
          pollaName={polla.name}
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          joinCode={polla.join_code}
          canRotate={currentUserRole === "admin"}
        />
      )}
    </div>
  );
}
