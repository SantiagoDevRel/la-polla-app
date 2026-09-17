// lib/casa/live.ts — los partidos que se están jugando en las pollas donde la
// persona participa, con su pronóstico al lado.
//
// (2026-09-16) Pedido del dueño: verlos ARRIBA en POLLAS para ir comparando
// «tu marcador» con el parcial, sin abrir cada polla. El vivo lo escribe el
// cron de API-Football cada minuto en `matches`; acá solo se lee.
//
// Todo pasa por el cliente administrativo (ver el TODO de auth.uid() en
// CLAUDE.md), así que el filtro por user_id es explícito y obligatorio.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLiveEntry, type CasaLiveMatch, type CasaScoringMode, type Pick1x2 } from "./types";

/** Un partido terminado sigue arriba hasta 4 h después del saque (≈2 h tras el pitazo). */
const FINISHED_WINDOW_MS = 4 * 60 * 60_000;

interface EntryRow { id: string; polla_id: string; entry_number: number | null; status: "pendiente" | "pagada" | "rechazada" | "anulada"; proof_path: string | null }
interface PollaRow { id: string; slug: string; name: string; scoring_mode: CasaScoringMode | null; status: string }
interface MatchRow {
  id: string; home_team: string; away_team: string; home_team_flag: string | null; away_team_flag: string | null;
  scheduled_at: string; home_score: number | null; away_score: number | null; status: string; elapsed: number | null;
  live_status_detail: string | null; final_verified_at: string | null;
}
interface PickRow { entry_id: string; match_id: string | null; pick_1x2: Pick1x2 | null; home_score: number | null; away_score: number | null }

export async function listMyLiveMatches(userId: string, now = Date.now()): Promise<CasaLiveMatch[]> {
  if (!userId) throw new Error("Authenticated user required");
  const db = createAdminClient();

  const { data: entryRows, error: entriesError } = await db
    .from("casa_entries")
    .select("id, polla_id, entry_number, status, proof_path")
    .eq("user_id", userId) // ← filtro explícito obligatorio
    .in("status", ["pagada", "pendiente"])
    .is("ticket_number", null)
    .limit(500);
  if (entriesError) throw entriesError;
  const entries = ((entryRows ?? []) as EntryRow[]).filter(isLiveEntry);
  if (entries.length === 0) return [];

  const pollaIds = [...new Set(entries.map((e) => e.polla_id))];
  const { data: pollaRows, error: pollasError } = await db
    .from("casa_pollas")
    .select("id, slug, name, scoring_mode, status")
    .in("id", pollaIds)
    .eq("kind", "partidos")
    .in("status", ["abierta", "cerrada"])
    .is("archived_at", null)
    .neq("publication_mode", "oculta")
    .lte("opens_at", new Date(now).toISOString());
  if (pollasError) throw pollasError;
  const pollas = (pollaRows ?? []) as PollaRow[];
  if (pollas.length === 0) return [];

  const { data: linkRows, error: linksError } = await db
    .from("casa_polla_matches")
    .select("polla_id, match_id")
    .in("polla_id", pollas.map((p) => p.id))
    .is("voided_at", null);
  if (linksError) throw linksError;
  const links = (linkRows ?? []) as Array<{ polla_id: string; match_id: string }>;
  const matchIds = [...new Set(links.map((l) => l.match_id))];
  if (matchIds.length === 0) return [];

  const { data: matchRows, error: matchesError } = await db
    .from("matches")
    .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, home_score, away_score, status, elapsed, live_status_detail, final_verified_at")
    .in("id", matchIds)
    .in("status", ["live", "finished"])
    .gte("scheduled_at", new Date(now - FINISHED_WINDOW_MS).toISOString());
  if (matchesError) throw matchesError;
  const matches = ((matchRows ?? []) as MatchRow[]).filter((m) => m.status === "live" || m.status === "finished");
  if (matches.length === 0) return [];

  const entryIds = entries.map((e) => e.id);
  const { data: pickRows, error: picksError } = await db
    .from("casa_picks")
    .select("entry_id, match_id, pick_1x2, home_score, away_score")
    .eq("user_id", userId) // ← filtro explícito obligatorio
    .in("entry_id", entryIds)
    .in("match_id", matches.map((m) => m.id));
  if (picksError) throw picksError;
  const picks = (pickRows ?? []) as PickRow[];

  const entryById = new Map(entries.map((e) => [e.id, e]));
  const byMatch = new Map(matches.map((m) => [m.id, m]));
  const rows: CasaLiveMatch[] = [];
  for (const polla of pollas) {
    for (const link of links.filter((l) => l.polla_id === polla.id)) {
      const match = byMatch.get(link.match_id);
      if (!match) continue;
      const myPicks = picks
        .filter((p) => p.match_id === match.id && entryById.get(p.entry_id)?.polla_id === polla.id)
        .map((p) => ({
          entryNumber: entryById.get(p.entry_id)?.entry_number ?? null,
          pick1x2: p.pick_1x2, homeScore: p.home_score, awayScore: p.away_score,
        }))
        .sort((a, b) => (a.entryNumber ?? 0) - (b.entryNumber ?? 0));
      rows.push({
        matchId: match.id, pollaId: polla.id, pollaSlug: polla.slug, pollaName: polla.name,
        scoringMode: polla.scoring_mode ?? "1x2",
        homeTeam: match.home_team, awayTeam: match.away_team, homeFlag: match.home_team_flag, awayFlag: match.away_team_flag,
        homeScore: match.home_score, awayScore: match.away_score,
        status: match.status === "live" ? "live" : "finished",
        elapsed: match.elapsed, liveStatusDetail: match.live_status_detail,
        scheduledAt: match.scheduled_at, finalVerifiedAt: match.final_verified_at,
        picks: myPicks,
      });
    }
  }
  // En juego primero (por hora de saque), después los recién terminados.
  return rows.sort((a, b) =>
    (a.status === b.status ? 0 : a.status === "live" ? -1 : 1)
    || a.scheduledAt.localeCompare(b.scheduledAt)
    || a.pollaName.localeCompare(b.pollaName));
}
