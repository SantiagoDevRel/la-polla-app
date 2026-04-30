// app/api/admin/discrepancies/route.ts
//
// GET → lista los matches con status='finished' que aún no tienen
// final_verified_at, junto con el snapshot actual de ESPN (re-fetched
// en vivo para que el admin vea las cifras más recientes, no las
// cacheadas en final_verification_notes).
//
// El admin layout (lib/auth/admin) ya gatea quién llega acá, pero
// re-chequeamos en cada handler como defensa en profundidad.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import {
  ESPN_LEAGUE_BY_TOURNAMENT,
  fetchEspnScoreboard,
  mapEspnStatus,
  parseEspnScore,
} from "@/lib/espn/client";

interface MatchRow {
  id: string;
  external_id: string | null;
  espn_id: string | null;
  tournament: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  scheduled_at: string;
  final_verification_notes: string | null;
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select(
      "id, external_id, espn_id, tournament, home_team, away_team, home_team_flag, away_team_flag, home_score, away_score, status, scheduled_at, final_verification_notes",
    )
    .eq("status", "finished")
    .is("final_verified_at", null)
    .order("scheduled_at", { ascending: false });

  if (error) {
    console.error("[admin/discrepancies] db query failed:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  const matches = (data ?? []) as MatchRow[];

  // Agrupamos por tournament para hacer 1 fetch ESPN por liga, no N.
  const byTournament = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const arr = byTournament.get(m.tournament) ?? [];
    arr.push(m);
    byTournament.set(m.tournament, arr);
  }

  const enriched: Array<
    MatchRow & {
      espn_status: string | null;
      espn_home: number | null;
      espn_away: number | null;
      alerted_at: string | null;
    }
  > = [];

  for (const [tournament, list] of Array.from(byTournament.entries())) {
    let events: Awaited<ReturnType<typeof fetchEspnScoreboard>> = [];
    if (ESPN_LEAGUE_BY_TOURNAMENT[tournament]) {
      try {
        events = await fetchEspnScoreboard(tournament);
      } catch (err) {
        console.warn("[admin/discrepancies] espn fetch failed:", err);
      }
    }

    for (const m of list) {
      let espnStatus: string | null = null;
      let espnHome: number | null = null;
      let espnAway: number | null = null;
      let event = m.espn_id ? events.find((e) => e.id === m.espn_id) : null;
      if (!event) {
        const kickMs = new Date(m.scheduled_at).getTime();
        event = events.find((e) => Math.abs(new Date(e.date).getTime() - kickMs) < 2 * 60 * 60 * 1000) ?? null;
      }
      if (event) {
        espnStatus = mapEspnStatus(event.status);
        const competition = event.competitions[0];
        const home = competition?.competitors.find((c) => c.homeAway === "home");
        const away = competition?.competitors.find((c) => c.homeAway === "away");
        espnHome = parseEspnScore(home?.score);
        espnAway = parseEspnScore(away?.score);
      }

      const alerted = (m.final_verification_notes ?? "").match(/ alerted=([^ ]+)/);
      enriched.push({
        ...m,
        espn_status: espnStatus,
        espn_home: espnHome,
        espn_away: espnAway,
        alerted_at: alerted ? alerted[1] : null,
      });
    }
  }

  return NextResponse.json({ matches: enriched });
}
