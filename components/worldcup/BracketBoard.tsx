"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ArrowLeft, Check, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { BACKGROUND_SOURCES } from "@/components/layout/background-variants";
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
type HalfKey = "left" | "right";
type OpenTarget = string;
type ButterflyPhase = Extract<PhaseKey, "round_of_32" | "round_of_16" | "quarter_finals" | "semi_finals">;

interface PositionedMatch extends BracketBoardMatch {
  half: HalfKey | "center";
  depth: number;
}

interface SlotInfo {
  key: string;
  match: PositionedMatch;
  side: SlotSide;
  slot: string;
}

interface SlotGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ColumnGeometry {
  label: string;
  x: number;
  w: number;
  isFinal?: boolean;
}

interface ButterflyLayout {
  width: number;
  height: number;
  slotH: number;
  centerX: number;
  centerW: number;
  columns: ColumnGeometry[];
  slots: Record<string, SlotGeometry>;
  centers: Record<number, number>;
  meta: Record<number, { half: HalfKey | "center"; depth: number; x: number; w: number }>;
}

interface DragState {
  teamId: string;
  x: number;
  y: number;
}

interface TeamPressState {
  teamId: string;
  pointerId: number;
  startX: number;
  startY: number;
  disabled: boolean;
  didDrag: boolean;
}

const FINAL_MATCH_DAY = 104;
const THIRD_PLACE_MATCH_DAY = 103;
const CHAMPION_TARGET = "champion";
const TEAM_DRAG_THRESHOLD = 8;
const PICKER_BOTTOM = 92;
const BOTTOM_NAV_CLEARANCE = 64;
const BOARD_BOTTOM_MARGIN = 18;
const BOARD_BOTTOM_PADDING = BOTTOM_NAV_CLEARANCE + BOARD_BOTTOM_MARGIN;
const PICKER_CLOSE_DRAG_OFFSET = 74;
const PICKER_CLOSE_DRAG_VELOCITY = 650;
const SAVE_KEY = "lapolla-road-to-worldcup-path";
const ONBOARDING_HINT_KEY = "lapolla-road-to-worldcup-hint-dismissed";
const BRACKET_BACKGROUND = BACKGROUND_SOURCES["nuevo-background"];
const GROUPS: GroupLetter[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const BUTTERFLY_PHASES: ButterflyPhase[] = [
  "round_of_32",
  "round_of_16",
  "quarter_finals",
  "semi_finals",
];
const DEPTH_BY_PHASE: Record<ButterflyPhase, number> = {
  round_of_32: 0,
  round_of_16: 1,
  quarter_finals: 2,
  semi_finals: 3,
};
const ROUND_LABEL_BY_PHASE: Record<ButterflyPhase | "final", string> = {
  round_of_32: "16avos",
  round_of_16: "8vos",
  quarter_finals: "4tos",
  semi_finals: "Semis",
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
    return parsed.result === "W" ? `G${parsed.matchDay}` : `P${parsed.matchDay}`;
  }
  if (parsed.seed === 3) return "3º";
  return `${parsed.seed}${parsed.groups.join("")}`;
}

function slotSubLabel(slot: string) {
  const parsed = parseSlot(slot);
  if (!parsed || parsed.kind !== "seed" || parsed.seed !== 3) return null;
  return parsed.groups.join("");
}

function unresolvedSlotLabel(slot: string) {
  const parsed = parseSlot(slot);
  if (!parsed) return "Por definir";
  if (parsed.kind === "advance") {
    return parsed.result === "W" ? `Ganador ${parsed.matchDay}` : `Perdedor ${parsed.matchDay}`;
  }
  if (parsed.seed === 1) return `1º grupo ${parsed.groups.join("/")}`;
  if (parsed.seed === 2) return `2º grupo ${parsed.groups.join("/")}`;
  return `Mejor 3º ${parsed.groups.join("/")}`;
}

function isButterflyPhase(phase: PhaseKey): phase is ButterflyPhase {
  return BUTTERFLY_PHASES.includes(phase as ButterflyPhase);
}

function getSlotValue(match: BracketBoardMatch, side: SlotSide) {
  return side === "home" ? match.homeSlot : match.awaySlot;
}

function getAdvanceFeeders(match: BracketBoardMatch) {
  return (["home", "away"] as SlotSide[]).flatMap((side) => {
    const parsed = parseSlot(getSlotValue(match, side));
    return parsed?.kind === "advance" && parsed.result === "W" ? [parsed.matchDay] : [];
  });
}

function resolveTeamIdFromSlot(
  slot: string,
  key: string,
  assignments: Record<string, string>,
  winners: Record<number, string>,
  matchesByDay: Map<number, BracketBoardMatch>,
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
  matchesByDay: Map<number, BracketBoardMatch>,
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

function getReachableMatchDays(matches: BracketBoardMatch[], validSlotIds: Set<string>) {
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

function normalizeForCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "");
}

function shortTeamCode(team: BracketBoardTeam) {
  const compact = normalizeForCode(team.nameEs || team.name || team.id).toUpperCase();
  return (compact || team.group).slice(0, 3);
}

function loadSavedPath() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      assignments?: unknown;
      winners?: unknown;
    };
    if (
      parsed &&
      typeof parsed.assignments === "object" &&
      parsed.assignments !== null &&
      typeof parsed.winners === "object" &&
      parsed.winners !== null
    ) {
      return {
        assignments: parsed.assignments as Record<string, string>,
        winners: parsed.winners as Record<number, string>,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function TeamFlag({
  team,
  size = 24,
  dim = false,
}: {
  team: BracketBoardTeam;
  size?: number;
  dim?: boolean;
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
        className={cn("max-w-none shrink-0 rounded-[4px] object-contain", dim && "opacity-35")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-bg-elevated text-[9px] font-bold text-text-primary",
        dim && "opacity-35",
      )}
      style={{ width: size, height: size }}
    >
      {shortTeamCode(team).slice(0, 2)}
    </span>
  );
}

function collectHalf(
  rootDay: number | null,
  half: HalfKey,
  matchesByDay: Map<number, BracketBoardMatch>,
) {
  const buckets = new Map<ButterflyPhase, PositionedMatch[]>();
  for (const phase of BUTTERFLY_PHASES) buckets.set(phase, []);
  const seen = new Set<number>();

  const visit = (matchDay: number) => {
    if (seen.has(matchDay)) return;
    const match = matchesByDay.get(matchDay);
    if (!match) return;
    seen.add(matchDay);

    for (const feeder of getAdvanceFeeders(match)) visit(feeder);

    if (isButterflyPhase(match.phase)) {
      buckets.get(match.phase)?.push({
        ...match,
        half,
        depth: DEPTH_BY_PHASE[match.phase],
      });
    }
  };

  if (rootDay) visit(rootDay);
  return buckets;
}

function orderedMatchesFromBuckets(
  left: Map<ButterflyPhase, PositionedMatch[]>,
  right: Map<ButterflyPhase, PositionedMatch[]>,
  finalMatch: BracketBoardMatch | null,
) {
  const ordered: PositionedMatch[] = [];
  for (const phase of BUTTERFLY_PHASES) {
    ordered.push(...(left.get(phase) ?? []), ...(right.get(phase) ?? []));
  }
  if (finalMatch) {
    ordered.push({ ...finalMatch, half: "center", depth: 4 });
  }
  return ordered;
}

function createButterflyLayout(
  left: Map<ButterflyPhase, PositionedMatch[]>,
  right: Map<ButterflyPhase, PositionedMatch[]>,
  finalMatch: BracketBoardMatch | null,
  scale: number,
): ButterflyLayout {
  const slotH = Math.round(44 * scale);
  const pairGap = Math.round(7 * scale);
  const matchGap = Math.round(17 * scale);
  const pitch = slotH * 2 + pairGap + matchGap;
  const pad = Math.round(16 * scale);
  const topPad = Math.round(10 * scale);
  const gap = Math.round(15 * scale);
  const sideW = [76, 68, 64, 64].map((value) => Math.round(value * scale));
  const centerW = Math.round(146 * scale);

  const colL: number[] = [];
  let x = pad;
  sideW.forEach((w, i) => {
    colL[i] = x;
    x += w + gap;
  });

  const centerX = x;
  x += centerW + gap;

  const colR: number[] = [];
  for (let i = 3; i >= 0; i -= 1) {
    colR[i] = x;
    x += sideW[i] + gap;
  }

  const width = x - gap + pad;
  const slots: Record<string, SlotGeometry> = {};
  const centers: Record<number, number> = {};
  const meta: Record<number, { half: HalfKey | "center"; depth: number; x: number; w: number }> = {};

  const placeHalf = (half: HalfKey, buckets: Map<ButterflyPhase, PositionedMatch[]>) => {
    for (const phase of BUTTERFLY_PHASES) {
      const depth = DEPTH_BY_PHASE[phase];
      const matches = buckets.get(phase) ?? [];
      matches.forEach((match, index) => {
        const cx = half === "left" ? colL[depth] : colR[depth];
        const w = sideW[depth];
        let homeY: number;
        let awayY: number;

        if (depth === 0) {
          homeY = topPad + index * pitch;
          awayY = homeY + slotH + pairGap;
        } else {
          const [homeFeeder, awayFeeder] = getAdvanceFeeders(match);
          homeY = (centers[homeFeeder] ?? topPad + index * pitch) - slotH / 2;
          awayY = (centers[awayFeeder] ?? homeY + slotH + pairGap) - slotH / 2;
        }

        slots[slotKey(match.matchDay, "home")] = { x: cx, y: homeY, w, h: slotH };
        slots[slotKey(match.matchDay, "away")] = { x: cx, y: awayY, w, h: slotH };
        centers[match.matchDay] = (homeY + awayY + slotH) / 2;
        meta[match.matchDay] = { half, depth, x: cx, w };
      });
    }
  };

  placeHalf("left", left);
  placeHalf("right", right);

  if (finalMatch) {
    const [leftSemi, rightSemi] = getAdvanceFeeders(finalMatch);
    const finalY = ((centers[leftSemi] ?? topPad + 3.5 * pitch) + (centers[rightSemi] ?? topPad + 3.5 * pitch)) / 2 - slotH / 2;
    const finalSlotW = Math.round(58 * scale);
    slots[slotKey(finalMatch.matchDay, "home")] = {
      x: centerX + Math.round(7 * scale),
      y: finalY,
      w: finalSlotW,
      h: slotH,
    };
    slots[slotKey(finalMatch.matchDay, "away")] = {
      x: centerX + centerW - finalSlotW - Math.round(7 * scale),
      y: finalY,
      w: finalSlotW,
      h: slotH,
    };
    centers[finalMatch.matchDay] = finalY + slotH / 2;
    meta[finalMatch.matchDay] = { half: "center", depth: 4, x: centerX, w: centerW };
  }

  const maxBottom = Math.max(...Object.values(slots).map((slot) => slot.y + slot.h), topPad + pitch * 8);
  const height = Math.round(maxBottom + 12 * scale);

  const columns: ColumnGeometry[] = [
    { label: ROUND_LABEL_BY_PHASE.round_of_32, x: colL[0], w: sideW[0] },
    { label: ROUND_LABEL_BY_PHASE.round_of_16, x: colL[1], w: sideW[1] },
    { label: ROUND_LABEL_BY_PHASE.quarter_finals, x: colL[2], w: sideW[2] },
    { label: ROUND_LABEL_BY_PHASE.semi_finals, x: colL[3], w: sideW[3] },
    { label: ROUND_LABEL_BY_PHASE.final, x: centerX, w: centerW, isFinal: true },
    { label: ROUND_LABEL_BY_PHASE.semi_finals, x: colR[3], w: sideW[3] },
    { label: ROUND_LABEL_BY_PHASE.quarter_finals, x: colR[2], w: sideW[2] },
    { label: ROUND_LABEL_BY_PHASE.round_of_16, x: colR[1], w: sideW[1] },
    { label: ROUND_LABEL_BY_PHASE.round_of_32, x: colR[0], w: sideW[0] },
  ];

  return { width, height, slotH, centerX, centerW, columns, slots, centers, meta };
}

function ConnectorLayer({
  matches,
  layout,
  winners,
  highlightedMatchDays,
  activeTeamId,
}: {
  matches: PositionedMatch[];
  layout: ButterflyLayout;
  winners: Record<number, string>;
  highlightedMatchDays: Set<number>;
  activeTeamId: string | null;
}) {
  const paths: Array<{ key: string; d: string; hot: boolean; dim: boolean }> = [];

  for (const target of matches) {
    (["home", "away"] as SlotSide[]).forEach((side) => {
      const targetKey = slotKey(target.matchDay, side);
      const targetGeo = layout.slots[targetKey];
      const parsed = parseSlot(getSlotValue(target, side));
      if (!targetGeo || parsed?.kind !== "advance" || parsed.result !== "W") return;

      const sourceMeta = layout.meta[parsed.matchDay];
      const sourceY = layout.centers[parsed.matchDay];
      if (!sourceMeta || typeof sourceY !== "number") return;

      const fromLeft = sourceMeta.half === "left";
      const startX = fromLeft ? sourceMeta.x + sourceMeta.w : sourceMeta.x;
      const endX = fromLeft ? targetGeo.x : targetGeo.x + targetGeo.w;
      const endY = targetGeo.y + targetGeo.h / 2;
      const midX = startX + (endX - startX) / 2;
      const isInActivePath = highlightedMatchDays.has(parsed.matchDay) && highlightedMatchDays.has(target.matchDay);

      paths.push({
        key: `${parsed.matchDay}-${target.matchDay}-${side}`,
        d: `M ${startX} ${sourceY} H ${midX} V ${endY} H ${endX}`,
        hot: Boolean(winners[parsed.matchDay]) || isInActivePath,
        dim: Boolean(activeTeamId) && !isInActivePath,
      });
    });
  }

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
    >
      {paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          fill="none"
          stroke={path.hot ? "rgba(31,216,127,0.66)" : "rgba(255,255,255,0.16)"}
          strokeWidth={path.hot ? 2.5 : 1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={path.dim ? 0.16 : 1}
          className="transition-opacity duration-200"
        />
      ))}
    </svg>
  );
}

function SlotChip({
  info,
  geometry,
  team,
  teamsById,
  candidateIds,
  activeTeamId,
  isOpen,
  isValidTarget,
  isWinner,
  isChampionPath,
  isOnboardingHint,
  onOpen,
  onClear,
}: {
  info: SlotInfo;
  geometry: SlotGeometry;
  team: BracketBoardTeam | null;
  teamsById: Map<string, BracketBoardTeam>;
  candidateIds: string[];
  activeTeamId: string | null;
  isOpen: boolean;
  isValidTarget: boolean;
  isWinner: boolean;
  isChampionPath: boolean;
  isOnboardingHint: boolean;
  onOpen: () => void;
  onClear?: () => void;
}) {
  const isDimmed = Boolean(activeTeamId) && !isValidTarget && !isChampionPath;
  const canClear = Boolean(team && onClear);
  const previewTeams = candidateIds.flatMap((id) => {
    const candidate = teamsById.get(id);
    return candidate ? [candidate] : [];
  });

  return (
    <div
      data-bracket-slot-id={info.key}
      data-board-interactive="true"
      className="absolute"
      style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={
          team
            ? `${team.nameEs}, ${unresolvedSlotLabel(info.slot)}`
            : `${unresolvedSlotLabel(info.slot)}, partido ${info.match.matchDay}`
        }
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1 transition-all duration-200",
          team ? "bg-bg-card border-border-subtle" : "border-dashed border-border-subtle bg-bg-base/75",
          isOpen && "border-turf/80 bg-turf/12 ring-1 ring-turf/35",
          isValidTarget && "border-turf/80 bg-turf/15 shadow-[0_0_18px_-10px_rgba(31,216,127,0.9)]",
          isWinner && "border-turf/50 bg-turf/10",
          isChampionPath && "border-turf-dim/70",
          isOnboardingHint && "animate-[bk-hint-slot_1.55s_ease-in-out_infinite] border-turf/80 bg-turf/[0.14] shadow-[0_0_22px_-10px_rgba(31,216,127,0.95)]",
          isDimmed && "opacity-25",
        )}
      >
        {team ? (
          <>
            <TeamFlag team={team} size={22} />
            <span className="max-w-full truncate font-body text-[9px] font-bold tracking-[0.04em] text-text-primary">
              {shortTeamCode(team)}
            </span>
          </>
        ) : previewTeams.length >= 2 ? (
          <>
            <span className="flex items-center justify-center gap-0.5">
              {previewTeams.slice(0, 2).map((candidate) => (
                <TeamFlag key={candidate.id} team={candidate} size={18} dim />
              ))}
            </span>
            <span className="font-display text-[10px] leading-none tracking-[0.04em] text-text-muted">
              {displaySlot(info.slot)}
            </span>
          </>
        ) : (
          <>
            <span className="font-display text-[15px] leading-none tracking-[0.05em] text-text-muted">
              {displaySlot(info.slot)}
            </span>
            {slotSubLabel(info.slot) ? (
              <span className="font-body text-[7px] font-bold leading-none tracking-[0.12em] text-text-muted">
                {slotSubLabel(info.slot)}
              </span>
            ) : null}
          </>
        )}
      </button>
      {canClear ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClear?.();
          }}
          aria-label={`Quitar ${team?.nameEs}`}
          className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-muted shadow-[0_8px_18px_-14px_rgba(0,0,0,0.9)] transition-colors hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function ChampionCenter({
  layout,
  champion,
  finalistIds,
  teamsById,
  isOpen,
  isValidTarget,
  activeTeamId,
  onOpen,
}: {
  layout: ButterflyLayout;
  champion: BracketBoardTeam | null;
  finalistIds: string[];
  teamsById: Map<string, BracketBoardTeam>;
  isOpen: boolean;
  isValidTarget: boolean;
  activeTeamId: string | null;
  onOpen: () => void;
}) {
  const finalHome = layout.slots[slotKey(FINAL_MATCH_DAY, "home")];
  const finalY = finalHome?.y ?? layout.height / 2;
  const cupTop = Math.max(12, finalY - 168);
  const champTop = finalY + layout.slotH + 14;
  const previewFinalists = finalistIds.flatMap((id) => {
    const team = teamsById.get(id);
    return team ? [team] : [];
  });

  return (
    <>
      <div
        className={cn("pointer-events-none absolute text-center transition-opacity duration-200", activeTeamId && "opacity-55")}
        style={{ left: layout.centerX, top: cupTop, width: layout.centerW }}
      >
        <div className="mx-auto mb-2 h-[92px] w-[88px] rounded-lg border border-border-subtle bg-bg-card/80 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tournaments/mundial-2026.webp"
            alt="Copa Mundial 2026"
            className="h-full w-full object-contain"
            draggable={false}
          />
        </div>
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute text-center font-display text-[13px] leading-none tracking-[0.08em] text-text-muted"
        style={{ left: layout.centerX, top: finalY + layout.slotH / 2 - 6, width: layout.centerW }}
      >
        VS
      </span>
      <div
        data-bracket-slot-id={CHAMPION_TARGET}
        data-board-interactive="true"
        className="absolute"
        style={{ left: layout.centerX + layout.centerW / 2 - 37, top: champTop, width: 74, height: 48 }}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={champion ? `Campeón ${champion.nameEs}` : "Elegir campeón"}
          className={cn(
            "flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border px-1 transition-all duration-200",
            champion ? "border-gold/70 bg-gold/10 text-gold" : "border-dashed border-gold/45 bg-bg-card/80 text-gold",
            isOpen && "ring-1 ring-gold/50",
            isValidTarget && "shadow-[0_0_22px_-12px_rgba(255,215,0,0.95)]",
            activeTeamId && !isValidTarget && "opacity-35",
          )}
        >
          {champion ? (
            <>
              <TeamFlag team={champion} size={24} />
              <span className="max-w-full truncate font-body text-[9px] font-bold tracking-[0.04em]">
                {shortTeamCode(champion)}
              </span>
            </>
          ) : previewFinalists.length >= 2 ? (
            <>
              <span className="flex gap-0.5">
                {previewFinalists.slice(0, 2).map((team) => (
                  <TeamFlag key={team.id} team={team} size={18} dim />
                ))}
              </span>
              <span className="font-display text-[11px] leading-none tracking-[0.05em]">Campeón</span>
            </>
          ) : (
            <span className="font-display text-[11px] leading-none tracking-[0.05em]">Campeón</span>
          )}
        </button>
      </div>
      {champion ? (
        <div
          className="pointer-events-none absolute truncate text-center font-display text-[15px] leading-none tracking-[0.04em] text-gold"
          style={{ left: layout.centerX, top: champTop + 56, width: layout.centerW }}
        >
          {champion.nameEs}
        </div>
      ) : null}
    </>
  );
}

function PickerOption({
  team,
  disabled,
  selected,
  shaking,
  compact = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyboardPick,
}: {
  team: BracketBoardTeam;
  disabled: boolean;
  selected: boolean;
  shaking: boolean;
  compact?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyboardPick: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onKeyboardPick();
        }
      }}
      aria-disabled={disabled}
      className={cn(
        "relative flex touch-none flex-col items-center justify-center rounded-md border transition-all duration-200 active:scale-[0.97]",
        compact ? "min-h-[38px] gap-0.5 px-0.5 py-1" : "min-h-[50px] gap-1 px-1 py-1.5",
        selected ? "border-turf/75 bg-turf/12" : "border-transparent bg-transparent",
        disabled ? "cursor-not-allowed opacity-35" : "cursor-grab active:cursor-grabbing",
        shaking && "animate-[bk-shake_320ms_ease]",
      )}
    >
      <TeamFlag team={team} size={compact ? 22 : 30} dim={disabled} />
      <span
        className={cn(
          "max-w-full truncate font-body font-bold tracking-[0.03em]",
          compact ? "text-[8px]" : "text-[9px]",
          selected ? "text-turf" : "text-text-secondary",
        )}
      >
        {shortTeamCode(team)}
      </span>
      {selected ? (
        <span className="absolute right-1.5 top-1.5 text-turf">
          <Check className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}

export default function BracketBoard({ teams, matches }: BracketBoardProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const optionPressRef = useRef<TeamPressState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [winners, setWinners] = useState<Record<number, string>>({});
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shakeTeamId, setShakeTeamId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [showOnboardingHint, setShowOnboardingHint] = useState(false);

  useEffect(() => {
    const saved = loadSavedPath();
    if (saved) {
      setAssignments(saved.assignments);
      setWinners(saved.winners);
    }

    try {
      const hasSeenHint = window.localStorage.getItem(ONBOARDING_HINT_KEY) === "1";
      const hasStarted = Boolean(saved && (Object.keys(saved.assignments).length > 0 || Object.keys(saved.winners).length > 0));
      if (!hasSeenHint && !hasStarted) setShowOnboardingHint(true);
    } catch {
      setShowOnboardingHint(false);
    }
  }, []);

  const allMatchesByDay = useMemo(() => new Map(matches.map((match) => [match.matchDay, match])), [matches]);
  const finalMatch = allMatchesByDay.get(FINAL_MATCH_DAY) ?? matches.find((match) => match.phase === "final") ?? null;
  const finalFeeders = useMemo(() => (finalMatch ? getAdvanceFeeders(finalMatch) : []), [finalMatch]);
  const leftRootDay = finalFeeders[0] ?? null;
  const rightRootDay = finalFeeders[1] ?? null;

  const leftBuckets = useMemo(() => collectHalf(leftRootDay, "left", allMatchesByDay), [allMatchesByDay, leftRootDay]);
  const rightBuckets = useMemo(() => collectHalf(rightRootDay, "right", allMatchesByDay), [allMatchesByDay, rightRootDay]);

  const positionedMatches = useMemo(
    () => orderedMatchesFromBuckets(leftBuckets, rightBuckets, finalMatch).filter((match) => match.matchDay !== THIRD_PLACE_MATCH_DAY),
    [finalMatch, leftBuckets, rightBuckets],
  );

  const playableMatchesByDay = useMemo(
    () => new Map(positionedMatches.map((match) => [match.matchDay, match])),
    [positionedMatches],
  );

  const layout = useMemo(
    () => createButterflyLayout(leftBuckets, rightBuckets, finalMatch, scale),
    [finalMatch, leftBuckets, rightBuckets, scale],
  );

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const teamsByGroup = useMemo(() => {
    const out = new Map<GroupLetter, BracketBoardTeam[]>();
    for (const group of GROUPS) out.set(group, []);
    for (const team of teams) out.get(team.group)?.push(team);
    for (const groupTeams of Array.from(out.values())) {
      groupTeams.sort((a, b) => a.fifaRank - b.fifaRank);
    }
    return out;
  }, [teams]);

  const slotInfos = useMemo(() => {
    const out: SlotInfo[] = [];
    for (const match of positionedMatches) {
      (["home", "away"] as SlotSide[]).forEach((side) => {
        const key = slotKey(match.matchDay, side);
        if (layout.slots[key]) {
          out.push({ key, match, side, slot: getSlotValue(match, side) });
        }
      });
    }
    return out;
  }, [layout.slots, positionedMatches]);

  const slotInfoByKey = useMemo(() => new Map(slotInfos.map((slot) => [slot.key, slot])), [slotInfos]);

  const directSlots = useMemo(
    () => slotInfos.filter((slot) => parseSlot(slot.slot)?.kind === "seed").map((slot) => ({ key: slot.key, slot: slot.slot })),
    [slotInfos],
  );

  const assignedTeamIds = useMemo(() => new Set(Object.values(assignments)), [assignments]);
  const activeTeamId = drag?.teamId ?? selectedTeamId;
  const activeTeam = activeTeamId ? teamsById.get(activeTeamId) ?? null : null;

  const champion = useMemo(() => {
    const winnerId = winners[FINAL_MATCH_DAY];
    return winnerId ? teamsById.get(winnerId) ?? null : null;
  }, [teamsById, winners]);

  const finalistIds = useMemo(
    () =>
      (["home", "away"] as SlotSide[])
        .map((side) =>
          finalMatch
            ? resolveTeamIdFromSlot(
                getSlotValue(finalMatch, side),
                slotKey(finalMatch.matchDay, side),
                assignments,
                winners,
                playableMatchesByDay,
              )
            : null,
        )
        .filter((teamId): teamId is string => Boolean(teamId)),
    [assignments, finalMatch, playableMatchesByDay, winners],
  );

  const getCandidateIdsForTarget = useCallback(
    (targetKey: string) => {
      if (targetKey === CHAMPION_TARGET) return finalistIds;

      const info = slotInfoByKey.get(targetKey);
      if (!info) return [];
      const parsed = parseSlot(info.slot);
      if (!parsed) return [];

      if (parsed.kind === "seed") {
        return parsed.groups.flatMap((group) => teamsByGroup.get(group) ?? []).map((team) => team.id);
      }

      const source = playableMatchesByDay.get(parsed.matchDay);
      if (!source) return [];
      const homeId = resolveTeamIdFromSlot(
        source.homeSlot,
        slotKey(source.matchDay, "home"),
        assignments,
        winners,
        playableMatchesByDay,
      );
      const awayId = resolveTeamIdFromSlot(
        source.awaySlot,
        slotKey(source.matchDay, "away"),
        assignments,
        winners,
        playableMatchesByDay,
      );
      return [homeId, awayId].filter((teamId): teamId is string => Boolean(teamId));
    },
    [assignments, finalistIds, playableMatchesByDay, slotInfoByKey, teamsByGroup, winners],
  );

  const canTeamFillTarget = useCallback(
    (teamId: string, targetKey: string) => {
      const team = teamsById.get(teamId);
      if (!team) return false;
      if (targetKey === CHAMPION_TARGET) return finalistIds.includes(teamId);

      const info = slotInfoByKey.get(targetKey);
      if (!info) return false;
      const parsed = parseSlot(info.slot);
      if (!parsed) return false;
      if (parsed.kind === "seed") return canTeamOccupySlot(team, info.slot);
      return getCandidateIdsForTarget(targetKey).includes(teamId);
    },
    [finalistIds, getCandidateIdsForTarget, slotInfoByKey, teamsById],
  );

  const validSlotIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeTeam) return ids;
    for (const slot of slotInfos) {
      if (canTeamFillTarget(activeTeam.id, slot.key)) ids.add(slot.key);
    }
    if (canTeamFillTarget(activeTeam.id, CHAMPION_TARGET)) ids.add(CHAMPION_TARGET);
    return ids;
  }, [activeTeam, canTeamFillTarget, slotInfos]);

  const highlightedMatchDays = useMemo(
    () => getReachableMatchDays(positionedMatches, validSlotIds),
    [positionedMatches, validSlotIds],
  );

  const totalDecisions = directSlots.length + positionedMatches.length;
  const doneCount =
    Object.keys(assignments).length +
    Object.keys(winners).filter((matchDay) => Number(matchDay) !== THIRD_PLACE_MATCH_DAY).length;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2100);
  }, []);

  const dismissOnboardingHint = useCallback(() => {
    setShowOnboardingHint(false);
    try {
      window.localStorage.setItem(ONBOARDING_HINT_KEY, "1");
    } catch {
      // Best-effort: el hint no debe bloquear la bracket si storage falla.
    }
  }, []);

  const closePicker = useCallback(() => {
    setOpenTarget(null);
    setSelectedTeamId(null);
  }, []);

  const handlePickerDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y > PICKER_CLOSE_DRAG_OFFSET || info.velocity.y > PICKER_CLOSE_DRAG_VELOCITY) {
        closePicker();
      }
    },
    [closePicker],
  );

  const hintTargetKey = useMemo(() => {
    if (!showOnboardingHint) return null;
    return directSlots.find((slot) => !assignments[slot.key])?.key ?? directSlots[0]?.key ?? null;
  }, [assignments, directSlots, showOnboardingHint]);

  const hintGeometry = hintTargetKey ? layout.slots[hintTargetKey] : null;
  const hintTooltipLeft = hintGeometry ? clamp(hintGeometry.x + hintGeometry.w + 8, 8, layout.width - 184) : 0;
  const hintTooltipTop = hintGeometry ? Math.max(2, hintGeometry.y + 2) : 0;

  const scrollToTarget = useCallback(
    (targetKey: string) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const geometry =
        targetKey === CHAMPION_TARGET
          ? {
              x: layout.centerX + layout.centerW / 2 - 37,
              y: (layout.slots[slotKey(FINAL_MATCH_DAY, "home")]?.y ?? layout.height / 2) + layout.slotH + 14,
              w: 74,
              h: 48,
            }
          : layout.slots[targetKey];
      if (!geometry) return;

      const nextLeft = Math.max(geometry.x - scroller.clientWidth * 0.42, 0);
      const nextTop = Math.max(geometry.y - scroller.clientHeight * 0.34 + 42, 0);
      scroller.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    },
    [layout],
  );

  const findNextEmpty = useCallback(
    (nextAssignments: Record<string, string>, nextWinners: Record<number, string>) => {
      for (const match of positionedMatches) {
        for (const side of ["home", "away"] as SlotSide[]) {
          const key = slotKey(match.matchDay, side);
          const teamId = resolveTeamIdFromSlot(
            getSlotValue(match, side),
            key,
            nextAssignments,
            nextWinners,
            playableMatchesByDay,
          );
          if (!teamId) return key;
        }
      }
      const nextFinalistIds = (["home", "away"] as SlotSide[])
        .map((side) =>
          finalMatch
            ? resolveTeamIdFromSlot(
                getSlotValue(finalMatch, side),
                slotKey(finalMatch.matchDay, side),
                nextAssignments,
                nextWinners,
                playableMatchesByDay,
              )
            : null,
        )
        .filter((teamId): teamId is string => Boolean(teamId));
      if (nextFinalistIds.length === 2 && !nextWinners[FINAL_MATCH_DAY]) return CHAMPION_TARGET;
      return null;
    },
    [finalMatch, playableMatchesByDay, positionedMatches],
  );

  const advanceToNext = useCallback(
    (nextAssignments: Record<string, string>, nextWinners: Record<number, string>) => {
      const nextTarget = findNextEmpty(nextAssignments, nextWinners);
      setOpenTarget(nextTarget);
      setSelectedTeamId(null);
      if (nextTarget) {
        window.requestAnimationFrame(() => scrollToTarget(nextTarget));
      } else if (nextWinners[FINAL_MATCH_DAY]) {
        showToast("Camino completo");
      }
    },
    [findNextEmpty, scrollToTarget, showToast],
  );

  const placeTeam = useCallback(
    (teamId: string, targetSlotKey: string) => {
      const slot = directSlots.find((item) => item.key === targetSlotKey);
      const team = teamsById.get(teamId);
      if (!slot || !team || !canTeamOccupySlot(team, slot.slot)) return;

      const nextAssignments: Record<string, string> = {};
      for (const [key, value] of Object.entries(assignments)) {
        if (value !== teamId && key !== targetSlotKey) nextAssignments[key] = value;
      }
      nextAssignments[targetSlotKey] = teamId;
      const nextWinners = pruneWinners(nextAssignments, winners, playableMatchesByDay);
      setAssignments(nextAssignments);
      setWinners(nextWinners);
      advanceToNext(nextAssignments, nextWinners);
    },
    [advanceToNext, assignments, directSlots, playableMatchesByDay, teamsById, winners],
  );

  const pickWinner = useCallback(
    (matchDay: number, teamId: string) => {
      const nextWinners = pruneWinners(assignments, { ...winners, [matchDay]: teamId }, playableMatchesByDay);
      setWinners(nextWinners);
      advanceToNext(assignments, nextWinners);
    },
    [advanceToNext, assignments, playableMatchesByDay, winners],
  );

  const assignTeamToTarget = useCallback(
    (teamId: string, targetKey: string) => {
      if (!canTeamFillTarget(teamId, targetKey)) {
        setSelectedTeamId(null);
        showToast("Ese cruce no puede darse");
        return;
      }

      if (targetKey === CHAMPION_TARGET) {
        const nextWinners = pruneWinners(assignments, { ...winners, [FINAL_MATCH_DAY]: teamId }, playableMatchesByDay);
        setWinners(nextWinners);
        advanceToNext(assignments, nextWinners);
        return;
      }

      const info = slotInfoByKey.get(targetKey);
      const parsed = info ? parseSlot(info.slot) : null;
      if (!info || !parsed) return;

      if (parsed.kind === "seed") {
        placeTeam(teamId, targetKey);
        return;
      }

      pickWinner(parsed.matchDay, teamId);
    },
    [
      advanceToNext,
      assignments,
      canTeamFillTarget,
      pickWinner,
      placeTeam,
      playableMatchesByDay,
      showToast,
      slotInfoByKey,
      winners,
    ],
  );

  const removeAssignment = useCallback(
    (targetSlotKey: string) => {
      const nextAssignments = { ...assignments };
      delete nextAssignments[targetSlotKey];
      const nextWinners = pruneWinners(nextAssignments, winners, playableMatchesByDay);
      setAssignments(nextAssignments);
      setWinners(nextWinners);
      setOpenTarget(targetSlotKey);
    },
    [assignments, playableMatchesByDay, winners],
  );

  const resetBracket = useCallback(() => {
    setAssignments({});
    setWinners({});
    setOpenTarget(null);
    setSelectedTeamId(null);
    setDrag(null);
    showToast("Camino reiniciado");
  }, [showToast]);

  const savePath = useCallback(() => {
    try {
      window.localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ assignments, winners, savedAt: new Date().toISOString() }),
      );
      showToast(doneCount >= totalDecisions ? "Camino guardado" : `Camino guardado ${doneCount}/${totalDecisions}`);
    } catch {
      showToast("No se pudo guardar");
    }
  }, [assignments, doneCount, showToast, totalDecisions, winners]);

  const startOptionPress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, teamId: string, disabled: boolean) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.stopPropagation();
      if (!disabled) setSelectedTeamId(teamId);
      optionPressRef.current = {
        teamId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        disabled,
        didDrag: false,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Algunos browsers sueltan el pointer si el scroll nativo toma control.
      }
    },
    [],
  );

  const updateOptionPress = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const press = optionPressRef.current;
    if (!press || press.pointerId !== event.pointerId || press.disabled) return;
    const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
    if (!press.didDrag && distance < TEAM_DRAG_THRESHOLD) return;

    event.preventDefault();
    press.didDrag = true;
    setDrag({ teamId: press.teamId, x: event.clientX, y: event.clientY });
  }, []);

  const finishOptionPress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const press = optionPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;

      if (press.disabled) {
        setShakeTeamId(press.teamId);
        showToast("Ya está en tu camino");
      } else if (press.didDrag) {
        const el = document.elementFromPoint(event.clientX, event.clientY);
        const slotEl = el instanceof HTMLElement ? el.closest<HTMLElement>("[data-bracket-slot-id]") : null;
        const targetKey = slotEl?.dataset.bracketSlotId;
        if (targetKey) {
          assignTeamToTarget(press.teamId, targetKey);
        } else {
          setSelectedTeamId(null);
        }
      } else if (openTarget) {
        assignTeamToTarget(press.teamId, openTarget);
      }

      optionPressRef.current = null;
      setDrag(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // El browser puede haber soltado el capture antes del pointerup.
      }
    },
    [assignTeamToTarget, openTarget, showToast],
  );

  const cancelOptionPress = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const press = optionPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    optionPressRef.current = null;
    setDrag(null);
    setSelectedTeamId(null);
  }, []);

  const openTargetPicker = useCallback(
    (targetKey: string) => {
      dismissOnboardingHint();
      setOpenTarget((current) => (current === targetKey ? null : targetKey));
      setSelectedTeamId(null);
      if (targetKey) window.requestAnimationFrame(() => scrollToTarget(targetKey));
    },
    [dismissOnboardingHint, scrollToTarget],
  );

  const renderPicker = () => {
    if (!openTarget) return null;

    const isChampion = openTarget === CHAMPION_TARGET;
    const info = isChampion ? null : slotInfoByKey.get(openTarget);
    const candidateIds = getCandidateIdsForTarget(openTarget);
    const candidates = candidateIds.flatMap((teamId) => {
      const team = teamsById.get(teamId);
      return team ? [team] : [];
    });
    const parsed = info ? parseSlot(info.slot) : null;
    const isBestThirdPicker = parsed?.kind === "seed" && parsed.seed === 3;

    const heading = isChampion
      ? "¿Quién levanta la copa?"
      : parsed?.kind === "seed"
        ? unresolvedSlotLabel(info?.slot ?? "")
        : parsed?.kind === "advance"
          ? `Ganador ${parsed.matchDay}`
          : "Elige equipo";

    return (
      <div
        className="fixed inset-x-0 z-[80] flex justify-center px-3"
        style={{ bottom: `calc(env(safe-area-inset-bottom) + ${PICKER_BOTTOM}px)` }}
      >
        <motion.div
          data-board-interactive="true"
          drag="y"
          dragConstraints={{ top: 0, bottom: 120 }}
          dragElastic={0.08}
          dragMomentum={false}
          onDragEnd={handlePickerDragEnd}
          whileTap={{ scale: 0.995 }}
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className={cn(
            "w-full rounded-lg border border-border-subtle bg-bg-elevated/95 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.85)] backdrop-blur-xl",
            isBestThirdPicker ? "max-w-[380px] p-2" : "max-w-[390px] p-2.5",
          )}
        >
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-border-strong/70" aria-hidden="true" />
          <div className={cn("flex items-center justify-between gap-2", isBestThirdPicker ? "mb-1" : "mb-2")}>
            <p className="min-w-0 truncate font-body text-[10px] font-bold uppercase tracking-[0.12em] text-text-secondary">
              {heading}
            </p>
            <button
              type="button"
              onClick={closePicker}
              aria-label="Cerrar picker"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border-subtle text-text-muted transition-colors hover:text-text-primary active:scale-95"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {candidates.length === 0 ? (
            <div className="rounded-md border border-border-subtle bg-bg-base/70 px-3 py-2 text-[12px] font-medium text-text-secondary">
              Primero definí el partido anterior.
            </div>
          ) : isBestThirdPicker ? (
            <div className="space-y-0.5">
              {parsed.groups.map((group) => {
                const rowTeams = (teamsByGroup.get(group) ?? []).filter((team) => candidateIds.includes(team.id));
                return (
                  <div
                    key={group}
                    className="grid items-center gap-1 border-t border-border-subtle/70 pt-1 first:border-t-0 first:pt-0"
                    style={{ gridTemplateColumns: "26px repeat(4, minmax(0, 1fr))" }}
                  >
                    <div className="grid h-6 w-6 place-items-center rounded-md border border-border-subtle bg-bg-card font-display text-[12px] leading-none text-text-secondary">
                      {group}
                    </div>
                    {rowTeams.map((team) => {
                      const selected = activeTeamId === team.id;
                      const current = info ? assignments[info.key] === team.id : false;
                      const disabled = assignedTeamIds.has(team.id) && !current;
                      return (
                        <PickerOption
                          key={team.id}
                          team={team}
                          disabled={disabled}
                          selected={selected}
                          shaking={shakeTeamId === team.id}
                          compact
                          onPointerDown={(event) => startOptionPress(event, team.id, disabled)}
                          onPointerMove={updateOptionPress}
                          onPointerUp={finishOptionPress}
                          onPointerCancel={cancelOptionPress}
                          onKeyboardPick={() => (disabled ? showToast("Ya está en tu camino") : assignTeamToTarget(team.id, openTarget))}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              {candidates.map((team) => {
                const selected = activeTeamId === team.id;
                const current = info ? assignments[info.key] === team.id : false;
                const disabled = Boolean(parsed?.kind === "seed" && assignedTeamIds.has(team.id) && !current);
                return (
                  <PickerOption
                    key={team.id}
                    team={team}
                    disabled={disabled}
                    selected={selected}
                    shaking={shakeTeamId === team.id}
                    onPointerDown={(event) => startOptionPress(event, team.id, disabled)}
                    onPointerMove={updateOptionPress}
                    onPointerUp={finishOptionPress}
                    onPointerCancel={cancelOptionPress}
                    onKeyboardPick={() => (disabled ? showToast("Ya está en tu camino") : assignTeamToTarget(team.id, openTarget))}
                  />
                );
              })}
            </div>
          )}
        </motion.div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[65] overflow-hidden bg-bg-base text-text-primary">
      <style jsx global>{`
        @keyframes bk-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-5px);
          }
          75% {
            transform: translateX(5px);
          }
        }
        @keyframes bk-hint-slot {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.06);
          }
        }
      `}</style>

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-bg-base">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRACKET_BACKGROUND.poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-55"
          draggable={false}
        />
        <video
          muted
          loop
          playsInline
          controls={false}
          disablePictureInPicture
          preload="metadata"
          autoPlay
          className="absolute inset-0 h-full w-full object-cover opacity-30 motion-reduce:hidden"
        >
          <source src={BRACKET_BACKGROUND.webm} type="video/webm" />
          <source src={BRACKET_BACKGROUND.mp4} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/[0.92]" />
      </div>

      <header
        className="absolute inset-x-0 top-0 z-40 border-b border-border-subtle bg-bg-base/95 px-3 backdrop-blur-xl"
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
          {/* Sin título — solo el contador de partidos decididos (pedido user:
              "no dejes nada de texto, solo el nro de partidos 0/63"). */}
          <div className="min-w-0 flex-1">
            <p
              className="font-display text-[22px] leading-none tracking-[0.04em] text-text-primary tabular-nums"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {doneCount}/{totalDecisions}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScale((current) => clamp(current - 0.08, 0.9, 1.18))}
              aria-label="Alejar"
              className="grid h-11 w-11 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setScale((current) => clamp(current + 0.08, 0.9, 1.18))}
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={savePath}
            className="h-11 shrink-0 rounded-full bg-gold px-4 font-display text-[14px] tracking-[0.06em] text-bg-base shadow-[0_8px_24px_-6px_rgba(255,215,0,0.35)] transition-transform active:scale-[0.98]"
          >
            Guardar
          </button>
        </div>
      </header>

      <main
        ref={scrollerRef}
        className="absolute inset-x-0 z-10 overflow-auto overscroll-none"
        style={{
          top: "calc(env(safe-area-inset-top) + 64px)",
          bottom: 0,
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "none",
          paddingBottom: `calc(env(safe-area-inset-bottom) + ${BOARD_BOTTOM_PADDING}px)`,
        }}
      >
        <div className="relative" style={{ width: layout.width, minHeight: layout.height + 48 }}>
          <div className="sticky top-0 z-30 h-10 border-b border-border-subtle bg-bg-base/95 backdrop-blur-xl">
            <div className="relative h-full" style={{ width: layout.width }}>
              {layout.columns.map((column, index) => (
                <div
                  key={`${column.label}-${index}`}
                  className={cn(
                    "absolute top-0 flex h-10 items-center justify-center font-display text-[12px] uppercase leading-none tracking-[0.08em]",
                    column.isFinal ? "text-gold" : "text-text-muted",
                  )}
                  style={{ left: column.x, width: column.w }}
                >
                  {column.label}
                </div>
              ))}
            </div>
          </div>

          <div ref={boardRef} className="relative mt-2" style={{ width: layout.width, height: layout.height }}>
            <ConnectorLayer
              matches={positionedMatches}
              layout={layout}
              winners={winners}
              highlightedMatchDays={highlightedMatchDays}
              activeTeamId={activeTeamId}
            />

            {slotInfos.map((info) => {
              const geometry = layout.slots[info.key];
              const parsed = parseSlot(info.slot);
              const teamId = resolveTeamIdFromSlot(
                info.slot,
                info.key,
                assignments,
                winners,
                playableMatchesByDay,
              );
              const team = teamId ? teamsById.get(teamId) ?? null : null;
              const candidateIds = parsed?.kind === "advance" ? getCandidateIdsForTarget(info.key) : [];
              const winnerId = winners[info.match.matchDay] ?? null;
              const isWinner = Boolean(team && winnerId === team.id);
              const isChampionPath = Boolean(champion && team && champion.id === team.id);

              return (
                <SlotChip
                  key={info.key}
                  info={info}
                  geometry={geometry}
                  team={team}
                  teamsById={teamsById}
                  candidateIds={candidateIds}
                  activeTeamId={activeTeamId}
                  isOpen={openTarget === info.key}
                  isValidTarget={validSlotIds.has(info.key)}
                  isWinner={isWinner}
                  isChampionPath={isChampionPath}
                  isOnboardingHint={hintTargetKey === info.key}
                  onOpen={() => openTargetPicker(info.key)}
                  onClear={parsed?.kind === "seed" && team ? () => removeAssignment(info.key) : undefined}
                />
              );
            })}

            <ChampionCenter
              layout={layout}
              champion={champion}
              finalistIds={finalistIds}
              teamsById={teamsById}
              isOpen={openTarget === CHAMPION_TARGET}
              isValidTarget={validSlotIds.has(CHAMPION_TARGET)}
              activeTeamId={activeTeamId}
              onOpen={() => openTargetPicker(CHAMPION_TARGET)}
            />

            <AnimatePresence>
              {showOnboardingHint && hintTargetKey && hintGeometry ? (
                <motion.div
                  key="bracket-onboarding-hint"
                  data-board-interactive="true"
                  className="absolute z-50 w-[176px] rounded-lg border border-turf/35 bg-bg-elevated/95 px-3 py-2 pr-9 text-[11px] font-semibold leading-snug text-text-primary shadow-[0_14px_34px_-18px_rgba(0,0,0,0.95)] backdrop-blur-xl"
                  style={{ left: hintTooltipLeft, top: hintTooltipTop }}
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute -left-1.5 top-4 h-3 w-3 rotate-45 border-b border-l border-turf/35 bg-bg-elevated"
                  />
                  Toca una casilla para elegir un equipo ganador
                  <button
                    type="button"
                    onClick={dismissOnboardingHint}
                    aria-label="Cerrar ayuda"
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full text-text-muted transition-colors hover:text-text-primary active:scale-95"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <AnimatePresence>{renderPicker()}</AnimatePresence>

      <AnimatePresence>
        {drag ? (
          <motion.div
            key="drag-team"
            className="pointer-events-none fixed z-[95] rounded-full border border-turf/60 bg-bg-elevated p-2 shadow-[0_12px_24px_-14px_rgba(0,0,0,0.9)]"
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ duration: DURATION.fast, ease: EASE.default }}
            style={{ left: drag.x + 10, top: drag.y + 10 }}
          >
            {teamsById.get(drag.teamId) ? <TeamFlag team={teamsById.get(drag.teamId)!} size={30} /> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.div
            key="toast"
            className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4"
            style={{ bottom: `calc(env(safe-area-inset-bottom) + ${PICKER_BOTTOM}px)` }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: DURATION.fast, ease: EASE.default }}
          >
            <div className="flex items-center gap-2 rounded-full border border-turf/40 bg-bg-elevated px-4 py-2 text-[12px] font-semibold text-text-primary shadow-[0_12px_30px_-16px_rgba(0,0,0,0.9)]">
              <Check className="h-3.5 w-3.5 text-turf" aria-hidden="true" />
              {toast}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
