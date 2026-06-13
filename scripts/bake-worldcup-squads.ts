// scripts/bake-worldcup-squads.ts — Hornea los planteles del Mundial 2026
// a un JSON estático para que /api/teams/roster cargue INSTANTÁNEO (sin las
// ~26 llamadas encadenadas por jugador que ESPN exige para resolver el club).
//
// Uso:
//   npx tsx scripts/bake-worldcup-squads.ts
//
// Re-correr SOLO si una selección cambia su plantel (reemplazo por lesión,
// dorsal nuevo). Genera lib/espn/baked-worldcup-squads.json — la forma es
// EXACTAMENTE SquadPlayer[] (misma que devuelve fetchEspnTeamRoster en vivo),
// así que la UI no cambia nada.
//
// Las llamadas a ESPN ocurren acá, una sola vez, al hornear. En runtime la app
// lee el JSON (cero ESPN para el Mundial).
import { writeFileSync } from "fs";
import { join } from "path";
import { WORLDCUP_ESPN_TEAM_IDS } from "../lib/espn/worldcup-team-ids";
import { fetchEspnTeamRoster, type SquadPlayer } from "../lib/espn/teams";

const OUT = join(process.cwd(), "lib", "espn", "baked-worldcup-squads.json");

async function main() {
  const entries = Object.entries(WORLDCUP_ESPN_TEAM_IDS);
  const out: Record<string, SquadPlayer[]> = {};
  let withPhotos = 0;
  let totalPlayers = 0;

  // Secuencial por equipo (dentro de cada equipo ya hay concurrencia 8 para
  // los clubes). No martillar ESPN — esto corre una sola vez.
  for (const [name, id] of entries) {
    try {
      const players = await fetchEspnTeamRoster("worldcup_2026", id);
      out[name] = players;
      totalPlayers += players.length;
      withPhotos += players.filter((p) => p.headshot).length;
      const photos = players.filter((p) => p.headshot).length;
      const clubs = players.filter((p) => p.club).length;
      console.log(
        `✓ ${name.padEnd(20)} ${String(players.length).padStart(2)} jugadores · ${photos} con foto · ${clubs} con club`,
      );
    } catch (err) {
      console.error(`✗ ${name}: ${(err as Error).message}`);
      out[name] = [];
    }
  }

  // JSON compacto (sin pretty-print) — solo vive server-side, no se sirve al
  // browser literal, así que el tamaño en disco importa más que la legibilidad.
  writeFileSync(OUT, JSON.stringify(out), "utf8");
  console.log(
    `\n🐥 Horneados ${entries.length} equipos · ${totalPlayers} jugadores · ${withPhotos} con foto`,
  );
  console.log(`→ ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
