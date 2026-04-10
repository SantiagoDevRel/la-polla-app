// app/api/matches/sync/route.ts — Admin endpoint para sincronizar partidos desde API-Football
// Solo accesible con CRON_SECRET header para evitar llamadas no autorizadas
import { NextRequest, NextResponse } from "next/server";
import { syncLeague } from "@/lib/api-football/sync";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const validSecret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_CRON_SECRET;
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { leagueId, season } = body as { leagueId?: number; season?: number };

  if (!leagueId || !season) {
    return NextResponse.json(
      { error: "leagueId y season son requeridos" },
      { status: 400 }
    );
  }

  try {
    const result = await syncLeague(leagueId, season);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: "Error en sync" }, { status: 500 });
  }
}
