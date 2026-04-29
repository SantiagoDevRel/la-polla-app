// app/api/matches/route.ts — GET matches with tournament + status + date filters
// Uses admin client to bypass RLS
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ESPN_LEAGUE_BY_TOURNAMENT } from "@/lib/espn/client";
import { discoverTournament, ensurePlaceholders } from "@/lib/espn/discover";
import { TOURNAMENT_STRUCTURE } from "@/lib/tournaments/structure";

const DISCOVER_TTL_MS = 30 * 60 * 1000; // re-discover max cada 30 min por torneo

async function maybeAutoDiscover(tournament: string): Promise<void> {
  // Solo si el torneo está mapeado a ESPN.
  if (!ESPN_LEAGUE_BY_TOURNAMENT[tournament]) return;

  const admin = createAdminClient();

  // Throttle via app_config (tabla creada por migración 028).
  const key = `discover_${tournament}_at`;
  const { data: row } = await admin
    .from("app_config")
    .select("value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (row && new Date(row.updated_at).getTime() > Date.now() - DISCOVER_TTL_MS) {
    return; // discover reciente, no re-disparar
  }

  // Disparar discover. Best-effort — si falla, /api/matches sigue
  // devolviendo lo que tenga la DB.
  try {
    await discoverTournament(tournament);
    await admin
      .from("app_config")
      .upsert({ key, value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch (err) {
    console.warn(`[matches] auto-discover ${tournament} failed:`, err);
  }
}

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

    const runQuery = async () => {
      let query = admin
        .from("matches")
        .select("id, external_id, tournament, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status, home_score, away_score, match_day, phase, venue")
        .order("scheduled_at", { ascending: true });
      if (tournament) query = query.eq("tournament", tournament);
      if (status && status !== "all") query = query.eq("status", status);
      if (dateFrom) query = query.gte("scheduled_at", dateFrom);
      if (dateTo) query = query.lte("scheduled_at", dateTo);
      return query;
    };

    // Asegurar placeholders ANTES de la primera query — así el picker
    // de crear-polla muestra los slots de cuartos/semis/final aunque
    // ESPN aún no haya publicado los matchups. NO hace requests
    // externos, solo SQL en nuestra DB. Idempotente.
    if (tournament && TOURNAMENT_STRUCTURE[tournament]) {
      await ensurePlaceholders(admin, tournament).catch((err) => {
        console.warn("[matches] ensurePlaceholders failed:", err);
      });
    }

    const initial = await runQuery();
    if (initial.error) {
      console.error("Error consultando partidos:", initial.error.message);
      return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
    }
    let matches = initial.data;

    // Auto-discover: si el torneo está mapeado a ESPN y la query
    // devolvió vacío (ni placeholders ni fixtures reales), intentamos
    // poblar fixtures vía discoverTournament. Throttled internamente.
    if (tournament && (matches?.length ?? 0) === 0) {
      await maybeAutoDiscover(tournament);
      const retry = await runQuery();
      if (!retry.error) matches = retry.data;
    }

    return NextResponse.json({ matches: matches || [] });
  } catch (error) {
    console.error("Error obteniendo partidos:", error);
    return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
  }
}
