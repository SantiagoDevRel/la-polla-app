// app/api/matches/sync-recent/route.ts — Sync de ventana corta (~ultimas 3h + 1h adelante)
// Se llama desde ensureMatchesFresh() cuando un usuario activo entra a una polla
// o le pide leaderboard/predicciones al bot. Auth: CRON_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { syncRecentCompetitions } from "@/lib/football-data/sync";
import { createAdminClient } from "@/lib/supabase/admin";

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

async function runSync() {
  const started = Date.now();
  const results = await syncRecentCompetitions(3, 1);
  const ms = Date.now() - started;

  // Anota la ultima corrida para que ensureMatchesFresh respete el throttle.
  const admin = createAdminClient();
  await admin
    .from("sync_log")
    .upsert(
      { key: "matches_recent", last_run: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  return { ok: true, ms, results };
}

export async function GET(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSync());
  } catch (error) {
    console.error("[sync-recent] Error:", error);
    return NextResponse.json({ error: "Error en sync" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSync());
  } catch (error) {
    console.error("[sync-recent] Error:", error);
    return NextResponse.json({ error: "Error en sync" }, { status: 500 });
  }
}
