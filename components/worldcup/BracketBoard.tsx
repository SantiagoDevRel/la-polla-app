"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, RotateCcw, Trophy, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { DURATION, EASE } from "@/lib/animations";

type GroupLetter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L";

type PhaseKey =
  | "round_of_32"
  | "round_of_16"
  | "quarter_finals"
  | "semi_finals"
  | "third_place"
  | "final";

export interface BracketBoardTeam {
  id: string;
  name: string;
  nameEs: string;
  group: GroupLetter;
  fifaRank: number;
  flagUrl: string | null;
}

export interface BracketBoardMatch {
  id: string;
  matchDay: number;
  phase: PhaseKey;
  phaseLabel: string;
  homeSlot: string;
  awaySlot: string;
  kickoffLabel: string | null;
  venue: string | null;
}

interface BracketBoardProps {
  teams: BracketBoardTeam[];
  matches: BracketBoardMatch[];
}

type Seed = 1 | 2 | 3;

type SlotConstraint =
  | { kind: "seed"; seed: Seed; groups: GroupLetter[] }
  | { kind: "advance"; result: "W" | "L"; matchDay: number };

type SlotSide = "home" | "away";

interface PositionedMatch extends BracketBoardMatch {
  x: number;
  y: number;
  side: "left" | "right" | "center";
}

interface DragState {
  teamId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface TeamPressState {
  teamId: string;
  pointerId: number;
  startX: number;
  startY: number;
  didDrag: boolean;
}

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

const BOARD_W = 1920;
const BOARD_H = 1120;
const MATCH_W = 188;
const MATCH_H = 86;
const FINAL_W = 228;
const FINAL_MATCH_DAY = 104;
const THIRD_PLACE_MATCH_DAY = 103;
const TEAM_DRAG_THRESHOLD = 8;
const GROUPS: GroupLetter[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const TOP_GROUPS: GroupLetter[] = ["A", "B", "C", "D", "E", "F"];
const BOTTOM_GROUPS: GroupLetter[] = ["G", "H", "I", "J", "K", "L"];

const POSITION_BY_DAY: Record<number, Pick<PositionedMatch, "x" | "y" | "side">> = {
  73: { x: 20, y: 280, side: "left" },
  74: { x: 20, y: 100, side: "left" },
  75: { x: 20, y: 370, side: "left" },
  76: { x: 1712, y: 100, side: "right" },
  77: { x: 20, y: 190, side: "left" },
  78: { x: 1712, y: 190, side: "right" },
  79: { x: 1712, y: 280, side: "right" },
  80: { x: 1712, y: 370, side: "right" },
  81: { x: 20, y: 790, side: "left" },
  82: { x: 20, y: 880, side: "left" },
  83: { x: 20, y: 610, side: "left" },
  84: { x: 20, y: 700, side: "left" },
  85: { x: 1712, y: 790, side: "right" },
  86: { x: 1712, y: 610, side: "right" },
  87: { x: 1712, y: 880, side: "right" },
  88: { x: 1712, y: 700, side: "right" },
  89: { x: 220, y: 145, side: "left" },
  90: { x: 220, y: 325, side: "left" },
  91: { x: 1512, y: 145, side: "right" },
  92: { x: 1512, y: 325, side: "right" },
  93: { x: 220, y: 655, side: "left" },
  94: { x: 220, y: 835, side: "left" },
  95: { x: 1512, y: 655, side: "right" },
  96: { x: 1512, y: 835, side: "right" },
  97: { x: 420, y: 235, side: "left" },
  98: { x: 420, y: 745, side: "left" },
  99: { x: 1312, y: 235, side: "right" },
  100: { x: 1312, y: 745, side: "right" },
  101: { x: 620, y: 490, side: "left" },
  102: { x: 1112, y: 490, side: "right" },
  103: { x: 846, y: 720, side: "center" },
  104: { x: 846, y: 452, side: "center" },
};

const PHASE_SHORT: Record<PhaseKey, string> = {
  round_of_32: "16avos",
  round_of_16: "Octavos",
  quarter_finals: "Cuartos",
  semi_finals: "Semis",
  third_place: "3er puesto",
  final: "Final",
};

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function slotKey(matchDay: number, side: SlotSide) {
  return `${matchDay}:${side}`;
}

function compactSlot(slot: string) {
  return slot.replaceAll("/", "").trim().toUpperCase();
}

function parseSlot(slot: string): SlotConstraint | null {
  const normalized = compactSlot(slot);
  const seedMatch = normalized.match(/^([123])([A-L]+)$/);
  if (seedMatch) {
    return {
      kind: "seed",
      seed: Number(seedMatch[1]) as Seed,
      groups: seedMatch[2].split("") as GroupLetter[],
    };
  }
  const advanceMatch = normalized.match(/^([WL])(\d+)$/);
  if (advanceMatch) {
    return {
      kind: "advance",
      result: advanceMatch[1] as "W" | "L",
      matchDay: Number(advanceMatch[2]),
    };
  }
  return null;
}

function canTeamOccupySlot(team: BracketBoardTeam, slot: string) {
  const parsed = parseSlot(slot);
  return parsed?.kind === "seed" && parsed.groups.includes(team.group);
}

function displaySlot(slot: string) {
  const parsed = parseSlot(slot);
  if (!parsed) return slot;
  if (parsed.kind === "advance") {
    return `${parsed.result}${parsed.matchDay}`;
  }
  return slot;
}

function unresolvedSlotLabel(slot: string) {
  const parsed = parseSlot(slot);
  if (!parsed) return "Por definir";
  if (parsed.kind === "advance") {
    return parsed.result === "W" ? `Ganador #${parsed.matchDay}` : `Perdedor #${parsed.matchDay}`;
  }
  if (parsed.seed === 1) return `Ganador grupo ${parsed.groups.join("/")}`;
  if (parsed.seed === 2) return `Segundo grupo ${parsed.groups.join("/")}`;
  return `Mejor tercero ${parsed.groups.join("/")}`;
}

function groupLabel(group: GroupLetter) {
  return `Grupo ${group}`;
}

function getMatchWidth(matchDay: number) {
  return matchDay === FINAL_MATCH_DAY || matchDay === THIRD_PLACE_MATCH_DAY ? FINAL_W : MATCH_W;
}

function getSlotPoint(match: PositionedMatch, side: SlotSide, toward: "left" | "right") {
  const w = getMatchWidth(match.matchDay);
  return {
    x: toward === "right" ? match.x + w : match.x,
    y: match.y + (side === "home" ? 31 : 65),
  };
}

function getCardCenter(match: PositionedMatch, toward: "left" | "right") {
  const w = getMatchWidth(match.matchDay);
  return {
    x: toward === "right" ? match.x + w : match.x,
    y: match.y + MATCH_H / 2,
  };
}

function resolveTeamIdFromSlot(
  slot: string,
  key: string,
  assignments: Record<string, string>,
  winners: Record<number, string>,
  matchesByDay: Map<number, PositionedMatch>,
): string | null {
  const parsed = parseSlot(slot);
  if (!parsed) return null;
  if (parsed.kind === "seed") return assignments[key] ?? null;
  if (parsed.result === "W") return winners[parsed.matchDay] ?? null;

  const source = matchesByDay.get(parsed.matchDay);
  if (!source) return null;
  const winnerId = winners[parsed.matchDay];
  if (!winnerId) return null;
  const homeId: string | null = resolveTeamIdFromSlot(
    source.homeSlot,
    slotKey(source.matchDay, "home"),
    assignments,
    winners,
    matchesByDay,
  );
  const awayId: string | null = resolveTeamIdFromSlot(
    source.awaySlot,
    slotKey(source.matchDay, "away"),
    assignments,
    winners,
    matchesByDay,
  );
  if (homeId && homeId !== winnerId) return homeId;
  if (awayId && awayId !== winnerId) return awayId;
  return null;
}

function pruneWinners(
  assignments: Record<string, string>,
  winners: Record<number, string>,
  matchesByDay: Map<number, PositionedMatch>,
) {
  const next = { ...winners };
  let changed = true;

  while (changed) {
    changed = false;
    for (const match of Array.from(matchesByDay.values())) {
      const winnerId = next[match.matchDay];
      if (!winnerId) continue;
      const homeId = resolveTeamIdFromSlot(
        match.homeSlot,
        slotKey(match.matchDay, "home"),
        assignments,
        next,
        matchesByDay,
      );
      const awayId = resolveTeamIdFromSlot(
        match.awaySlot,
        slotKey(match.matchDay, "away"),
        assignments,
        next,
        matchesByDay,
      );
      if (winnerId !== homeId && winnerId !== awayId) {
        delete next[match.matchDay];
        changed = true;
      }
    }
  }

  return next;
}

function getReachableMatchDays(matches: PositionedMatch[], validSlotIds: Set<string>) {
  const days = new Set<number>();

  for (const match of matches) {
    if (validSlotIds.has(slotKey(match.matchDay, "home")) || validSlotIds.has(slotKey(match.matchDay, "away"))) {
      days.add(match.matchDay);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const target of matches) {
      if (days.has(target.matchDay)) continue;
      const slots = [target.homeSlot, target.awaySlot];
      if (
        slots.some((slot) => {
          const parsed = parseSlot(slot);
          return parsed?.kind === "advance" && days.has(parsed.matchDay);
        })
      ) {
        days.add(target.matchDay);
        changed = true;
      }
    }
  }

  return days;
}

function TeamFlag({
  team,
  size = 22,
}: {
  team: BracketBoardTeam;
  size?: number;
}) {
  if (team.flagUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.flagUrl}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="max-w-none shrink-0 rounded-[4px] object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-[4px] bg-bg-elevated border border-border-subtle text-[9px] font-bold text-text-primary inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {team.nameEs.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ConnectorLayer({
  matches,
  isFocusMode,
  highlightedMatchDays,
}: {
  matches: PositionedMatch[];
  isFocusMode: boolean;
  highlightedMatchDays: Set<number>;
}) {
  const byDay = useMemo(() => new Map(matches.map((m) => [m.matchDay, m])), [matches]);
  const paths: Array<{ key: string; d: string; dashed: boolean; isHighlighted: boolean }> = [];

  for (const target of matches) {
    (["home", "away"] as SlotSide[]).forEach((slotSide) => {
      const slot = slotSide === "home" ? target.homeSlot : target.awaySlot;
      const parsed = parseSlot(slot);
      if (!parsed || parsed.kind !== "advance") return;
      const source = byDay.get(parsed.matchDay);
      if (!source) return;

      const sourceToward = source.x < target.x ? "right" : "left";
      const targetToward = source.x < target.x ? "left" : "right";
      const start = getCardCenter(source, sourceToward);
      const end = getSlotPoint(target, slotSide, targetToward);
      const mid = start.x + (end.x - start.x) / 2;
      paths.push({
        key: `${source.matchDay}-${target.matchDay}-${slotSide}`,
        d: `M ${start.x} ${start.y} H ${mid} V ${end.y} H ${end.x}`,
        dashed: parsed.result === "L",
        isHighlighted: highlightedMatchDays.has(source.matchDay) && highlightedMatchDays.has(target.matchDay),
      });
    });
  }

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      width={BOARD_W}
      height={BOARD_H}
      viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
    >
      {paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          fill="none"
          stroke={isFocusMode && path.isHighlighted ? "rgba(31,216,127,0.72)" : "rgba(255,255,255,0.18)"}
          strokeWidth={isFocusMode && path.isHighlighted ? "3" : "2"}
          opacity={isFocusMode ? (path.isHighlighted ? 1 : 0.14) : 1}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={path.dashed ? "8 8" : undefined}
          className="transition-opacity duration-200"
        />
      ))}
    </svg>
  );
}

function GroupBand({
  groups,
  teamsByGroup,
  className,
}: {
  groups: GroupLetter[];
  teamsByGroup: Map<GroupLetter, BracketBoardTeam[]>;
  className?: string;
}) {
  return (
    <div className={cn("absolute left-1/2 grid w-[900px] -translate-x-1/2 grid-cols-6 gap-2", className)}>
      {groups.map((group) => (
        <div key={group} className="rounded-md border border-border-subtle bg-bg-card/90 px-2 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            {groupLabel(group)}
          </div>
          <div className="flex items-center gap-1">
            {(teamsByGroup.get(group) ?? []).map((team) => (
              <span key={team.id} title={team.nameEs}>
                <TeamFlag team={team} size={18} />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({
  match,
  teamsById,
  assignments,
  winners,
  matchesByDay,
  activeTeam,
  validSlotIds,
  isFocusMode,
  highlightedMatchDays,
  onPlaceTeam,
  onRemoveAssignment,
  onPickWinner,
}: {
  match: PositionedMatch;
  teamsById: Map<string, BracketBoardTeam>;
  assignments: Record<string, string>;
  winners: Record<number, string>;
  matchesByDay: Map<number, PositionedMatch>;
  activeTeam: BracketBoardTeam | null;
  validSlotIds: Set<string>;
  isFocusMode: boolean;
  highlightedMatchDays: Set<number>;
  onPlaceTeam: (teamId: string, targetSlotKey: string) => void;
  onRemoveAssignment: (targetSlotKey: string) => void;
  onPickWinner: (matchDay: number, teamId: string) => void;
}) {
  const width = getMatchWidth(match.matchDay);
  const isFinal = match.matchDay === FINAL_MATCH_DAY;
  const isThird = match.matchDay === THIRD_PLACE_MATCH_DAY;
  const winnerId = winners[match.matchDay] ?? null;
  const hasValidDropSlot =
    validSlotIds.has(slotKey(match.matchDay, "home")) || validSlotIds.has(slotKey(match.matchDay, "away"));
  const isOnHighlightedPath = highlightedMatchDays.has(match.matchDay);

  const renderSlot = (side: SlotSide, slot: string) => {
    const key = slotKey(match.matchDay, side);
    const parsed = parseSlot(slot);
    const teamId = resolveTeamIdFromSlot(slot, key, assignments, winners, matchesByDay);
    const team = teamId ? teamsById.get(teamId) ?? null : null;
    const isDirectSlot = parsed?.kind === "seed";
    const isValidDrop = validSlotIds.has(key);
    const canPlaceSelected = Boolean(activeTeam && isDirectSlot && isValidDrop);
    const canPickWinner = Boolean(team && !isThird);
    const isWinner = Boolean(team && winnerId === team.id);
    const shouldDimSlot = isFocusMode && !isValidDrop;

    const handlePrimaryClick = () => {
      if (activeTeam && canPlaceSelected) {
        onPlaceTeam(activeTeam.id, key);
        return;
      }
      if (team && canPickWinner) {
        onPickWinner(match.matchDay, team.id);
      }
    };

    return (
      <div
        key={key}
        data-bracket-slot-id={key}
        data-board-interactive="true"
        className={cn(
          "relative flex h-[31px] items-center gap-2 rounded-md border px-2 transition-all duration-200",
          team ? "bg-bg-subtle border-border-subtle" : "bg-bg-base/70 border-border-subtle border-dashed",
          isValidDrop &&
            "z-10 border-turf/80 bg-turf/15 shadow-[0_0_18px_-9px_rgba(31,216,127,0.95)] ring-1 ring-turf/25",
          shouldDimSlot && "opacity-30",
          isWinner && "border-turf/50 bg-turf/12",
        )}
      >
        <button
          type="button"
          onClick={handlePrimaryClick}
          disabled={!canPlaceSelected && !canPickWinner}
          aria-label={
            team
              ? `Elegir ${team.nameEs} como ganador del partido ${match.matchDay}`
              : `${unresolvedSlotLabel(slot)} del partido ${match.matchDay}`
          }
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <span className="w-[48px] shrink-0 text-[10px] font-semibold tracking-[0.02em] text-text-primary">
            {displaySlot(slot)}
          </span>
          {team ? (
            <>
              <TeamFlag team={team} size={19} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">
                {team.nameEs}
              </span>
              {isWinner ? <Check className="h-3.5 w-3.5 shrink-0 text-turf" aria-hidden="true" /> : null}
            </>
          ) : (
            <span className={cn("min-w-0 flex-1 truncate text-[11px]", isValidDrop ? "text-turf" : "text-text-muted")}>
              {canPlaceSelected ? "Slot valido" : unresolvedSlotLabel(slot)}
            </span>
          )}
        </button>
        {team && isDirectSlot ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveAssignment(key);
            }}
            aria-label={`Quitar ${team.nameEs}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "absolute rounded-lg border bg-bg-card/95 p-2 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.8)] transition-all duration-200",
        isFinal ? "border-border-strong" : "border-border-subtle",
        isFocusMode && !hasValidDropSlot && !isOnHighlightedPath && "opacity-[0.28]",
        isFocusMode && !hasValidDropSlot && isOnHighlightedPath && "opacity-60",
        isFocusMode && hasValidDropSlot && "z-20 shadow-[0_0_24px_-12px_rgba(31,216,127,0.9)]",
      )}
      style={{ left: match.x, top: match.y, width, height: MATCH_H }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {isFinal ? "Final" : isThird ? "Tercer puesto" : PHASE_SHORT[match.phase]}
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-text-muted" style={{ fontFeatureSettings: '"tnum"' }}>
          #{match.matchDay}
        </span>
      </div>
      <div className="space-y-1">
        {renderSlot("home", match.homeSlot)}
        {renderSlot("away", match.awaySlot)}
      </div>
      {match.kickoffLabel ? (
        <div className="mt-1 truncate text-[9px] text-text-muted">{match.kickoffLabel}</div>
      ) : null}
    </div>
  );
}

export default function BracketBoard({ teams, matches }: BracketBoardProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const teamPressRef = useRef<TeamPressState | null>(null);
  const suppressTeamClickUntilRef = useRef(0);
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    worldX: number;
    worldY: number;
  } | null>(null);

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [winners, setWinners] = useState<Record<number, string>>({});
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupLetter | "all">("all");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [view, setView] = useState<ViewState>({ scale: 0.46, x: 120, y: 50 });

  const positionedMatches = useMemo<PositionedMatch[]>(
    () =>
      matches
        .map((match) => ({ ...match, ...POSITION_BY_DAY[match.matchDay] }))
        .filter((match): match is PositionedMatch => typeof match.x === "number")
        .sort((a, b) => a.matchDay - b.matchDay),
    [matches],
  );

  const matchesByDay = useMemo(
    () => new Map(positionedMatches.map((match) => [match.matchDay, match])),
    [positionedMatches],
  );

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const teamsByGroup = useMemo(() => {
    const out = new Map<GroupLetter, BracketBoardTeam[]>();
    for (const group of GROUPS) out.set(group, []);
    for (const team of teams) {
      out.get(team.group)?.push(team);
    }
    for (const groupTeams of Array.from(out.values())) {
      groupTeams.sort((a: BracketBoardTeam, b: BracketBoardTeam) => a.fifaRank - b.fifaRank);
    }
    return out;
  }, [teams]);

  const directSlots = useMemo(() => {
    const slots: Array<{ key: string; slot: string }> = [];
    for (const match of positionedMatches) {
      (["home", "away"] as SlotSide[]).forEach((side) => {
        const slot = side === "home" ? match.homeSlot : match.awaySlot;
        if (parseSlot(slot)?.kind === "seed") {
          slots.push({ key: slotKey(match.matchDay, side), slot });
        }
      });
    }
    return slots;
  }, [positionedMatches]);

  const activeTeamId = drag?.teamId ?? selectedTeamId;
  const activeTeam = activeTeamId ? teamsById.get(activeTeamId) ?? null : null;

  const validSlotIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeTeam) return ids;
    for (const slot of directSlots) {
      if (canTeamOccupySlot(activeTeam, slot.slot)) ids.add(slot.key);
    }
    return ids;
  }, [activeTeam, directSlots]);

  const highlightedMatchDays = useMemo(
    () => getReachableMatchDays(positionedMatches, validSlotIds),
    [positionedMatches, validSlotIds],
  );

  const isFocusMode = Boolean(activeTeam);

  const assignedTeamIds = useMemo(() => new Set(Object.values(assignments)), [assignments]);

  const filteredTeams = useMemo(
    () =>
      teams.filter((team) => {
        if (groupFilter !== "all" && team.group !== groupFilter) return false;
        return true;
      }),
    [groupFilter, teams],
  );

  const champion = useMemo(() => {
    const winnerId = winners[FINAL_MATCH_DAY];
    return winnerId ? teamsById.get(winnerId) ?? null : null;
  }, [teamsById, winners]);

  const resetView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const scale = clamp(Math.min(rect.width / 1040, rect.height / 690), 0.36, 0.72);
    setView({
      scale,
      x: rect.width / (2 * scale) - BOARD_W / 2,
      y: rect.height / (2 * scale) - 540,
    });
  }, []);

  useEffect(() => {
    resetView();
    const onResize = () => resetView();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resetView]);

  const placeTeam = useCallback(
    (teamId: string, targetSlotKey: string) => {
      const slot = directSlots.find((item) => item.key === targetSlotKey);
      const team = teamsById.get(teamId);
      if (!slot || !team || !canTeamOccupySlot(team, slot.slot)) return;

      setAssignments((prev) => {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (value !== teamId && key !== targetSlotKey) next[key] = value;
        }
        next[targetSlotKey] = teamId;
        setWinners((current) => pruneWinners(next, current, matchesByDay));
        return next;
      });
      setSelectedTeamId(null);
    },
    [directSlots, matchesByDay, teamsById],
  );

  const removeAssignment = useCallback(
    (targetSlotKey: string) => {
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[targetSlotKey];
        setWinners((current) => pruneWinners(next, current, matchesByDay));
        return next;
      });
    },
    [matchesByDay],
  );

  const pickWinner = useCallback(
    (matchDay: number, teamId: string) => {
      setWinners((prev) => {
        const next = { ...prev, [matchDay]: teamId };
        return pruneWinners(assignments, next, matchesByDay);
      });
    },
    [assignments, matchesByDay],
  );

  const resetBracket = useCallback(() => {
    setAssignments({});
    setWinners({});
    setSelectedTeamId(null);
    setDrag(null);
  }, []);

  const zoomAt = useCallback((nextScale: number, screenX?: number, screenY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const localX = (screenX ?? rect.left + rect.width / 2) - rect.left;
    const localY = (screenY ?? rect.top + rect.height / 2) - rect.top;

    setView((prev) => {
      const scale = clamp(nextScale, 0.28, 1.35);
      const worldX = localX / prev.scale - prev.x;
      const worldY = localY / prev.scale - prev.y;
      return {
        scale,
        x: localX / scale - worldX,
        y: localY / scale - worldY,
      };
    });
  }, []);

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-board-interactive='true']")) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    panRef.current = { x: event.clientX, y: event.clientY };
    pinchRef.current = null;
  };

  const handleViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(pointersRef.current.values());

    if (pointers.length >= 2) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const [a, b] = pointers;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;

      setView((prev) => {
        if (!pinchRef.current) {
          pinchRef.current = {
            distance,
            scale: prev.scale,
            worldX: midX / prev.scale - prev.x,
            worldY: midY / prev.scale - prev.y,
          };
        }
        const start = pinchRef.current;
        const scale = clamp(start.scale * (distance / Math.max(start.distance, 1)), 0.28, 1.35);
        return {
          scale,
          x: midX / scale - start.worldX,
          y: midY / scale - start.worldY,
        };
      });
      return;
    }

    if (pointers.length === 1 && panRef.current) {
      const dx = event.clientX - panRef.current.x;
      const dy = event.clientY - panRef.current.y;
      panRef.current = { x: event.clientX, y: event.clientY };
      setView((prev) => ({ ...prev, x: prev.x + dx / prev.scale, y: prev.y + dy / prev.scale }));
    }
  };

  const handleViewportPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) panRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // El browser puede liberar el pointer antes del handler de cierre.
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    zoomAt(view.scale + direction * 0.08, event.clientX, event.clientY);
  };

  const handleTeamClick = (teamId: string) => {
    if (Date.now() < suppressTeamClickUntilRef.current) return;
    setSelectedTeamId((current) => (current === teamId ? null : teamId));
  };

  const startTeamPress = (event: React.PointerEvent<HTMLButtonElement>, teamId: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    teamPressRef.current = {
      teamId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didDrag: false,
    };
    try {
      if (event.pointerType === "mouse") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } catch {
      // Algunos browsers liberan el pointer si el scroll nativo toma control.
    }
  };

  const updateTeamPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = teamPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;

    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    const distance = Math.hypot(dx, dy);
    if (!press.didDrag && distance < TEAM_DRAG_THRESHOLD) return;
    if (!press.didDrag && event.pointerType !== "mouse" && Math.abs(dx) > Math.abs(dy) * 1.2) return;

    event.preventDefault();
    press.didDrag = true;
    setSelectedTeamId(press.teamId);
    setDrag({
      teamId: press.teamId,
      x: event.clientX,
      y: event.clientY,
      startX: press.startX,
      startY: press.startY,
    });
  };

  const finishTeamPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = teamPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;

    if (press.didDrag) {
      suppressTeamClickUntilRef.current = Date.now() + 350;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const slotEl = el instanceof HTMLElement ? el.closest<HTMLElement>("[data-bracket-slot-id]") : null;
      const targetSlotKey = slotEl?.dataset.bracketSlotId;
      const targetSlot = targetSlotKey ? directSlots.find((slot) => slot.key === targetSlotKey) : null;
      const team = teamsById.get(press.teamId);

      if (targetSlotKey && targetSlot && team && canTeamOccupySlot(team, targetSlot.slot)) {
        placeTeam(press.teamId, targetSlotKey);
      } else {
        setSelectedTeamId(null);
      }
      setDrag(null);
    }

    teamPressRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // El browser puede haber soltado el capture antes del pointerup.
    }
  };

  const cancelTeamPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = teamPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (press.didDrag) {
      setSelectedTeamId(null);
      setDrag(null);
    }
    teamPressRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-[65] overflow-hidden bg-bg-base text-text-primary">
      <header
        className="absolute inset-x-0 top-0 z-30 border-b border-border-subtle bg-bg-base/95 px-3 backdrop-blur-xl"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-16 items-center gap-2">
          <Link
            href="/inicio"
            aria-label="Volver a inicio"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[22px] leading-none tracking-[0.04em] text-text-primary">
              Road to World Cup
            </p>
            <p className="truncate text-[11px] text-text-secondary">
              Arrastra selecciones a los slots posibles y toca ganadores para avanzar.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => zoomAt(view.scale - 0.12)}
              aria-label="Alejar"
              className="grid h-11 w-11 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => zoomAt(view.scale + 0.12)}
              aria-label="Acercar"
              className="grid h-11 w-11 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
            >
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={resetBracket}
            aria-label="Reiniciar bracket"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-3 text-[12px] font-semibold text-text-secondary transition-colors hover:text-text-primary"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Reiniciar</span>
          </button>
        </div>
      </header>

      <main
        ref={viewportRef}
        className="absolute inset-x-0 cursor-grab select-none overflow-hidden bg-[radial-gradient(circle_at_center,rgba(31,216,127,0.06),transparent_42%)] active:cursor-grabbing"
        style={{
          top: "calc(env(safe-area-inset-top) + 64px)",
          bottom: "calc(env(safe-area-inset-bottom) + 164px)",
          touchAction: "none",
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
        onWheel={handleWheel}
      >
        <motion.div
          className="absolute left-0 top-0"
          style={{
            width: BOARD_W,
            height: BOARD_H,
            transformOrigin: "0 0",
            transform: `scale(${view.scale}) translate(${view.x}px, ${view.y}px)`,
          }}
        >
          <div className="absolute inset-0 rounded-[32px] border border-border-subtle/40 bg-bg-base/40" />
          <GroupBand groups={TOP_GROUPS} teamsByGroup={teamsByGroup} className="top-3" />
          <ConnectorLayer
            matches={positionedMatches}
            isFocusMode={isFocusMode}
            highlightedMatchDays={highlightedMatchDays}
          />
          {positionedMatches.map((match) => (
            <MatchCard
              key={match.matchDay}
              match={match}
              teamsById={teamsById}
              assignments={assignments}
              winners={winners}
              matchesByDay={matchesByDay}
              activeTeam={activeTeam}
              validSlotIds={validSlotIds}
              isFocusMode={isFocusMode}
              highlightedMatchDays={highlightedMatchDays}
              onPlaceTeam={placeTeam}
              onRemoveAssignment={removeAssignment}
              onPickWinner={pickWinner}
            />
          ))}

          <div
            className={cn(
              "absolute rounded-xl border border-border-subtle bg-bg-card/95 p-3 text-center shadow-[0_12px_28px_-18px_rgba(0,0,0,0.9)] transition-opacity duration-200",
              isFocusMode && "opacity-60",
            )}
            style={{ left: 846, top: 558, width: FINAL_W }}
          >
            <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-strong bg-bg-elevated text-gold">
              <Trophy className="h-4 w-4" aria-hidden="true" />
            </div>
            <p className="font-display text-[18px] leading-none tracking-[0.04em] text-text-primary">
              World Champions
            </p>
            {champion ? (
              <div className="mt-2 flex items-center justify-center gap-2">
                <TeamFlag team={champion} size={22} />
                <span className="min-w-0 truncate text-[13px] font-semibold text-gold">{champion.nameEs}</span>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-text-muted">Elegí el ganador de la final.</p>
            )}
          </div>

          <GroupBand groups={BOTTOM_GROUPS} teamsByGroup={teamsByGroup} className="bottom-3" />
        </motion.div>
      </main>

      <aside
        className="absolute inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-bg-card/95 px-3 pt-3 backdrop-blur-xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
      >
        <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setGroupFilter("all")}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-[0.06em]",
              groupFilter === "all"
                ? "border-border-strong bg-bg-elevated text-text-primary"
                : "border-border-subtle text-text-secondary",
            )}
          >
            Todas
          </button>
          {GROUPS.map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => setGroupFilter(group)}
              className={cn(
                "h-8 w-8 shrink-0 rounded-full border text-[11px] font-bold",
                groupFilter === group
                  ? "border-turf/60 bg-turf/10 text-turf"
                  : "border-border-subtle text-text-secondary",
              )}
            >
              {group}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {filteredTeams.map((team) => {
            const isSelected = activeTeamId === team.id;
            const isAssigned = assignedTeamIds.has(team.id);
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => handleTeamClick(team.id)}
                onPointerDown={(event) => startTeamPress(event, team.id)}
                onPointerMove={updateTeamPress}
                onPointerUp={finishTeamPress}
                onPointerCancel={cancelTeamPress}
                draggable={false}
                className={cn(
                  "flex h-[76px] w-[104px] shrink-0 touch-pan-x flex-col justify-between rounded-lg border bg-bg-elevated px-2 py-2 text-left transition-all duration-200",
                  isSelected
                    ? "border-turf/80 bg-turf/10 shadow-[0_0_18px_-12px_rgba(31,216,127,0.9)]"
                    : "border-border-subtle",
                  isAssigned && !isSelected && "opacity-70",
                )}
                aria-pressed={isSelected}
              >
                <span className="flex items-center justify-between gap-2">
                  <TeamFlag team={team} size={24} />
                  <span className="rounded-full bg-bg-card px-1.5 py-0.5 text-[10px] font-bold text-text-secondary">
                    {team.group}
                  </span>
                </span>
                <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-text-primary [overflow-wrap:anywhere]">
                  {team.nameEs}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 text-[11px] text-text-muted">
          <span className="truncate">
            {activeTeam
              ? `${activeTeam.nameEs}: ${validSlotIds.size} slots posibles`
              : "Toca una seleccion o arrastrala a la llave."}
          </span>
          <span className="shrink-0" style={{ fontFeatureSettings: '"tnum"' }}>
            Zoom {Math.round(view.scale * 100)}%
          </span>
        </div>
      </aside>

      <AnimatePresence>
        {drag ? (
          <motion.div
            key="drag-team"
            className="pointer-events-none fixed z-[90] flex items-center gap-2 rounded-full border border-turf/60 bg-bg-elevated px-3 py-2 shadow-[0_12px_24px_-14px_rgba(0,0,0,0.9)]"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: DURATION.fast, ease: EASE.default }}
            style={{ left: drag.x + 10, top: drag.y + 10 }}
          >
            {teamsById.get(drag.teamId) ? <TeamFlag team={teamsById.get(drag.teamId)!} size={22} /> : null}
            <span className="max-w-[120px] truncate text-[12px] font-semibold text-text-primary">
              {teamsById.get(drag.teamId)?.nameEs}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
