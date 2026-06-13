import type { Metadata } from "next";
import BracketBoard, {
  type BracketBoardMatch,
  type BracketBoardTeam,
} from "@/components/worldcup/BracketBoard";
import { BracketIntroModal } from "@/components/worldcup/BracketIntroModal";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORLDCUP_FACTS } from "@/lib/teams/worldcup-facts";
import { TOURNAMENT_STRUCTURE, type PhaseSlug } from "@/lib/tournaments/structure";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Road to World Cup | La Polla",
};

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

type KnockoutPhase = Extract<
  PhaseSlug,
  "round_of_32" | "round_of_16" | "quarter_finals" | "semi_finals" | "third_place" | "final"
>;

interface KnockoutSeed {
  matchDay: number;
  phase: KnockoutPhase;
  homeSlot: string;
  awaySlot: string;
}

interface DbKnockoutRow {
  match_day: number | null;
  phase: string | null;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  venue: string | null;
}

const KNOCKOUT_PHASES: KnockoutPhase[] = [
  "round_of_32",
  "round_of_16",
  "quarter_finals",
  "semi_finals",
  "third_place",
  "final",
];

// Mapping oficial usado por migration 062, verificado contra openfootball.
// La UI lo usa como fuente estructural estable; la DB solo aporta hora/venue.
const WORLDCUP_KNOCKOUT_SEEDS: KnockoutSeed[] = [
  { matchDay: 73, phase: "round_of_32", homeSlot: "2A", awaySlot: "2B" },
  { matchDay: 74, phase: "round_of_32", homeSlot: "1E", awaySlot: "3A/B/C/D/F" },
  { matchDay: 75, phase: "round_of_32", homeSlot: "1F", awaySlot: "2C" },
  { matchDay: 76, phase: "round_of_32", homeSlot: "1C", awaySlot: "2F" },
  { matchDay: 77, phase: "round_of_32", homeSlot: "1I", awaySlot: "3C/D/F/G/H" },
  { matchDay: 78, phase: "round_of_32", homeSlot: "2E", awaySlot: "2I" },
  { matchDay: 79, phase: "round_of_32", homeSlot: "1A", awaySlot: "3C/E/F/H/I" },
  { matchDay: 80, phase: "round_of_32", homeSlot: "1L", awaySlot: "3E/H/I/J/K" },
  { matchDay: 81, phase: "round_of_32", homeSlot: "1D", awaySlot: "3B/E/F/I/J" },
  { matchDay: 82, phase: "round_of_32", homeSlot: "1G", awaySlot: "3A/E/H/I/J" },
  { matchDay: 83, phase: "round_of_32", homeSlot: "2K", awaySlot: "2L" },
  { matchDay: 84, phase: "round_of_32", homeSlot: "1H", awaySlot: "2J" },
  { matchDay: 85, phase: "round_of_32", homeSlot: "1B", awaySlot: "3E/F/G/I/J" },
  { matchDay: 86, phase: "round_of_32", homeSlot: "1J", awaySlot: "2H" },
  { matchDay: 87, phase: "round_of_32", homeSlot: "1K", awaySlot: "3D/E/I/J/L" },
  { matchDay: 88, phase: "round_of_32", homeSlot: "2D", awaySlot: "2G" },
  { matchDay: 89, phase: "round_of_16", homeSlot: "W74", awaySlot: "W77" },
  { matchDay: 90, phase: "round_of_16", homeSlot: "W73", awaySlot: "W75" },
  { matchDay: 91, phase: "round_of_16", homeSlot: "W76", awaySlot: "W78" },
  { matchDay: 92, phase: "round_of_16", homeSlot: "W79", awaySlot: "W80" },
  { matchDay: 93, phase: "round_of_16", homeSlot: "W83", awaySlot: "W84" },
  { matchDay: 94, phase: "round_of_16", homeSlot: "W81", awaySlot: "W82" },
  { matchDay: 95, phase: "round_of_16", homeSlot: "W86", awaySlot: "W88" },
  { matchDay: 96, phase: "round_of_16", homeSlot: "W85", awaySlot: "W87" },
  { matchDay: 97, phase: "quarter_finals", homeSlot: "W89", awaySlot: "W90" },
  { matchDay: 98, phase: "quarter_finals", homeSlot: "W93", awaySlot: "W94" },
  { matchDay: 99, phase: "quarter_finals", homeSlot: "W91", awaySlot: "W92" },
  { matchDay: 100, phase: "quarter_finals", homeSlot: "W95", awaySlot: "W96" },
  { matchDay: 101, phase: "semi_finals", homeSlot: "W97", awaySlot: "W98" },
  { matchDay: 102, phase: "semi_finals", homeSlot: "W99", awaySlot: "W100" },
  { matchDay: 103, phase: "third_place", homeSlot: "L101", awaySlot: "L102" },
  { matchDay: 104, phase: "final", homeSlot: "W101", awaySlot: "W102" },
];

function getPhaseLabel(phase: KnockoutPhase) {
  const worldCup = TOURNAMENT_STRUCTURE.worldcup_2026;
  return worldCup.phases.find((item) => item.phase === phase)?.label ?? phase;
}

function formatKickoff(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function buildTeams(): BracketBoardTeam[] {
  return Object.entries(WORLDCUP_FACTS)
    .map(([name, facts]) => ({
      id: name,
      name,
      nameEs: facts.nameEs,
      group: facts.group as GroupLetter,
      fifaRank: facts.fifaRank,
      flagUrl: flagUrlForTeam(name),
    }))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.fifaRank - b.fifaRank;
    });
}

async function loadDbKnockouts() {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("matches")
      .select("match_day, phase, home_team, away_team, scheduled_at, venue")
      .eq("tournament", "worldcup_2026")
      .in("phase", KNOCKOUT_PHASES)
      .gte("match_day", 73)
      .lte("match_day", 104)
      .order("match_day", { ascending: true });

    if (error) return new Map<number, DbKnockoutRow>();
    const rows = (data ?? []) as DbKnockoutRow[];
    return new Map(rows.flatMap((row) => (row.match_day ? [[row.match_day, row]] : [])));
  } catch {
    return new Map<number, DbKnockoutRow>();
  }
}

function buildMatches(dbRows: Map<number, DbKnockoutRow>): BracketBoardMatch[] {
  return WORLDCUP_KNOCKOUT_SEEDS.map((seed) => {
    const db = dbRows.get(seed.matchDay);
    return {
      id: String(seed.matchDay),
      matchDay: seed.matchDay,
      phase: seed.phase,
      phaseLabel: getPhaseLabel(seed.phase),
      homeSlot: seed.homeSlot,
      awaySlot: seed.awaySlot,
      kickoffLabel: formatKickoff(db?.scheduled_at ?? null),
      venue: db?.venue ?? null,
    };
  });
}

export default async function RoadToWorldCupPage() {
  const dbRows = await loadDbKnockouts();
  const teams = buildTeams();
  const matches = buildMatches(dbRows);

  return (
    <>
      <BracketBoard teams={teams} matches={matches} />
      <BracketIntroModal />
    </>
  );
}
