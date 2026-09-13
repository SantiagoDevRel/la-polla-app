// lib/teams/baked-squads.ts — Planteles HORNEADOS del Mundial 2026.
//
// Movido desde lib/espn/baked-squads.ts (2026-09-13). API-Football no cubre el
// Mundial en este proyecto, así que la pestaña Plantel del torneo sale 100% de
// este JSON: carga instantánea y cero proveedores en runtime.
//
// Escudos de club: el JSON guarda la URL original del CDN de ESPN como
// IDENTIDAD, nunca como imagen a servir. Se resuelven a WebP locales
// (scripts/bake-team-crests.mjs --worldcup-squads → worldcup-club-crests.json)
// o quedan en null. Las fotos de jugadores (~119) siguen siendo URL externas;
// si fallan, la ficha muestra el pollito de reemplazo.
//
// Server-only: solo lo importa app/api/teams/roster/route.ts. Así los ~230 KB
// del JSON y el mapa de escudos jamás entran al bundle del navegador.
import "server-only";
import bakedRaw from "./baked-worldcup-squads.json";
import squadCrests from "./worldcup-club-crests.json";
import catalog from "./crest-catalog.json";
import overrides from "./crest-overrides.json";
import { teamNameKey } from "./team-name-key";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import type { SquadPlayer } from "@/lib/football/squad";

const BAKED = bakedRaw as Record<string, SquadPlayer[]>;

// Índice por clave normalizada (sin acentos/caja) → tolera el drift de
// ortografía entre proveedores ("Curaçao" vs "Curacao") sin re-hornear.
const BAKED_BY_KEY: Record<string, SquadPlayer[]> = {};
for (const [name, squad] of Object.entries(BAKED)) {
  BAKED_BY_KEY[teamNameKey(name)] = squad;
}

const SQUAD_CRESTS: Record<string, string> = squadCrests.bySource;
const CATALOG: Record<string, string> = catalog.bySource;
const REVIEWED = overrides as Record<string, { source: string; local?: string }>;

/**
 * Escudo local del club de un jugador horneado. Orden: bandera (selecciones
 * listadas como club), identidad revisada, catálogo general y mapa del bake de
 * planteles. Nunca devuelve una URL externa: sin asset local, null.
 */
export function bakedClubCrest(club: string | null, source: string | null): string | null {
  if (!club || !source) return null;
  const flag = flagUrlForTeam(club);
  if (flag) return flag;
  const reviewed = REVIEWED[teamNameKey(club)];
  if (reviewed) return reviewed.local ?? CATALOG[reviewed.source] ?? null;
  return CATALOG[source] ?? SQUAD_CRESTS[source] ?? null;
}

/**
 * Plantel horneado del Mundial 2026 por nombre de equipo (== matches.home_team).
 * null si el equipo no fue horneado (slot de repechaje sin resolver).
 */
export function getBakedWorldCupRoster(teamName: string): SquadPlayer[] | null {
  const squad = BAKED[teamName] ?? BAKED_BY_KEY[teamNameKey(teamName)];
  if (!squad || squad.length === 0) return null;
  return squad.map((player) => ({ ...player, clubCrest: bakedClubCrest(player.club, player.clubCrest) }));
}
