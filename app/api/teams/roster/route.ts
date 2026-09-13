// app/api/teams/roster/route.ts — GET plantel de un equipo para la ficha
// (components/match/TeamInfoSheet.tsx, pestaña Plantel).
//
// Auth antes de tocar cualquier dato. Dos fuentes, ninguna de ESPN:
// - Mundial 2026: plantel horneado (lib/teams/baked-squads.ts), instantáneo.
// - Clubes de los torneos activos: API-Football (lib/teams/roster.ts), con la
//   reserva de cuota y la caché compartida de lib/api-football/teams.ts.
// Sin dato confiable responde players vacío: el cliente muestra el estado
// vacío, nunca un plantel equivocado.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBakedWorldCupRoster } from "@/lib/teams/baked-squads";
import { loadApiFootballRoster } from "@/lib/teams/roster";

const TOURNAMENT = /^[a-z0-9_]{1,40}$/;
const MAX_TEAM_LENGTH = 120;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const tournament = params.get("tournament");
    const team = params.get("team")?.trim();
    if (!tournament || !team || !TOURNAMENT.test(tournament) || team.length > MAX_TEAM_LENGTH) {
      return NextResponse.json({ error: "tournament y team requeridos" }, { status: 400 });
    }

    // Mundial 2026: los planteles no cambian después de la Copa; si alguno
    // hubiera que corregirlo, se re-hornea el JSON. Un equipo sin hornear
    // (slot de repechaje) no tiene otra fuente: plantel vacío.
    if (tournament === "worldcup_2026") {
      const baked = getBakedWorldCupRoster(team);
      return NextResponse.json(
        { players: baked ?? [] },
        { headers: { "Cache-Control": baked ? "private, max-age=604800" : "private, no-store" } },
      );
    }

    const players = await loadApiFootballRoster(tournament, team);
    return NextResponse.json(
      { players },
      // Un vacío puede ser momentáneo (sin reserva ni fixture reciente): no se cachea.
      { headers: { "Cache-Control": players.length > 0 ? "private, max-age=3600" : "private, no-store" } },
    );
  } catch (err) {
    console.error("[teams/roster] unexpected:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
