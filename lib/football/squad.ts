// lib/football/squad.ts — Forma del plantel que consume la ficha de equipo
// (components/match/TeamInfoSheet.tsx, pestaña Plantel) y su normalización
// desde API-Football. Sin runtime de servidor: seguro para el cliente.
//
// Antes vivía en lib/espn/teams.ts. La forma se conserva tal cual para que el
// plantel horneado del Mundial (lib/teams/baked-worldcup-squads.json) y el de
// API-Football se rendericen igual.
import type { FootballSquadPlayer } from "@/lib/api-football/team-model";

/** Línea gruesa del jugador, para agrupar el plantel. */
export type PlayerLine = "GK" | "DEF" | "MID" | "FWD" | "OTH";

export interface SquadPlayer {
  name: string;
  jersey: string | null;
  /** Código de posición (G/D/M/F o detallado); se traduce con positionLabel. */
  pos: string | null;
  line: PlayerLine;
  age: number | null;
  headshot: string | null;
  /** Club actual del jugador (solo selecciones; en clubes el plantel YA es el club). */
  club: string | null;
  /** Escudo del club del jugador: ruta local del catálogo o null. */
  clubCrest: string | null;
}

// API-Football /players/squads usa cuatro posiciones en inglés.
const AF_POSITIONS: Record<string, { pos: string; line: PlayerLine }> = {
  Goalkeeper: { pos: "G", line: "GK" },
  Defender: { pos: "D", line: "DEF" },
  Midfielder: { pos: "M", line: "MID" },
  Attacker: { pos: "F", line: "FWD" },
};

/** Jugador de API-Football → SquadPlayer. Un dato ausente queda null, nunca inventado. */
export function squadPlayerFromApiFootball(player: FootballSquadPlayer): SquadPlayer {
  const known = AF_POSITIONS[player.position];
  const jersey = Number.isInteger(player.number) && (player.number as number) >= 0 ? String(player.number) : null;
  const age = Number.isInteger(player.age) && (player.age as number) > 0 ? player.age : null;
  return {
    name: player.name,
    jersey,
    pos: known?.pos ?? (player.position || null),
    line: known?.line ?? "OTH",
    age,
    headshot: player.photo || null,
    club: null,
    clubCrest: null,
  };
}
