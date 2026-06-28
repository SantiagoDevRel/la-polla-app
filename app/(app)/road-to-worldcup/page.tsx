import type { Metadata } from "next";
import BracketBoard, {
  type BracketBoardMatch,
  type BracketBoardTeam,
} from "@/components/worldcup/BracketBoard";
import { BracketIntroModal } from "@/components/worldcup/BracketIntroModal";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import { isPlaceholderTeam } from "@/lib/matches/is-placeholder";
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

// Equipos REALES ya clasificados a 16vos (resultado del Mundial, grupos
// cerrados 2026-06-27). Keys de equipo = EXACTAS de WORLDCUP_FACTS (ojo el
// drift de ortografía: "DR Congo" no "Congo DR", "Cape Verde" no "Cape Verde
// Islands"). Estos quedan FIJOS en el bracket; el usuario predice de octavos
// en adelante. Verificado contra ESPN (fifa.world) + la DB.
// Actualizar acá cuando se resuelva una fase nueva (o migrar a leer de la DB).
const WORLDCUP_R32_QUALIFIED: Record<number, { home: string; away: string }> = {
  73: { home: "South Africa", away: "Canada" },
  74: { home: "Germany", away: "Paraguay" },
  75: { home: "Netherlands", away: "Morocco" },
  76: { home: "Brazil", away: "Japan" },
  77: { home: "France", away: "Sweden" },
  78: { home: "Ivory Coast", away: "Norway" },
  79: { home: "Mexico", away: "Ecuador" },
  80: { home: "England", away: "DR Congo" },
  81: { home: "United States", away: "Bosnia-Herzegovina" },
  82: { home: "Belgium", away: "Senegal" },
  83: { home: "Portugal", away: "Croatia" },
  84: { home: "Spain", away: "Austria" },
  85: { home: "Switzerland", away: "Algeria" },
  86: { home: "Argentina", away: "Cape Verde" },
  87: { home: "Colombia", away: "Ghana" },
  88: { home: "Australia", away: "Egypt" },
};

// Construye los slots fijos (slotKey → teamId) solo para equipos que existen
// en el set de equipos del bracket (defensa contra drift de nombres: si un
// nombre no matchea, se omite en vez de romper el render).
function buildLockedAssignments(teamIds: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [matchDay, pair] of Object.entries(WORLDCUP_R32_QUALIFIED)) {
    if (teamIds.has(pair.home)) out[`${matchDay}:home`] = pair.home;
    if (teamIds.has(pair.away)) out[`${matchDay}:away`] = pair.away;
  }
  return out;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Resuelve un nombre de equipo de la tabla `matches` (ortografía propia, ej.
// "Congo DR", "Cape Verde Islands") al teamId del bracket (key de
// WORLDCUP_FACTS, ej. "DR Congo", "Cape Verde"). Match por tokens compartidos
// — tolerante al orden de palabras y a sufijos. Null si no hay match claro.
function resolveTeamId(dbName: string, teamIds: string[]): string | null {
  const target = normalizeName(dbName);
  if (!target) return null;
  const exact = teamIds.find((id) => normalizeName(id) === target);
  if (exact) return exact;
  const targetTokens = new Set(target.split(" ").filter((t) => t.length > 2));
  if (targetTokens.size === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const id of teamIds) {
    const tokens = new Set(normalizeName(id).split(" ").filter((t) => t.length > 2));
    if (tokens.size === 0) continue;
    let shared = 0;
    targetTokens.forEach((t) => {
      if (tokens.has(t)) shared++;
    });
    const score = shared / Math.min(targetTokens.size, tokens.size);
    if (score >= 0.5 && (!best || score > best.score)) best = { id, score };
  }
  return best?.id ?? null;
}

function feederMatchDay(slot: string): number | null {
  const m = slot.match(/^W(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Bloqueos derivados de la DB: equipos REALES en cada cruce de knockout.
//   - 16vos (slots de seed por grupo "2A"/"1E"/"3X"): bloquea el assignment.
//   - octavos+ (slots "Wx"): el equipo real ES el ganador del partido x, así
//     que bloquea ese ganador (winners[x]). A medida que la DB resuelve los
//     cruces reales, road-to-worldcup va fijando quién pasó — pens-correcto
//     (usa el equipo que la fuente publicó, no un cálculo de los 90').
function buildLockedFromDb(
  dbRows: Map<number, DbKnockoutRow>,
  teamIds: string[],
): { assignments: Record<string, string>; winners: Record<number, string> } {
  const assignments: Record<string, string> = {};
  const winners: Record<number, string> = {};
  for (const seed of WORLDCUP_KNOCKOUT_SEEDS) {
    const row = dbRows.get(seed.matchDay);
    if (!row) continue;
    const sides: Array<{ side: "home" | "away"; team: string; slot: string }> = [
      { side: "home", team: row.home_team, slot: seed.homeSlot },
      { side: "away", team: row.away_team, slot: seed.awaySlot },
    ];
    for (const { side, team, slot } of sides) {
      if (!team || isPlaceholderTeam(team)) continue;
      const id = resolveTeamId(team, teamIds);
      if (!id) continue;
      const feeder = feederMatchDay(slot);
      if (feeder != null) winners[feeder] = id;
      else assignments[`${seed.matchDay}:${side}`] = id;
    }
  }
  return { assignments, winners };
}

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
  const teamIds = teams.map((t) => t.id);
  const fromDb = buildLockedFromDb(dbRows, teamIds);
  // 16vos: hardcode verificado como base + lo que la DB ya tenga (la DB manda).
  // Avances (octavos+): solo de la DB, fijándose solos a medida que se resuelven.
  const locked = { ...buildLockedAssignments(new Set(teamIds)), ...fromDb.assignments };

  return (
    <>
      <BracketBoard
        teams={teams}
        matches={matches}
        locked={locked}
        lockedWinners={fromDb.winners}
      />
      <BracketIntroModal />
    </>
  );
}
