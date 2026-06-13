// lib/espn/summary.ts — Datos en vivo de UN partido desde ESPN /summary.
//
// keyEvents (timeline de goles/tarjetas/cambios con minuto + jugador),
// boxscore (posesión, tiros, faltas…) y alineaciones con formación. Todo
// público, sin auth, sub-minuto de lag (es lo que alimenta la app de
// ESPN). Shapes verificados contra el Mundial 2026 real (2026-06-12).
//
// 🔑 ESCALABILIDAD / free-tier: cacheado con Next Data Cache (revalidate),
// compartido entre TODOS los usuarios. revalidate corto en vivo (30s),
// largo para partidos terminados (1h, los datos ya no cambian). El costo
// NO escala con usuarios — solo con (partidos distintos × frecuencia de
// refresh). 500 users mirando el mismo partido = 1 hit a ESPN cada 30s.
//
// NO toca fetchEspnScoreboard (client.ts) — ese usa cache:"no-store" a
// propósito porque el live sync necesita el dato fresco sí o sí.
import { ESPN_LEAGUE_BY_TOURNAMENT } from "./client";
import {
  NATIONAL_TEAM_TOURNAMENTS,
  fetchAthleteClubId,
  fetchClubName,
  mapWithConcurrency,
} from "./club";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// ─────────────────────────────────────────────────────────────────────
// Raw (parcial) — solo modelamos lo que consumimos.
// ─────────────────────────────────────────────────────────────────────
interface RawClock {
  displayValue?: string;
}
interface RawType {
  text?: string;
}
interface RawTeamRef {
  id?: string;
  displayName?: string;
}
interface RawParticipant {
  athlete?: { displayName?: string };
}
interface RawKeyEvent {
  type?: RawType;
  text?: string;
  shortText?: string;
  clock?: RawClock;
  team?: RawTeamRef;
  participants?: RawParticipant[];
  scoringPlay?: boolean;
}
interface RawStat {
  name?: string;
  label?: string;
  displayValue?: string;
}
interface RawBoxTeam {
  homeAway?: "home" | "away";
  team?: RawTeamRef;
  statistics?: RawStat[];
}
interface RawAthlete {
  starter?: boolean;
  jersey?: string;
  subbedIn?: boolean;
  subbedOut?: boolean;
  athlete?: { id?: string; displayName?: string; headshot?: { href?: string } };
  position?: { abbreviation?: string };
}
interface RawRoster {
  homeAway?: string;
  team?: RawTeamRef;
  formation?: string;
  roster?: RawAthlete[];
}
interface RawSummary {
  keyEvents?: RawKeyEvent[];
  boxscore?: { teams?: RawBoxTeam[] };
  rosters?: RawRoster[];
}

// ─────────────────────────────────────────────────────────────────────
// Normalizado — lo que consume la UI.
// ─────────────────────────────────────────────────────────────────────
export type MatchSide = "home" | "away" | "neutral";

export interface TimelineEvent {
  /** "9'", "45+2'", "" (kickoff). */
  minute: string;
  /** "Goal", "Yellow Card", "Substitution"… (texto crudo de ESPN). */
  type: string;
  side: MatchSide;
  isGoal: boolean;
  scorer: string | null;
  assist: string | null;
  /** Jugador principal del evento (goleador, amonestado, etc.) — para
   *  eventos no-gol (tarjetas/cambios) donde scorer es null. */
  player: string | null;
  /** Descripción legible que ya trae ESPN. */
  text: string;
}

export interface MatchStat {
  /** `name` ESTABLE de ESPN (possessionPct, foulsCommitted…) — clave de
   *  traducción robusta (el `label` llega en MAYÚSCULAS raras). Cae al
   *  label si ESPN no trae name. Ver lib/espn/labels-es.ts. */
  key: string;
  label: string;
  home: string;
  away: string;
}

export interface LineupPlayer {
  name: string;
  jersey: string | null;
  pos: string | null;
  starter: boolean;
  headshot: string | null;
  /** Club actual del jugador (solo selecciones; null si ESPN no lo trae). */
  club: string | null;
}

export interface Lineup {
  side: MatchSide;
  team: string;
  formation: string | null;
  players: LineupPlayer[];
}

export interface MatchSummary {
  timeline: TimelineEvent[];
  stats: MatchStat[];
  lineups: Lineup[];
}

// Tipos de keyEvent que cuentan como gol (además de scoringPlay).
const GOAL_TYPES = new Set(["Goal", "Penalty - Scored", "Own Goal"]);

/**
 * Trae el summary de un partido y lo normaliza. Devuelve null si la liga
 * no está mapeada o ESPN responde error (el caller decide el fallback —
 * típico: mostrar el partido sin el detalle en vivo, nunca romper).
 */
export async function fetchEspnSummary(
  tournamentSlug: string,
  eventId: string,
  opts: { live: boolean },
): Promise<MatchSummary | null> {
  const league = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!league) return null;
  const url = `${ESPN_BASE}/${league}/summary?event=${encodeURIComponent(eventId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      // Vivo → 30s. Terminado → 1h. Next Data Cache, compartido global.
      next: { revalidate: opts.live ? 30 : 3600 },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const raw = (await res.json()) as RawSummary;
  const summary = normalizeSummary(raw);
  // Club actual en las alineaciones: solo selecciones (Mundial), best-effort.
  if (NATIONAL_TEAM_TOURNAMENTS.has(tournamentSlug)) {
    await enrichLineupClubs(raw, summary.lineups);
  }
  return summary;
}

export function normalizeSummary(raw: RawSummary): MatchSummary {
  const box = raw.boxscore?.teams ?? [];

  // teamId → side desde el boxscore (fuente confiable de home/away).
  const sideById = new Map<string, MatchSide>();
  for (const t of box) {
    if (t.team?.id && (t.homeAway === "home" || t.homeAway === "away")) {
      sideById.set(t.team.id, t.homeAway);
    }
  }

  const timeline: TimelineEvent[] = (raw.keyEvents ?? []).map((e) => {
    const type = e.type?.text ?? "";
    const isGoal = GOAL_TYPES.has(type) || e.scoringPlay === true;
    const parts = (e.participants ?? [])
      .map((p) => p.athlete?.displayName)
      .filter((n): n is string => Boolean(n));
    return {
      minute: e.clock?.displayValue ?? "",
      type,
      side: (e.team?.id ? sideById.get(e.team.id) : undefined) ?? "neutral",
      isGoal,
      scorer: isGoal ? parts[0] ?? null : null,
      assist: isGoal ? parts[1] ?? null : null,
      player: parts[0] ?? null,
      text: e.text ?? e.shortText ?? "",
    };
  });

  // Stats: lista de labels (en orden de aparición) emparejados home/away.
  const home = box.find((t) => t.homeAway === "home");
  const away = box.find((t) => t.homeAway === "away");
  const labels: string[] = [];
  const seen = new Set<string>();
  // label → name ESPN estable (para traducir en el cliente sin depender del
  // casing del label, que llega en MAYÚSCULAS para algunas stats).
  const nameByLabel = new Map<string, string>();
  for (const t of [home, away]) {
    for (const s of t?.statistics ?? []) {
      const label = s.label ?? s.name ?? "";
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
        if (s.name) nameByLabel.set(label, s.name);
      }
    }
  }
  const valueOf = (t: RawBoxTeam | undefined, label: string): string => {
    const s = (t?.statistics ?? []).find((x) => (x.label ?? x.name) === label);
    return s?.displayValue ?? "—";
  };
  const stats: MatchStat[] = labels.map((label) => ({
    key: nameByLabel.get(label) ?? label,
    label,
    home: valueOf(home, label),
    away: valueOf(away, label),
  }));

  const lineups: Lineup[] = (raw.rosters ?? []).map((r) => ({
    side: r.homeAway === "home" ? "home" : r.homeAway === "away" ? "away" : "neutral",
    team: r.team?.displayName ?? "",
    formation: r.formation ?? null,
    players: (r.roster ?? []).map((a) => ({
      name: a.athlete?.displayName ?? "",
      jersey: a.jersey ?? null,
      pos: a.position?.abbreviation ?? null,
      starter: a.starter === true,
      headshot: a.athlete?.headshot?.href ?? null,
      club: null,
    })),
  }));

  return { timeline, stats, lineups };
}

/**
 * Enriquece las alineaciones con el CLUB ACTUAL de cada jugador (solo
 * selecciones — en ligas de clubes sería redundante). El club no viene en el
 * summary; se resuelve por la core API de ESPN por atleta (ver lib/espn/club).
 * Muta `lineups` in-place. Best-effort: si un jugador no resuelve, queda null.
 *
 * Costo acotado: el resultado del summary va cacheado 30s (compartido global)
 * y los fetches por atleta/club están cacheados 24h, así que esto corre ~una
 * vez por partido, no por usuario.
 */
async function enrichLineupClubs(raw: RawSummary, lineups: Lineup[]): Promise<void> {
  const rosters = raw.rosters ?? [];
  // El map de normalizeSummary es 1:1 (sin filtros) → los índices de
  // rosters[k].roster[i] alinean con lineups[k].players[i].
  const tasks: { player: LineupPlayer; athleteId: string }[] = [];
  rosters.forEach((r, k) => {
    const lineup = lineups[k];
    if (!lineup) return;
    (r.roster ?? []).forEach((a, i) => {
      const player = lineup.players[i];
      const athleteId = a.athlete?.id;
      if (player && athleteId) tasks.push({ player, athleteId });
    });
  });
  if (tasks.length === 0) return;
  // Un club lo comparten varios jugadores → un solo fetch de nombre por club.
  const clubNameByIdPromise = new Map<string, Promise<string | null>>();
  await mapWithConcurrency(tasks, 8, async ({ player, athleteId }) => {
    const clubId = await fetchAthleteClubId(athleteId);
    if (!clubId) return;
    if (!clubNameByIdPromise.has(clubId)) clubNameByIdPromise.set(clubId, fetchClubName(clubId));
    player.club = await clubNameByIdPromise.get(clubId)!;
  });
}
