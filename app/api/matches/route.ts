// app/api/matches/route.ts — GET matches with tournament + status + date filters
// Uses admin client to bypass RLS
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ESPN_LEAGUE_BY_TOURNAMENT } from "@/lib/espn/client";
import { discoverTournament } from "@/lib/espn/discover";
import { isSyncableTournament } from "@/lib/tournaments";

const DISCOVER_TTL_MS = 30 * 60 * 1000; // re-discover max cada 30 min por torneo

async function maybeAutoDiscover(tournament: string): Promise<void> {
  // Solo si el torneo está mapeado a ESPN y es "syncable" (post-Mundial:
  // solo worldcup_2026). Evita disparar discover de ligas sin pollas activas.
  if (!ESPN_LEAGUE_BY_TOURNAMENT[tournament] || !isSyncableTournament(tournament)) return;

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
