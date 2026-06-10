// lib/espn/discover.ts — Descubre fixtures de un torneo entero desde
// ESPN y los inserta/actualiza en la tabla `matches`.
//
// Diferencia con lib/espn/sync.ts:
//   - sync.ts trabaja sobre matches que YA existen en la DB (los
//     descubrió football-data o un discover previo). Solo updatea
//     status/score/elapsed durante live.
//   - discover.ts trae fixtures NUEVOS — primer encuentro entre
//     un evento ESPN y nuestra DB. Inserta vía upsert_match_safe()
//     para no pisar campos in-play marcados por live source.
//
// Estrategia para minimizar requests:
//   1. ESPN soporta ?dates=YYYYMMDD-YYYYMMDD. 1 request por torneo
//      cubre el rango entero.
//   2. Llamamos en ventanas de 30 días por seguridad (aunque ESPN
//      usualmente devuelve más).
//   3. Idempotente: re-ejecutar trae los mismos fixtures, upsert_match_
//      safe los reescribe sin tocar in-play data.
//
// Uso típico: cron cada 6h llama a este path para tournaments con al
// menos una polla `scope != custom` activa.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ESPN_LEAGUE_BY_TOURNAMENT,
  fetchEspnScoreboard,
  mapEspnStatus,
  parseEspnScore,
  parseEspnMinute,
} from "./client";
import { hasPlaceholderTeam } from "@/lib/matches/is-placeholder";

// ⚠️ ensurePlaceholders fue ELIMINADA (2026-06-10). Era código muerto (cero
// callers desde migración 050) que insertaba filas "TBD vs TBD" directo a
// matches, violando las Reglas #1 y #2 del CLAUDE.md. Los slots de bracket
// del Mundial se manejan con códigos reales ("W93", "1A") + promoción
// in-place en upsert_match_safe v4 (migración 062). No reintroducir.

/**
 * Inserta o actualiza un fixture descubierto vía ESPN.
 *
 * Toda la lógica de dedup + promoción de placeholders vive ahora en el
 * RPC `upsert_match_safe` (migration 048). Quad-lookup en orden:
 *   1. external_id exacto
 *   2. espn_id (atrapa el caso "antes entró como FD, ahora ESPN")
 *   3. semantic dedup (tournament + scheduled_at±2h + teams normalizados)
 *   4. promoción de placeholder TBD libre del mismo (tournament, phase)
 *
 * Antes esto vivía partido en app code (promoteOrInsert) + RPC, y el
 * primer path no chequeaba el segundo → cuando ESPN llegaba después
 * de football-data, el placeholder-grab generaba duplicados. Single
 * source of truth = no hay forma de bypassear dedup.
 */
async function upsertMatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tournamentSlug: string,
  phase: string | null,
  payload: {
    external_id: string;
    home_team: string;
    away_team: string;
    home_team_flag: string | null;
    away_team_flag: string | null;
    home_team_abbr: string | null;
    away_team_abbr: string | null;
    scheduled_at: string;
    venue: string | null;
    status: string;
    home_score: number | null;
    away_score: number | null;
    elapsed: number | null;
    match_day: number | null;
  },
): Promise<"ok" | "error"> {
  const { error } = await supabase.rpc("upsert_match_safe", {
    p_external_id: payload.external_id,
    p_tournament: tournamentSlug,
    p_match_day: payload.match_day,
    p_phase: phase,
    p_home_team: payload.home_team,
    p_away_team: payload.away_team,
    p_home_team_flag: payload.home_team_flag,
    p_away_team_flag: payload.away_team_flag,
    p_home_team_abbr: payload.home_team_abbr,
    p_away_team_abbr: payload.away_team_abbr,
    p_scheduled_at: payload.scheduled_at,
    p_venue: payload.venue,
    p_home_score: payload.home_score,
    p_away_score: payload.away_score,
    p_status: payload.status,
    p_elapsed: payload.elapsed,
  });
  return error ? "error" : "ok";
}

export interface DiscoverResult {
  tournament: string;
  league: string;
  fetched: number;
  inserted_or_updated: number;
  errors: number;
  /** Sample de eventos no-mapeados (formato raro). */
  warnings: string[];
}

/**
 * Mapea fase de ESPN a nuestro enum. ESPN puede tener:
 *   - season.type.id (1=preseason, 2=regular, 3=playoffs)
 *   - notes con el nombre de fase
 *   - season.slug ("2025-2026")
 *
 * Para CONMEBOL/UEFA hay rounds estructuradas. Para ligas locales
 * normalmente todo es 'regular_season' hasta que entren playoffs.
 */
// Default phase per tournament cuando ESPN no incluye headline (típico
// en torneos de liga regular y CONMEBOL group stage). Para torneos
// con bracket fijo desde el día 1 (Champions, Mundial), default es
// 'regular_season' (league_stage para UCL).
const DEFAULT_PHASE_BY_TOURNAMENT: Record<string, string> = {
  libertadores_2026: "group_stage",
  sudamericana_2026: "group_stage",
  worldcup_2026: "group_stage",
  champions_2025: "league_stage",
  laliga_2025: "regular_season",
  premier_2025: "regular_season",
  seriea_2025: "regular_season",
  betplay_2026: "regular_season",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEspnPhase(event: any, tournamentSlug: string): string | null {
  // ESPN incluye un array de "notes" en competitions[0] con la headline
  // que indica fase ("Round of 16", "Quarterfinal", etc). No está en
  // nuestros types modelados, así que parseamos defensive.
  const notes: Array<{ headline?: string; type?: string }> =
    event.competitions?.[0]?.notes ?? [];
  const headline = notes.find((n) => n.type === "event")?.headline ?? "";
  const lower = headline.toLowerCase();
  if (!lower) return DEFAULT_PHASE_BY_TOURNAMENT[tournamentSlug] ?? "regular_season";
  if (lower.includes("final") && !lower.includes("semi") && !lower.includes("quarter")) return "final";
  if (lower.includes("third") || lower.includes("3rd")) return "third_place";
  if (lower.includes("semi")) return "semi_finals";
  if (lower.includes("quarter") || lower.includes("cuartos")) return "quarter_finals";
  if (lower.includes("round of 16") || lower.includes("octavos")) return "round_of_16";
  if (lower.includes("round of 32")) return "round_of_32";
  if (lower.includes("group") || lower.includes("grupo")) return "group_stage";
  if (lower.includes("playoff")) return "playoff";
  // Sin headline: usar el default del torneo. Mejor que asumir
  // "regular_season" para todo — para CONMEBOL son group_stage.
  return DEFAULT_PHASE_BY_TOURNAMENT[tournamentSlug] ?? "regular_season";
}

interface FetchOpts {
  /** Días hacia adelante a buscar fixtures (default 90). */
  daysAhead?: number;
  /** Días hacia atrás a re-revisar (default 7, para reschedules). */
  daysBack?: number;
}

export async function discoverTournament(
  tournamentSlug: string,
  opts: FetchOpts = {},
): Promise<DiscoverResult> {
  const result: DiscoverResult = {
    tournament: tournamentSlug,
    league: ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug] ?? "(no mapping)",
    fetched: 0,
    inserted_or_updated: 0,
    errors: 0,
    warnings: [],
  };

  const leagueCode = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!leagueCode) {
    result.errors++;
    result.warnings.push(`Sin mapeo ESPN para ${tournamentSlug}`);
    return result;
  }

  // 2026-05-12: Mundial 2026 esta cubierto end-to-end por
  // openfootball/api-football (lib/api-football/sync-worldcup.ts) — los 104
  // partidos con sus phases correctos. ESPN para el Mundial introduce
  // duplicados (group stage real-team con naming distinto) + placeholders
  // mal etiquetados (phase=group_stage cuando deberia ser knockout). Mejor
  // skipear el discover ESPN para worldcup_2026. ESPN sigue siendo util
  // para live scores via lib/espn/sync.ts (que solo updates rows existentes).
  if (tournamentSlug === "worldcup_2026") {
    result.warnings.push("Skip ESPN discover para worldcup_2026 (api-football canonico)");
    return result;
  }

  const supabase = createAdminClient();
  const daysAhead = opts.daysAhead ?? 90;
  const daysBack = opts.daysBack ?? 7;

  // ESPN scoreboard sin ?dates= devuelve solo el día actual. Para
  // discovering, iteramos por ventanas de 14 días — ESPN devuelve
  // hasta ~50 events por ventana sin trabarse.
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - daysBack);
  const end = new Date(today);
  end.setDate(end.getDate() + daysAhead);

  // Una sola request con date range. ESPN acepta formato YYYYMMDD-YYYYMMDD.
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const datesParam = `${fmt(start)}-${fmt(end)}`;

  let events: Awaited<ReturnType<typeof fetchEspnScoreboard>> = [];
  try {
    events = await fetchEspnScoreboardWithDates(leagueCode, datesParam);
  } catch (err) {
    console.error(`[discover] ${tournamentSlug} fetch failed:`, err);
    result.errors++;
    return result;
  }
  result.fetched = events.length;

  // NO pre-creamos placeholders TBD vs TBD. Se decidió en 2026-05-08
  // tras descubrir que cuando una fase de bracket aún no tenía matchups
  // publicados, los TBDs cluttereaban /pollas/crear y solo se promovían
  // tarde. Ahora la UI muestra "fase pendiente" usando TOURNAMENT_STRUCTURE
  // sin necesidad de rows en DB. Si necesitamos predictions a ciegas
  // sobre una final futura, lo modelamos con UN row específico, no con
  // pre-creación masiva. (Lookup #4 en upsert_match_safe queda por compat
  // con cualquier TBD legacy que aún tenga predictions vivas.)

  if (events.length === 0) return result;

  for (const event of events) {
    try {
      const competition = event.competitions[0];
      const home = competition?.competitors.find((c) => c.homeAway === "home");
      const away = competition?.competitors.find((c) => c.homeAway === "away");
      if (!home || !away) {
        result.warnings.push(`Evento sin home/away: ${event.id}`);
        continue;
      }

      // REGLA #2: skip si los teams son placeholders del bracket (ej:
      // "Round of 32 1 Winner", "Group A 2nd Place"). ESPN devuelve esto
      // para knockouts aun sin resolver — no entran en matches.
      if (hasPlaceholderTeam(home.team.displayName, away.team.displayName)) {
        result.warnings.push(
          `Skip placeholder ${event.id}: ${home.team.displayName} vs ${away.team.displayName}`,
        );
        continue;
      }

      const status = mapEspnStatus(event.status) ?? "scheduled";
      const homeScore = parseEspnScore(home.score);
      const awayScore = parseEspnScore(away.score);
      const elapsed = parseEspnMinute(event.status.displayClock, event.status.period);
      const phase = mapEspnPhase(event, tournamentSlug);

      // Single path: upsert_match_safe RPC maneja todo (dedup por
      // external_id/espn_id, semantic dedup, y promoción de placeholders
      // como último resort). Predicciones quedan ligadas al UUID
      // resultante sin importar qué path tomó el RPC.
      const upsert = await upsertMatch(supabase, tournamentSlug, phase, {
        external_id: `espn:${event.id}`,
        home_team: home.team.displayName,
        away_team: away.team.displayName,
        home_team_flag: home.team.logo ?? null,
        away_team_flag: away.team.logo ?? null,
        home_team_abbr: home.team.abbreviation ?? null,
        away_team_abbr: away.team.abbreviation ?? null,
        scheduled_at: event.date,
        venue: null,
        status,
        home_score: homeScore,
        away_score: awayScore,
        elapsed,
        match_day: null,
      });

      if (upsert === "error") {
        console.error(`[discover] upsert_match_safe ${event.id} failed`);
        result.errors++;
      } else {
        result.inserted_or_updated++;
      }
    } catch (err) {
      console.error("[discover] event failed:", err);
      result.errors++;
    }
  }

  return result;
}

// Fetch privado con date range (ESPN no lo expone en el helper estándar
// del client pero acepta el query param).
async function fetchEspnScoreboardWithDates(leagueCode: string, datesParam: string) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard?dates=${datesParam}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { events?: Awaited<ReturnType<typeof fetchEspnScoreboard>> };
  return data.events ?? [];
}
