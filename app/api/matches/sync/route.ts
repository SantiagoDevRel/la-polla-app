// app/api/matches/sync/route.ts — Endpoint para sincronizar partidos desde football-data.org
// GET: sync all competitions (requires cron secret in query param or header)
// POST: sync specific competition
import { NextRequest, NextResponse } from "next/server";
import { syncCompetition, syncAllCompetitions, COMPETITIONS } from "@/lib/football-data/sync";

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret") || request.headers.get("x-cron-secret");
  const validSecret = process.env.CRON_SECRET;
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const results = await syncAllCompetitions();
    return NextResponse.json({ results, competitions: COMPETITIONS.map((c) => c.label) });
  } catch (error) {
    console.error("[sync GET] Error:", error);
    return NextResponse.json({ error: "Error en sync" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const validSecret = process.env.CRON_SECRET;
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { competitionId, tournament, status } = body as {
    competitionId?: number;
    tournament?: string;
    status?: string;
    // Legacy fields (ignored now)
    leagueId?: number;
    season?: number;
  };

  // If competitionId provided, sync that specific competition
  if (competitionId && tournament) {
    try {
      const result = await syncCompetition(competitionId, tournament, status);
      return NextResponse.json(result);
    } catch (error) {
      console.error("[sync route] Error:", error);
      return NextResponse.json({ error: "Error en sync" }, { status: 500 });
    }
  }

  // Fallback: try to find competition by legacy leagueId
  const legacyLeagueId = body.leagueId;
  if (legacyLeagueId) {
    // Map legacy API-Football IDs to football-data.org
    const legacyMap: Record<number, { id: number; tournament: string }> = {
      2: { id: 2001, tournament: "champions_2025" },   // UCL
      1: { id: 2000, tournament: "worldcup_2026" },     // World Cup (FIFA ID in football-data)
    };
    const mapped = legacyMap[legacyLeagueId];
    if (mapped) {
      try {
        const result = await syncCompetition(mapped.id, mapped.tournament, status);
        return NextResponse.json(result);
      } catch (error) {
        console.error("[sync route] Error:", error);
        return NextResponse.json({ error: "Error en sync" }, { status: 500 });
      }
    }
  }

  return NextResponse.json(
    { error: "competitionId y tournament son requeridos", availableCompetitions: COMPETITIONS },
    { status: 400 }
  );
}
