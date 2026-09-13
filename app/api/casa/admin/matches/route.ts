// app/api/casa/admin/matches/route.ts — los partidos que Tama puede meter
// en una polla: lo que viene, por torneo.
//
// Solo lectura y solo admin. Devuelve el minimo para pintar la lista de
// selección (nada de columnas de mas: regla de `select` explicito del repo).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { isCreatableTournament } from "@/lib/tournaments";
import { refreshTournamentSchedule } from "@/lib/matches/refresh-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403 });
  }

  const tournament = req.nextUrl.searchParams.get("tournament");
  if (!tournament || !isCreatableTournament(tournament)) {
    return NextResponse.json({ error: "Torneo inválido." }, { status: 400 });
  }

  // Ventana por defecto: los proximos 10 dias. Alcanza para armar el fin de
  // semana sin traerse la temporada entera (380 partidos por liga).
  const dias = Math.min(
    30,
    Math.max(1, Number(req.nextUrl.searchParams.get("dias") ?? 10)),
  );
  const hasta = new Date(Date.now() + dias * 86_400_000).toISOString();

  const scheduleRefreshed = await refreshTournamentSchedule(tournament);
  const db = createAdminClient();
  const { data, error } = await db
    .from("matches")
    .select(
      "id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, scheduled_at_confirmed, match_day",
    )
    .eq("tournament", tournament)
    .gt("scheduled_at", new Date().toISOString())
    .lt("scheduled_at", hasta)
    .order("scheduled_at", { ascending: true })
    .limit(120);

  if (error) {
    console.error("[casa/admin/matches]", error.message);
    return NextResponse.json({ error: "No pude leer los partidos." }, { status: 500 });
  }

  // Lista vacía no significa que falten datos: Champions, por ejemplo, no
  // juega entre jornadas (13-sep-2026: la siguiente era el 13-oct). Se
  // devuelve el próximo partido guardado para que el form lo diga en vez de
  // sugerir que el torneo está fuera de temporada.
  let nextMatch: { scheduled_at: string; scheduled_at_confirmed: boolean } | null = null;
  if ((data ?? []).length === 0) {
    const { data: next } = await db
      .from("matches")
      .select("scheduled_at, scheduled_at_confirmed")
      .eq("tournament", tournament)
      .eq("status", "scheduled")
      .gte("scheduled_at", hasta)
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    nextMatch = next ?? null;
  }

  return NextResponse.json({ matches: data ?? [], scheduleRefreshed, dias, nextMatch }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
