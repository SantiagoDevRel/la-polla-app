// app/api/matches/route.ts — GET matches with tournament + status + date filters
// Uses admin client to bypass RLS
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const tournament = searchParams.get("tournament");
    const status = searchParams.get("status");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const admin = createAdminClient();

    let query = admin
      .from("matches")
      .select("id, external_id, tournament, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status, home_score, away_score, match_day, phase, venue")
      .order("scheduled_at", { ascending: true });

    if (tournament) {
      query = query.eq("tournament", tournament);
    }
    if (status && status !== "all") {
      query = query.eq("status", status);
    }
    if (dateFrom) {
      query = query.gte("scheduled_at", dateFrom);
    }
    if (dateTo) {
      query = query.lte("scheduled_at", dateTo);
    }

    const { data: matches, error } = await query;

    if (error) {
      console.error("Error consultando partidos:", error.message);
      return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
    }

    return NextResponse.json({ matches: matches || [] });
  } catch (error) {
    console.error("Error obteniendo partidos:", error);
    return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
  }
}
