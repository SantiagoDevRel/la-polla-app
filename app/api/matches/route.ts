// app/api/matches/route.ts — GET matches with tournament + status + date filters
// Uses admin client to bypass RLS
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTournamentSchedule } from "@/lib/matches/refresh-schedule";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const tournament = searchParams.get("tournament");
    const status = searchParams.get("status");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    if (tournament) await refreshTournamentSchedule(tournament);

    const admin = createAdminClient();

    const runQuery = async () => {
      let query = admin
        .from("matches")
        .select("id, external_id, tournament, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, scheduled_at_confirmed, status, home_score, away_score, match_day, phase, venue")
        .order("scheduled_at", { ascending: true });
      if (tournament) query = query.eq("tournament", tournament);
      if (status && status !== "all") query = query.eq("status", status);
      if (dateFrom) query = query.gte("scheduled_at", dateFrom);
      if (dateTo) query = query.lte("scheduled_at", dateTo);
      return query;
    };

    // Antes hacíamos ensurePlaceholders acá para crear filas TBD vs TBD
    // por cada slot de bracket. Eliminado 2026-05-08 — generaba TBDs
    // stale en /pollas/crear cuando ESPN tardaba en publicar matchups.
    // La UI ahora deriva las fases pendientes de TOURNAMENT_STRUCTURE
    // sin tocar la DB.

    const initial = await runQuery();
    if (initial.error) {
      console.error("Error consultando partidos:", initial.error.message);
      return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
    }
    return NextResponse.json({ matches: initial.data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Error obteniendo partidos:", error);
    return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
  }
}
