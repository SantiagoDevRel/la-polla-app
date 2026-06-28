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
//
// Auth: CRON_SECRET solo. Aceptado via header `x-cron-secret` o
// `Authorization: Bearer …`. La opción ?secret=… fue removida porque
// querystrings quedan persistidas en logs/CDN/Referer.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverTournament } from "@/lib/espn/discover";
import { ESPN_LEAGUE_BY_TOURNAMENT } from "@/lib/espn/client";
import { isSyncableTournament } from "@/lib/tournaments";
import { hasPlaceholderTeam } from "@/lib/matches/is-placeholder";
import { syncWorldCup2026 } from "@/lib/api-football/sync-worldcup";
import { syncCompetition } from "@/lib/football-data/sync";
import { resolveWorldCupBracketsFromEspn } from "@/lib/espn/resolve-brackets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function checkSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return bearer === `Bearer ${secret}` || header === secret;
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

  // Solo torneos "syncables" (post-Mundial: solo worldcup_2026). El auto-
  // discover por cron no toca ligas sin pollas activas. El path EXPLÍCITO
  // (?tournament=…) sí puede seedear cualquier liga mapeada — es override
  // deliberado con CRON_SECRET.
  return Array.from(tournaments).filter(
    (s) => ESPN_LEAGUE_BY_TOURNAMENT[s] && isSyncableTournament(s),
  );
}

// Resolución de brackets del Mundial (migración 062): si quedan slots de
// knockout con equipos codificados ("W93", "1A") y kickoff dentro de 7 días,
// corre openfootball + football-data para que el RPC promueva los slots
// in-place (mismo UUID → predicciones y pollas.match_ids intactos). El gate
// del pg_cron (trigger_discover_tournaments v2) dispara este endpoint bajo
// la misma condición, así que la resolución es automática cada 6h.
async function resolveWorldCupBrackets(): Promise<{
  pending: number;
  ran: boolean;
  openfootball?: { synced: number; errors: number };
  footballData?: { synced: number; errors: number };
  espn?: { promoted: number; errors: number };
}> {
  const admin = createAdminClient();
  const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("matches")
    .select("id, home_team, away_team")
    .eq("tournament", "worldcup_2026")
    .eq("status", "scheduled")
    .lt("scheduled_at", horizon);
  const pending = (data ?? []).filter((m) =>
    hasPlaceholderTeam(m.home_team, m.away_team),
  );
  if (pending.length === 0) return { pending: 0, ran: false };

  console.log(`[discover] ${pending.length} knockout slots sin resolver con kickoff <7d — corriendo resolución WC`);
  const out: Awaited<ReturnType<typeof resolveWorldCupBrackets>> = {
    pending: pending.length,
    ran: true,
  };
  try {
    const of = await syncWorldCup2026();
    out.openfootball = { synced: of.synced, errors: of.errors };
  } catch (err) {
    console.error("[discover] syncWorldCup2026 failed:", err);
    out.openfootball = { synced: 0, errors: 1 };
  }
  try {
    // Full fixture list (sin date filter): football-data publica los
    // matchups reales apenas se resuelven — 1 request, dentro del 10/min.
    const fd = await syncCompetition(2000, "worldcup_2026");
    out.footballData = { synced: fd.synced, errors: fd.errors };
  } catch (err) {
    console.error("[discover] football-data WC sync failed:", err);
    out.footballData = { synced: 0, errors: 1 };
  }
  try {
    // ESPN suele resolver los brackets antes que football-data. Promueve los
    // slots codificados desde los cruces YA resueltos de ESPN — pens-safe
    // (solo cruces con ambos equipos reales = partidos previos 100% jugados),
    // in-place via el mismo RPC (confirm/auto según bracket_promotion_mode).
    const espn = await resolveWorldCupBracketsFromEspn();
    out.espn = { promoted: espn.promoted, errors: espn.errors };
  } catch (err) {
    console.error("[discover] ESPN bracket resolve failed:", err);
    out.espn = { promoted: 0, errors: 1 };
  }
  return out;
}

async function runDiscover(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("tournament");
  const tournaments = await tournamentsToDiscover(explicit);

  // La resolución de brackets corre SIEMPRE que haya slots pendientes,
  // independiente del gate de ESPN-discover (que requiere pollas dinámicas
  // o TBD placeholders — condiciones que el Mundial knockout no cumple).
  const brackets = await resolveWorldCupBrackets();

  if (tournaments.length === 0) {
    return {
      ok: true,
      skipped: !brackets.ran,
      reason: brackets.ran ? undefined : "no_dynamic_pollas",
      brackets,
    };
  }
  const results = [];
  for (const t of tournaments) {
    const r = await discoverTournament(t);
    results.push(r);
  }
  return { ok: true, skipped: false, results, brackets };
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
