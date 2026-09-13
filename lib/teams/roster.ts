// lib/teams/roster.ts — Plantel de un club para la ficha de equipo, desde
// API-Football (2026-09-13: única fuente de partidos; ESPN quedó fuera).
//
// La ficha solo conoce el nombre del equipo tal cual está en `matches`, así
// que primero se resuelve el id de equipo de API-Football, de la fuente más
// verificable a la menos:
//   1. Una fila del torneo vinculada a un fixture ('apifootball:<id>' en
//      external_id o source_external_ids) cuyo fixture ya está en la caché
//      compartida: el lado (local/visitante) de la fila da el id del equipo.
//   2. El escudo de API-Football que el calendario escribió en esa misma fila
//      (media.api-sports.io/football/teams/<id>.png).
//   3. El inventario horneado de la liga (crest-coverage.json), por nombre
//      normalizado y con candidato único.
// Dos ids distintos en un mismo paso = identidad dudosa → sin plantel. Nunca
// se muestra el plantel de otro club.
//
// La cuota la administra loadFootballTeam (reserva atómica en SQL, una por
// hora por equipo). Si no hay reserva ni fixture reciente, se lee el plantel
// ya guardado en api_football_teams sin gastar solicitudes.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { knownFootballObservation } from "@/lib/api-football/feed";
import { loadFootballTeam } from "@/lib/api-football/teams";
import { RESULT_LEAGUES } from "@/lib/api-football/leagues";
import { linkedFixtureId, resultTeamKey } from "@/lib/api-football/results";
import { apiFootballPlayerPhoto } from "@/lib/api-football/player-photo";
import type { FootballSquadPlayer } from "@/lib/api-football/team-model";
import { squadPlayerFromApiFootball, type SquadPlayer } from "@/lib/football/squad";
import coverage from "./crest-coverage.json";

const AF_TEAM_LOGO = /^https:\/\/media\.api-sports\.io\/football\/teams\/([1-9]\d{0,9})\.png$/;
/** Filas por lado a revisar: las más cercanas a hoy bastan para encontrar un vínculo. */
const ROWS_PER_SIDE = 8;
const MAX_FIXTURE_LOOKUPS = 3;

interface TeamRow {
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  external_id: string | null;
  source_external_ids: string[] | null;
  scheduled_at: string;
}
const ROW_COLUMNS = "home_team, away_team, home_team_flag, away_team_flag, external_id, source_external_ids, scheduled_at";

type Side = "home" | "away";
const single = (ids: number[]): number | "ambiguous" | null => {
  const distinct = Array.from(new Set(ids));
  return distinct.length > 1 ? "ambiguous" : distinct[0] ?? null;
};

/** Paso 3: inventario horneado de la liga, por nombre normalizado. */
export function teamIdFromCoverage(tournament: string, team: string): number | null {
  const league = coverage.leagues.find((l) => l.slug === tournament);
  const key = resultTeamKey(team);
  if (!league || !key) return null;
  const found = league.teams.filter((t) => resultTeamKey(t.name) === key);
  return found.length === 1 ? found[0].id : null;
}

/** Paso 2: id del escudo que escribió API-Football en la fila. */
export function teamIdFromLogo(url: string | null | undefined): number | null {
  const hit = url?.match(AF_TEAM_LOGO);
  return hit ? Number(hit[1]) : null;
}

export async function resolveApiFootballTeamId(tournament: string, team: string): Promise<number | null> {
  const league = RESULT_LEAGUES[tournament];
  if (!league || !team) return null;
  const admin = createAdminClient();
  const sides: Side[] = ["home", "away"];
  const reads = await Promise.all(sides.map((side) => admin.from("matches").select(ROW_COLUMNS)
    .eq("tournament", tournament).eq(`${side}_team`, team)
    .order("scheduled_at", { ascending: false }).limit(ROWS_PER_SIDE)));
  const now = Date.now();
  const rows = sides.flatMap((side, i) => ((reads[i].data ?? []) as TeamRow[]).map((row) => ({ row, side })))
    .sort((a, b) => Math.abs(Date.parse(a.row.scheduled_at) - now) - Math.abs(Date.parse(b.row.scheduled_at) - now));

  const fromFixtures: number[] = [];
  let lookups = 0;
  for (const { row, side } of rows) {
    const fixtureId = linkedFixtureId(row);
    if (typeof fixtureId !== "number" || lookups >= MAX_FIXTURE_LOOKUPS) continue;
    lookups++;
    const observation = await knownFootballObservation(fixtureId);
    const fixture = observation?.fixture;
    if (fixture && fixture.league?.id === league) fromFixtures.push(fixture.teams[side].id);
  }
  const fixtureId = single(fromFixtures);
  if (fixtureId === "ambiguous") return null;
  if (fixtureId) return fixtureId;

  const logoId = single(rows.map(({ row, side }) => teamIdFromLogo(row[`${side}_team_flag`])).filter((id): id is number => id !== null));
  if (logoId === "ambiguous") return null;
  return logoId ?? teamIdFromCoverage(tournament, team);
}

/** Plantel de API-Football para un club de los torneos activos. [] si no hay dato confiable. */
export async function loadApiFootballRoster(tournament: string, team: string): Promise<SquadPlayer[]> {
  const id = await resolveApiFootballTeamId(tournament, team);
  if (!id) return [];
  let players: FootballSquadPlayer[] = (await loadFootballTeam(id))?.players ?? [];
  if (players.length === 0) {
    const { data } = await createAdminClient().from("api_football_teams").select("squad").eq("team_id", id).maybeSingle();
    players = Array.isArray(data?.squad)
      ? (data.squad as FootballSquadPlayer[]).map((p) => ({ ...p, photo: p.photo || apiFootballPlayerPhoto(p.id) }))
      : [];
  }
  return players.filter((p) => typeof p?.name === "string" && p.name.trim() !== "").map(squadPlayerFromApiFootball);
}
