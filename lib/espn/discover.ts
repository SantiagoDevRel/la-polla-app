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
import { TOURNAMENT_STRUCTURE } from "@/lib/tournaments/structure";

/**
 * Asegura placeholder rows ('TBD vs TBD') para cada fase con slots
 * conocidos del torneo. Idempotente — chequea match_day por slot, solo
 * crea los faltantes. external_id formato:
 *   "placeholder:<tournament>:<phase>:<slot>"
 *
 * Cuando ESPN publica el matchup real de un slot, la lógica de
 * promoteOrInsert (más abajo) actualiza el placeholder con los datos
 * reales sin cambiar el UUID — predicciones se mantienen.
 *
 * Esta función NO hace requests a ESPN — solo trabaja sobre nuestra
 * DB. Por eso es seguro correrla en cada visita a crear-polla sin
 * preocuparse por rate limits externos.
 */
export async function ensurePlaceholders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tournamentSlug: string,
): Promise<{ created: number }> {
  const struct = TOURNAMENT_STRUCTURE[tournamentSlug];
  if (!struct) return { created: 0 };

  // Una sola query trae TODOS los matches del torneo (placeholder y
  // reales). Necesitamos los reales para no excederlos: si hay 64
  // fixtures reales en group_stage y slots=96, solo necesitamos 32
  // placeholders, no 96. Antes inflábamos a 96+64=160.
  const { data: existing } = await supabase
    .from("matches")
    .select("phase, match_day, external_id")
    .eq("tournament", tournamentSlug);
  type MatchRow = { phase: string | null; match_day: number | null; external_id: string | null };
  const rows = (existing || []) as MatchRow[];
  // realCountByPhase: rows que NO son placeholder. Cuentan contra el budget.
  const realCountByPhase = new Map<string, number>();
  // existingSlotsByPhase: match_day de placeholders existentes para cada fase.
  const existingSlotsByPhase = new Map<string, Set<number>>();
  for (const m of rows) {
    const isPlaceholder = (m.external_id ?? "").startsWith("placeholder:");
    const phaseKey = m.phase ?? "";
    if (isPlaceholder) {
      const set = existingSlotsByPhase.get(phaseKey) ?? new Set<number>();
      if (m.match_day != null) set.add(m.match_day);
      existingSlotsByPhase.set(phaseKey, set);
    } else {
      realCountByPhase.set(phaseKey, (realCountByPhase.get(phaseKey) ?? 0) + 1);
    }
  }

  // Acumulamos TODOS los rows a insertar y mandamos UN solo INSERT
  // batched al final. Antes haciamos N RPC sequential calls (250 para
  // Libertadores) que tardaba >20s.
  type PlaceholderRow = {
    external_id: string;
    tournament: string;
    match_day: number;
    phase: string;
    home_team: string;
    away_team: string;
    home_team_flag: null;
    away_team_flag: null;
    home_team_abbr: null;
    away_team_abbr: null;
    scheduled_at: string;
    venue: null;
    home_score: null;
    away_score: null;
    status: string;
    elapsed: null;
  };
  const toInsert: PlaceholderRow[] = [];
  for (const ph of struct.phases) {
    if (ph.slots === null) continue;
    const realCount = realCountByPhase.get(ph.phase) ?? 0;
    const existingSlots = existingSlotsByPhase.get(ph.phase) ?? new Set<number>();
    // Cuántos placeholders necesitamos para llenar el budget total
    // (ph.slots) descontando los reales que ya existen. Si hay tantos
    // o más reales como slots, no necesitamos placeholders en absoluto.
    const targetPlaceholders = Math.max(0, ph.slots - realCount);
    if (existingSlots.size >= targetPlaceholders) continue; // ya tenemos suficientes

    const scheduledAtStr = ph.estimatedDate
      ? new Date(ph.estimatedDate).toISOString()
      : "2099-12-31T00:00:00Z";
    for (let i = 1; i <= targetPlaceholders; i++) {
      if (existingSlots.has(i)) continue;
      toInsert.push({
        external_id: `placeholder:${tournamentSlug}:${ph.phase}:${i}`,
        tournament: tournamentSlug,
        match_day: i,
        phase: ph.phase,
        home_team: "TBD",
        away_team: "TBD",
        home_team_flag: null,
        away_team_flag: null,
        home_team_abbr: null,
        away_team_abbr: null,
        scheduled_at: scheduledAtStr,
        venue: null,
        home_score: null,
        away_score: null,
        status: "scheduled",
        elapsed: null,
      });
    }
  }

  if (toInsert.length === 0) return { created: 0 };

  // Bulk INSERT con conflict skip — si por race-condition alguien
  // creó el mismo external_id mientras tanto, no falla.
  const { error } = await supabase
    .from("matches")
    .insert(toInsert);
  if (error) {
    // Si el conflict por external_id se da fila a fila, solo loguea —
    // no es fatal porque significa que la fila ya existe.
    console.warn("[ensurePlaceholders] bulk insert warning:", error.message);
    return { created: 0 };
  }
  return { created: toInsert.length };
}

/**
 * Promueve un placeholder al matchup real cuando ESPN publica un
 * partido para la misma fase. Devuelve el match_id resultante (sea
 * promovido o nuevo). Si no hay placeholder libre, inserta un row
 * normal vía upsert_match_safe.
 *
 * "Libre" = home_team='TBD' (la promoción cambia esto a nombre real).
 * Asignamos por orden de match_day ascendente — el primer slot libre
 * recibe el primer match real publicado.
 */
async function promoteOrInsert(
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
): Promise<"promoted" | "inserted" | "error"> {
  // Buscar placeholder libre para esta fase.
  if (phase) {
    const { data: free } = await supabase
      .from("matches")
      .select("id, match_day")
      .eq("tournament", tournamentSlug)
      .eq("phase", phase)
      .eq("home_team", "TBD")
      .like("external_id", "placeholder:%")
      .order("match_day", { ascending: true })
      .limit(1);
    const placeholder = (free as Array<{ id: string; match_day: number | null }> | null)?.[0];
    if (placeholder) {
      // Promoción: UPDATE in-place del placeholder. UUID preservado,
      // predicciones mantienen su match_id. Conservamos match_day del
      // placeholder (slot index) — sirve como pista de orden.
      const { error } = await supabase
        .from("matches")
        .update({
          external_id: payload.external_id,
          home_team: payload.home_team,
          away_team: payload.away_team,
          home_team_flag: payload.home_team_flag,
          away_team_flag: payload.away_team_flag,
          home_team_abbr: payload.home_team_abbr,
          away_team_abbr: payload.away_team_abbr,
          scheduled_at: payload.scheduled_at,
          venue: payload.venue,
          status: payload.status,
          home_score: payload.home_score,
          away_score: payload.away_score,
          elapsed: payload.elapsed,
        })
        .eq("id", placeholder.id);
      return error ? "error" : "promoted";
    }
  }

  // Sin placeholder libre: insertar normalmente vía upsert seguro.
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
  return error ? "error" : "inserted";
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

  // Asegurar placeholder rows para fases de bracket conocidas (cuartos,
  // semis, final, etc.). Antes de insertar matches reales, así el
  // promote-or-insert tiene slots disponibles. Idempotente.
  const ph = await ensurePlaceholders(supabase, tournamentSlug);
  if (ph.created > 0) {
    result.warnings.push(`creados ${ph.created} placeholders`);
  }

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

      const status = mapEspnStatus(event.status) ?? "scheduled";
      const homeScore = parseEspnScore(home.score);
      const awayScore = parseEspnScore(away.score);
      const elapsed = parseEspnMinute(event.status.displayClock, event.status.period);
      const phase = mapEspnPhase(event, tournamentSlug);

      // Si la fase tiene placeholders sin promover (cuartos / semis /
      // final / etc), promovemos el primero disponible. Si ya están
      // todos promovidos o la fase no tiene slots conocidos, insertamos
      // como row normal. Predicciones quedan ligadas al UUID en ambos
      // casos.
      const promotion = await promoteOrInsert(supabase, tournamentSlug, phase, {
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

      if (promotion === "error") {
        console.error(`[discover] promoteOrInsert ${event.id} failed`);
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
