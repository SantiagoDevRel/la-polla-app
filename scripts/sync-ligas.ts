// scripts/sync-ligas.ts — trae los fixtures de las ligas desde football-data.
//
//   npx tsx scripts/sync-ligas.ts            # las 6 de football-data
//   npx tsx scripts/sync-ligas.ts premier_2025
//
// Por que existe: el endpoint /api/matches/sync se cuelga compilando en dev
// (la ruta arrastra medio repo). Este script hace lo mismo sin Next de por
// medio, y sobre todo RESPETA LA REGLA #1 del repo: toda insercion a `matches`
// pasa por el RPC `upsert_match_safe`, jamas por un .insert/.upsert directo.
// El RPC es el que evita partidos duplicados cuando dos proveedores describen
// el mismo encuentro con external_id distinto.
//
// Es idempotente: correlo las veces que quieras.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const FD_BASE = "https://api.football-data.org/v4";

/** Solo las competencias que cubre el plan free de football-data. */
const LIGAS = [
  { id: 2021, tournament: "premier_2025", label: "Premier League" },
  { id: 2014, tournament: "laliga_2025", label: "La Liga" },
  { id: 2019, tournament: "seriea_2025", label: "Serie A" },
  { id: 2002, tournament: "bundesliga_2025", label: "Bundesliga" },
  { id: 2015, tournament: "ligue1_2025", label: "Ligue 1" },
  { id: 2001, tournament: "champions_2025", label: "Champions League" },
] as const;

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  homeTeam: { name: string | null; shortName: string | null; crest: string | null };
  awayTeam: { name: string | null; shortName: string | null; crest: string | null };
  score: { fullTime: { home: number | null; away: number | null } };
  venue?: string | null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fdKey = process.env.FOOTBALL_DATA_API_KEY;

if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
if (!fdKey) throw new Error("Falta FOOTBALL_DATA_API_KEY");

const db = createClient(url, key, { auth: { persistSession: false } });

/** football-data → el vocabulario de fases del repo. */
function phaseOf(stage: string): string {
  const s = (stage || "").toUpperCase();
  if (s.includes("FINAL") && !s.includes("SEMI") && !s.includes("QUARTER")) return "final";
  if (s.includes("SEMI")) return "semi_finals";
  if (s.includes("QUARTER")) return "quarter_finals";
  if (s.includes("LAST_16") || s.includes("ROUND_OF_16")) return "round_of_16";
  if (s.includes("PLAYOFF")) return "round_of_32";
  return "group_stage";
}

/** football-data → el vocabulario de estados del repo. */
function statusOf(s: string): string {
  switch (s) {
    case "FINISHED":
    case "AWARDED":
      return "finished";
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    case "POSTPONED":
    case "SUSPENDED":
    case "CANCELLED":
      return "postponed";
    default:
      return "scheduled";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function syncLiga(liga: (typeof LIGAS)[number]) {
  const res = await fetch(`${FD_BASE}/competitions/${liga.id}/matches`, {
    headers: { "X-Auth-Token": fdKey! },
  });

  if (res.status === 429) {
    console.log(`  ${liga.label}: rate limit, espero 65s...`);
    await sleep(65_000);
    return syncLiga(liga);
  }
  if (!res.ok) {
    console.log(`  ${liga.label}: HTTP ${res.status} — la salto`);
    return { ok: 0, fail: 0 };
  }

  const { matches } = (await res.json()) as { matches: FdMatch[] };

  // Solo lo que sirve para armar pollas: de hoy en adelante, mas los ultimos
  // 7 dias (para que los resultados recientes puedan cerrar pollas vivas).
  const desde = Date.now() - 7 * 24 * 3600_000;
  const relevantes = matches.filter((m) => new Date(m.utcDate).getTime() >= desde);

  let ok = 0;
  let fail = 0;

  for (const m of relevantes) {
    const home = m.homeTeam.name ?? m.homeTeam.shortName;
    const away = m.awayTeam.name ?? m.awayTeam.shortName;
    if (!home || !away) continue; // fixture sin equipos definidos todavia

    // ⚠️ REGLA #1: SIEMPRE por el RPC. Nunca .from("matches").upsert().
    const { error } = await db.rpc("upsert_match_safe", {
      p_external_id: String(m.id),
      p_tournament: liga.tournament,
      p_match_day: m.matchday ?? null,
      p_phase: phaseOf(m.stage),
      p_home_team: home,
      p_away_team: away,
      p_home_team_flag: m.homeTeam.crest ?? null,
      p_away_team_flag: m.awayTeam.crest ?? null,
      p_scheduled_at: m.utcDate,
      p_venue: m.venue ?? null,
      p_home_score: m.score.fullTime.home,
      p_away_score: m.score.fullTime.away,
      p_status: statusOf(m.status),
      p_elapsed: null,
    });

    if (error) {
      fail += 1;
      if (fail <= 2) console.log(`    ! ${home} vs ${away}: ${error.message}`);
    } else {
      ok += 1;
    }
  }

  console.log(`  ${liga.label}: ${ok} partidos, ${fail} fallos (de ${matches.length} totales)`);
  return { ok, fail };
}

async function main() {
  const filtro = process.argv[2];
  const objetivo = filtro ? LIGAS.filter((l) => l.tournament === filtro) : LIGAS;

  if (objetivo.length === 0) {
    console.log(`No conozco "${filtro}". Opciones: ${LIGAS.map((l) => l.tournament).join(", ")}`);
    process.exit(1);
  }

  console.log(`Sincronizando ${objetivo.length} liga(s) desde football-data...\n`);
  let total = 0;
  for (const liga of objetivo) {
    const r = await syncLiga(liga);
    total += r.ok;
    // Plan free: 10 requests/minuto. 7s entre ligas y no lo tocamos.
    await sleep(7000);
  }
  console.log(`\nListo: ${total} partidos sincronizados.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
