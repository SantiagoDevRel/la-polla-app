// app/api/teams/roster/route.ts — GET plantel de un equipo (ESPN).
// Auth-gated. Resuelve el ESPN team id desde el nombre de DB y devuelve
// el plantel agrupable por línea. Si el equipo no existe en ESPN (clubes
// de torneos sin /teams, nombres que no matchean), devuelve players vacío
// — el cliente muestra empty state, nunca rompe.
//
// Cero data en nuestra DB: todo sale de ESPN (público, sin API key).
// Cacheado 1h en el browser (el plantel cambia poco).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveEspnTeamId, fetchEspnTeamRoster } from "@/lib/espn/teams";

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

    const espnId = await resolveEspnTeamId(tournament, team);
    if (!espnId) {
      return NextResponse.json(
        { players: [] },
        { headers: { "Cache-Control": "private, max-age=3600" } },
      );
    }

    const players = await fetchEspnTeamRoster(tournament, espnId);
    return NextResponse.json(
      { players },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (err) {
    console.error("[teams/roster] unexpected:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
