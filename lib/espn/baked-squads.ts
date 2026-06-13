// lib/espn/baked-squads.ts — Acceso a los planteles HORNEADOS del Mundial 2026.
//
// Por qué existe: el plantel de una selección no cambia durante la Copa, pero
// resolverlo en vivo desde ESPN cuesta ~26 llamadas encadenadas (una por
// jugador para sacar su club) → el tab "Plantel" tardaba ~1-2s en el cold load.
// Horneamos los 48 planteles una vez (scripts/bake-worldcup-squads.ts) y acá
// los servimos desde disco: carga INSTANTÁNEA, cero ESPN en runtime para el
// Mundial, free-tier intacto.
//
// La forma es EXACTAMENTE SquadPlayer[] (la misma que devuelve
// fetchEspnTeamRoster en vivo), así que la UI no cambia nada.
//
// Server-only por construcción: este archivo SOLO lo importa la route handler
// app/api/teams/roster/route.ts (server). Nunca un componente cliente — así el
// JSON de 228KB jamás entra al bundle del browser.
//
// Re-hornear si una selección cambia su plantel (reemplazo por lesión, dorsal
// nuevo): `npx tsx scripts/bake-worldcup-squads.ts` y commitear el JSON.
import bakedRaw from "./baked-worldcup-squads.json";
import type { SquadPlayer } from "./teams";

const BAKED = bakedRaw as Record<string, SquadPlayer[]>;

/**
 * Plantel horneado del Mundial 2026 por nombre de equipo (== matches.home_team).
 * Devuelve null si el equipo no fue horneado todavía (slots de repechaje aún sin
 * resolver) → el caller cae a ESPN en vivo como fallback.
 */
export function getBakedWorldCupRoster(teamName: string): SquadPlayer[] | null {
  const squad = BAKED[teamName];
  return squad && squad.length > 0 ? squad : null;
}
