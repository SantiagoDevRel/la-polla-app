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

// Ventana por defecto: los proximos 10 dias. Alcanza para armar el fin de
// semana sin traerse la temporada entera.
const DEFAULT_DIAS = 10;
// (2026-09-13) El admin ahora arma pollas con el calendario completo de
// API-Football: una liga que termina en diciembre tiene que verse hasta
// diciembre. 240 dias cubren el resto de cualquier temporada activa.
const MAX_DIAS = 240;
// Una liga de 20 equipos son 380 partidos por temporada; 1000 cubre la
// temporada restante de cualquier torneo habilitado y coincide con el tope
// de filas por request de PostgREST. Si se llega al tope se avisa.
const ROW_LIMIT = 1000;

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403 });
  }

  const tournament = req.nextUrl.searchParams.get("tournament");
  if (!tournament || !isCreatableTournament(tournament)) {
    return NextResponse.json({ error: "Torneo inválido." }, { status: 400 });
  }

  // `todo=1` = todos los partidos futuros guardados del torneo. Si no, `dias`
  // acotado a 1..240. Un valor que no es numero cae al default: antes un
  // `dias=abc` daba NaN y reventaba el toISOString.
  const todo = req.nextUrl.searchParams.get("todo") === "1";
  const rawDias = Number(req.nextUrl.searchParams.get("dias") ?? DEFAULT_DIAS);
  const dias = todo
    ? null
    : Math.min(MAX_DIAS, Math.max(1, Number.isFinite(rawDias) ? Math.floor(rawDias) : DEFAULT_DIAS));
  const hasta = dias === null ? null : new Date(Date.now() + dias * 86_400_000).toISOString();

  const scheduleRefreshed = await refreshTournamentSchedule(tournament);
  const db = createAdminClient();
  let query = db
    .from("matches")
    .select(
      "id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, scheduled_at_confirmed, match_day",
    )
    .eq("tournament", tournament)
    .gt("scheduled_at", new Date().toISOString());
  if (hasta) query = query.lt("scheduled_at", hasta);
  const { data, error } = await query
    .order("scheduled_at", { ascending: true })
    .limit(ROW_LIMIT);

  if (error) {
    console.error("[casa/admin/matches]", error.message);
    return NextResponse.json({ error: "No pude leer los partidos." }, { status: 500 });
  }

  // Lista vacía no significa que falten datos: Champions, por ejemplo, no
  // juega entre jornadas (13-sep-2026: la siguiente era el 13-oct). Se
  // devuelve el próximo partido guardado para que el form lo diga en vez de
  // sugerir que el torneo está fuera de temporada. Con `todo` no hay nada
  // despues de la ventana: vacío es vacío.
  let nextMatch: { scheduled_at: string; scheduled_at_confirmed: boolean } | null = null;
  if ((data ?? []).length === 0 && hasta) {
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

  const matches = data ?? [];
  return NextResponse.json(
    { matches, scheduleRefreshed, dias, todo, nextMatch, truncated: matches.length >= ROW_LIMIT },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
