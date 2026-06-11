// app/api/teams/info/route.ts — GET ficha de un equipo dentro de un torneo.
// Devuelve forma (partidos jugados), próximos partidos, agregados de goles
// y la mini-tabla de su grupo (inferida de los fixtures de group_stage:
// los 4 equipos de un grupo solo juegan entre sí, así que el grupo es el
// componente conexo del equipo — cero data estática, cero APIs externas).
//
// Toda la data sale de nuestra tabla `matches` (1 query). Los facts
// estáticos (ranking FIFA, historia) NO viajan por acá — el cliente los
// importa directo de lib/teams/worldcup-facts.ts.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Columnas que el sheet necesita — subset de MATCH_COLUMNS, sin
// external_id/notified_closing/etc. que el cliente no usa.
const TEAM_INFO_MATCH_COLUMNS =
  "id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, venue, home_score, away_score, status, phase, match_day" as const;

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  phase: string | null;
  match_day: number | null;
}

interface StandingRow {
  team: string;
  flag: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  points: number;
}

function emptyStanding(team: string, flag: string | null): StandingRow {
  return { team, flag, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const tournament = params.get("tournament");
    const team = params.get("team");
    if (!tournament || !team) {
      return NextResponse.json({ error: "tournament y team requeridos" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("matches")
      .select(TEAM_INFO_MATCH_COLUMNS)
      .eq("tournament", tournament)
      .order("scheduled_at", { ascending: true })
      .returns<MatchRow[]>();

    if (error) {
      console.error("[teams/info] query failed:", error.message);
      return NextResponse.json({ error: "Error consultando partidos" }, { status: 500 });
    }

    const all = data ?? [];
    const involves = (m: MatchRow) => m.home_team === team || m.away_team === team;
    const teamMatches = all.filter(involves);

    if (teamMatches.length === 0) {
      return NextResponse.json({ error: "Equipo no encontrado en el torneo" }, { status: 404 });
    }

    // Buckets. "finished" usa el score que muestra el resto de la UI
    // (home_score/away_score). cancelled se omite de forma y próximos.
    const played = teamMatches
      .filter((m) => m.status === "finished")
      .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
    const live = teamMatches.filter((m) => m.status === "live");
    const upcoming = teamMatches
      .filter((m) => m.status === "scheduled")
      .slice(0, 5);

    // Agregados desde la perspectiva del equipo.
    let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cleanSheets = 0;
    for (const m of played) {
      const isHome = m.home_team === team;
      const scored = (isHome ? m.home_score : m.away_score) ?? 0;
      const conceded = (isHome ? m.away_score : m.home_score) ?? 0;
      gf += scored;
      ga += conceded;
      if (conceded === 0) cleanSheets += 1;
      if (scored > conceded) wins += 1;
      else if (scored === conceded) draws += 1;
      else losses += 1;
    }

    // Mini-tabla del grupo: rivales directos en group_stage = su grupo.
    let group: StandingRow[] | null = null;
    const groupFixtures = all.filter((m) => m.phase === "group_stage");
    const rivals = new Set<string>();
    for (const m of groupFixtures) {
      if (m.home_team === team) rivals.add(m.away_team);
      if (m.away_team === team) rivals.add(m.home_team);
    }
    if (rivals.size > 0) {
      const members = new Set<string>([team].concat(Array.from(rivals)));
      const table = new Map<string, StandingRow>();
      const flagOf = (name: string): string | null => {
        for (const m of groupFixtures) {
          if (m.home_team === name) return m.home_team_flag;
          if (m.away_team === name) return m.away_team_flag;
        }
        return null;
      };
      members.forEach((name) => table.set(name, emptyStanding(name, flagOf(name))));
      for (const m of groupFixtures) {
        if (!members.has(m.home_team) || !members.has(m.away_team)) continue;
        if (m.status !== "finished" || m.home_score === null || m.away_score === null) continue;
        const home = table.get(m.home_team)!;
        const away = table.get(m.away_team)!;
        home.played += 1; away.played += 1;
        home.gf += m.home_score; home.ga += m.away_score;
        away.gf += m.away_score; away.ga += m.home_score;
        if (m.home_score > m.away_score) { home.wins += 1; home.points += 3; away.losses += 1; }
        else if (m.home_score < m.away_score) { away.wins += 1; away.points += 3; home.losses += 1; }
        else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }
      }
      group = Array.from(table.values()).sort((a, b) =>
        b.points - a.points ||
        (b.gf - b.ga) - (a.gf - a.ga) ||
        b.gf - a.gf ||
        a.team.localeCompare(b.team),
      );
    }

    const flag =
      teamMatches.find((m) => m.home_team === team)?.home_team_flag ??
      teamMatches.find((m) => m.away_team === team)?.away_team_flag ??
      null;

    return NextResponse.json(
      {
        team,
        flag,
        played,
        live,
        upcoming,
        stats: { wins, draws, losses, gf, ga, cleanSheets },
        group,
      },
      // El fixture cambia poco — el browser puede reusar 60s y evitar
      // re-hits si el user abre/cierra el sheet repetido.
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (err) {
    console.error("[teams/info] unexpected:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
