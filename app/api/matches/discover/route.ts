// app/api/matches/discover/route.ts — Endpoint que refresca el calendario de
// los torneos desde API-Football, la única fuente de partidos (2026-09-13).
//
// Llamado por:
//   1. pg_cron auto-discover (cada 6h, trigger_discover_tournaments).
//   2. Manualmente con CRON_SECRET para refrescar un torneo puntual.
//
// Uso manual (terminal):
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     "https://lapollacolombiana.com/api/matches/discover?tournament=betplay_2026"
//
// Sin tournament: recorre las ligas en serie, de la última intentada a la más
// reciente, con un presupuesto de ~35 s (temporada completa por liga). Con
// ?tournament pasa por la misma reserva de 15 minutos de
// refreshTournamentScheduleDetailed. Toda escritura va por upsert_match_safe
// dentro de lib/api-football/calendar.ts (Regla #1).
//
// Auth: CRON_SECRET solo. Aceptado via header `x-cron-secret` o
// `Authorization: Bearer …`. La opción ?secret=… fue removida porque
// querystrings quedan persistidas en logs/CDN/Referer.

import { NextRequest, NextResponse } from "next/server";
import { refreshAfSchedules, refreshTournamentScheduleDetailed } from "@/lib/matches/refresh-schedule";
import { afLeagueIdForTournament } from "@/lib/api-football/season";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function checkSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return bearer === `Bearer ${secret}` || header === secret;
}

async function runDiscover(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("tournament");
  if (explicit) {
    if (!afLeagueIdForTournament(explicit)) {
      throw new Error(`Sin liga de API-Football para tournament=${explicit}`);
    }
    return { ok: true, skipped: false, results: [await refreshTournamentScheduleDetailed(explicit)] };
  }
  return { ok: true, skipped: false, results: await refreshAfSchedules() };
}

export async function GET(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runDiscover(request));
  } catch (err) {
    console.error("[discover] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runDiscover(request));
  } catch (err) {
    console.error("[discover] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
