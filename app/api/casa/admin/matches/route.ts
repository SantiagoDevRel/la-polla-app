// app/api/casa/admin/matches/route.ts — los partidos que Tama puede meter
// en una polla: lo que viene, por torneo.
//
// Solo lectura y solo admin. Devuelve el minimo para pintar la lista de
// selección (nada de columnas de mas: regla de `select` explicito del repo).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { isCreatableTournament } from "@/lib/tournaments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const db = createAdminClient();
  const { data, error } = await db
    .from("matches")
    .select(
      "id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, match_day",
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

  return NextResponse.json({ matches: data ?? [] });
}
