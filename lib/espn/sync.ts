// lib/espn/sync.ts — Aplica updates de ESPN a la tabla `matches` sin
// pisar a football-data.
//
// Reglas de oro:
//   * Nunca crea rows nuevos. football-data es el dueño de los
//     fixtures. Si ESPN tiene un evento que no está en nuestra DB,
//     logueamos warning y skipeamos.
//   * Solo actualiza status / scores / elapsed via la función
//     update_match_live_espn() — que también marca live_updated_at +
//     live_source y bloquea regresiones de score.
//   * Match strategy: primero por espn_id (fast path después del
//     primer encuentro). Si no hay, por (tournament + scheduled_at
//     ±2h + fuzzy team match). Cuando matchea, se persiste el
//     espn_id para que la próxima vez sea lookup directo.
//
// Llamado desde /api/matches/sync-live cuando el cron pega.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ESPN_LEAGUE_BY_TOURNAMENT,
  fetchEspnScoreboard,
  mapEspnStatus,
  parseEspnMinute,
  parseEspnScore,
  type ESPNEvent,
} from "./client";

const TOURNAMENTS = Object.keys(ESPN_LEAGUE_BY_TOURNAMENT);

// Ventana de tolerancia para matching por kickoff (2h en cada
// dirección). Cubre cambios de horario y zonas timezone misalignment.
const KICKOFF_TOLERANCE_MS = 2 * 60 * 60 * 1000;

interface DbMatch {
  id: string;
  external_id: string | null;
  espn_id: string | null;
  tournament: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
}

/**
 * Normaliza para comparar nombres de equipos entre fuentes.
 * "FC Bayern München" → "bayern munchen" (lower, sin "FC", sin
 * acentos, espacios colapsados).
 */
function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos
    .replace(/\b(fc|cf|club|atlético|atletico|de|the|saint)\b/g, " ") // quita ruido común
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mide overlap por substring bidireccional. 1 = igual, 0 = nada. */
function teamSimilarity(a: string, b: string): number {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Tokenize y contar tokens compartidos.
  const ta = new Set(na.split(" ").filter((t) => t.length > 2));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) {
    return na.includes(nb) || nb.includes(na) ? 0.7 : 0;
  }
  let shared = 0;
  ta.forEach((t) => {
    if (tb.has(t)) shared++;
  });
  return shared / Math.min(ta.size, tb.size);
}

/**
 * Encuentra el row de DB que mejor matchea con un evento ESPN.
 * Devuelve null si no hay match razonable (>= 0.5 de similarity en
 * AMBOS equipos y kickoff dentro de la ventana).
 */
function findMatchingDbRow(event: ESPNEvent, candidates: DbMatch[]): DbMatch | null {
  const eventMs = new Date(event.date).getTime();
  if (!Number.isFinite(eventMs)) return null;
  const competition = event.competitions[0];
  if (!competition) return null;
  const home = competition.competitors.find((c) => c.homeAway === "home");
  const away = competition.competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  let best: { row: DbMatch; score: number } | null = null;
  for (const row of candidates) {
    const rowMs = new Date(row.scheduled_at).getTime();
    if (Math.abs(rowMs - eventMs) > KICKOFF_TOLERANCE_MS) continue;
    const homeScore = teamSimilarity(home.team.displayName, row.home_team);
    const awayScore = teamSimilarity(away.team.displayName, row.away_team);
    if (homeScore < 0.5 || awayScore < 0.5) continue;
    const total = homeScore + awayScore;
    if (!best || total > best.score) {
      best = { row, score: total };
    }
  }
  return best?.row ?? null;
}

export interface EspnSyncResult {
  tournament: string;
  events_fetched: number;
  matched: number;
  updated: number;
  unmatched: number;
  errors: number;
  /** Reasons para los unmatched, útil para detectar mapeos rotos. */
  unmatched_samples: string[];
}

export async function syncEspnLive(): Promise<EspnSyncResult[]> {
  const supabase = createAdminClient();
  const results: EspnSyncResult[] = [];

  for (const tournament of TOURNAMENTS) {
    const result: EspnSyncResult = {
      tournament,
      events_fetched: 0,
      matched: 0,
      updated: 0,
      unmatched: 0,
      errors: 0,
      unmatched_samples: [],
    };

    // 1. Pedir el scoreboard a ESPN.
    let events: ESPNEvent[] = [];
    try {
      events = await fetchEspnScoreboard(tournament);
    } catch (err) {
      console.error(`[espn-sync] fetch failed for ${tournament}:`, err);
      result.errors++;
      results.push(result);
      continue;
    }
    result.events_fetched = events.length;
    if (events.length === 0) {
      results.push(result);
      continue;
    }

    // 2. Cargar candidatos de DB que estén dentro de la ventana de
    //    tiempo de los eventos. No traemos todos los matches del
    //    torneo — solo los que pueden potencialmente matchear.
    const minMs = Math.min(...events.map((e) => new Date(e.date).getTime()));
    const maxMs = Math.max(...events.map((e) => new Date(e.date).getTime()));
    const fromIso = new Date(minMs - KICKOFF_TOLERANCE_MS).toISOString();
    const toIso = new Date(maxMs + KICKOFF_TOLERANCE_MS).toISOString();

    const { data: candidates, error: queryErr } = await supabase
      .from("matches")
      .select("id, external_id, espn_id, tournament, home_team, away_team, scheduled_at")
      .eq("tournament", tournament)
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso);

    if (queryErr) {
      console.error(`[espn-sync] db query failed for ${tournament}:`, queryErr.message);
      result.errors++;
      results.push(result);
      continue;
    }
    const candidateRows = (candidates || []) as DbMatch[];

    // 3. Iterar eventos y aplicar updates.
    for (const event of events) {
      let row: DbMatch | null = null;
      // Fast path: si ya tenemos espn_id guardado, lookup directo.
      const direct = candidateRows.find((r) => r.espn_id && r.espn_id === event.id);
      if (direct) {
        row = direct;
      } else {
        row = findMatchingDbRow(event, candidateRows);
      }
      if (!row) {
        result.unmatched++;
        if (result.unmatched_samples.length < 3) {
          result.unmatched_samples.push(
            `${event.name} @ ${event.date} (espn_id=${event.id})`,
          );
        }
        continue;
      }
      result.matched++;

      // 4. Mapear status + scores + minute.
      const newStatus = mapEspnStatus(event.status);
      if (newStatus === null) continue; // estado desconocido — no tocar
      const competition = event.competitions[0];
      const home = competition.competitors.find((c) => c.homeAway === "home");
      const away = competition.competitors.find((c) => c.homeAway === "away");
      const newHome = parseEspnScore(home?.score);
      const newAway = parseEspnScore(away?.score);
      const newElapsed = parseEspnMinute(event.status.displayClock, event.status.period);

      // 5. Aplicar update via la función segura (que bloquea regresión
      //    de scores y marca live_updated_at + live_source).
      const { error: rpcErr } = await supabase.rpc("update_match_live_espn", {
        p_match_id: row.id,
        p_espn_id: event.id,
        p_status: newStatus,
        p_home_score: newHome,
        p_away_score: newAway,
        p_elapsed: newElapsed,
        p_status_detail: event.status.type.name,
      });
      if (rpcErr) {
        console.error(`[espn-sync] rpc update failed for ${row.id}:`, rpcErr.message);
        result.errors++;
        continue;
      }
      result.updated++;
    }

    results.push(result);
  }

  return results;
}
