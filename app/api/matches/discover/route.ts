// app/api/matches/discover/route.ts — Endpoint para descubrir fixtures
// nuevos de un torneo via ESPN.
//
// Llamado por:
//   1. pg_cron auto-discover (cada 6h) para tournaments con pollas
//      activas scope != custom.
//   2. Manualmente con CRON_SECRET para seedear fixtures de un torneo
//      nuevo (ej. la primera vez que se agrega Liga BetPlay).
//
// Uso manual (terminal):
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     "https://lapollacolombiana.com/api/matches/discover?tournament=betplay_2026"
//
// Sin tournament param: itera sobre todos los tournaments con polla
// activa scope != custom (mismo gate que el cron).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverTournament } from "@/lib/espn/discover";
import { ESPN_LEAGUE_BY_TOURNAMENT } from "@/lib/espn/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function checkSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  const query = request.nextUrl.searchParams.get("secret") ?? "";
  return bearer === `Bearer ${secret}` || header === secret || query === secret;
}

async function tournamentsToDiscover(explicit: string | null): Promise<string[]> {
  if (explicit) {
    if (!ESPN_LEAGUE_BY_TOURNAMENT[explicit]) {
      throw new Error(`Sin mapeo ESPN para tournament=${explicit}`);
    }
    return [explicit];
  }
  // Default: tournaments que cumplan AL MENOS UNA condición:
  //   - Hay al menos una polla activa con scope != custom (ej. el
  //     organizador quiere que matches futuros entren solos).
  //   - Hay placeholder TBD rows sin promover. Esto cubre el caso
  //     común: pollas custom con cuartos/semis/final placeholders
  //     que esperan ser promovidos cuando ESPN publique los matchups.
  // Si ambas condiciones son false, retornamos [] y el cron skipea.
  const admin = createAdminClient();
  const tournaments = new Set<string>();

  const { data: dyn } = await admin
    .from("pollas")
    .select("tournament")
    .eq("status", "active")
    .neq("scope", "custom");
  for (const p of (dyn || []) as Array<{ tournament: string }>) {
    tournaments.add(p.tournament);
  }

  const { data: tbd } = await admin
    .from("matches")
    .select("tournament")
    .eq("home_team", "TBD")
    .like("external_id", "placeholder:%");
  for (const m of (tbd || []) as Array<{ tournament: string }>) {
    tournaments.add(m.tournament);
  }

  return Array.from(tournaments).filter((s) => ESPN_LEAGUE_BY_TOURNAMENT[s]);
}

async function runDiscover(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("tournament");
  const tournaments = await tournamentsToDiscover(explicit);
  if (tournaments.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "no_dynamic_pollas",
    };
  }
  const results = [];
  for (const t of tournaments) {
    const r = await discoverTournament(t);
    results.push(r);
  }
  return { ok: true, skipped: false, results };
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
