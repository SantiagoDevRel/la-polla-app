// app/api/matches/sync-live/route.ts — Endpoint de sync rápido in-play.
//
// Llamado cada 1 min por pg_cron + pg_net cuando hay matches en
// ventana live (status='live' o scheduled próximo a kickoff). También
// se puede pegar manualmente con CRON_SECRET para debugging.
//
// Estrategia:
//   1. Gate temprano: si no hay matches en ventana live, return ok
//      sin hacer fetch externos. Cuesta 1 query barata, ahorra
//      requests innecesarias a ESPN.
//   2. Llamar a syncEspnLive() — primary source para in-play.
//   3. ESPN nunca crea fixtures. Si encontramos un match en la DB
//      sin update reciente, football-data sigue siendo el backup
//      (corre lazy via ensureMatchesFresh en otros endpoints).
//
// Auth: CRON_SECRET solo (header x-cron-secret, Authorization Bearer,
// o ?secret query). No se expone admin session.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncEspnLive } from "@/lib/espn/sync";
import { verifyPendingFinals } from "@/lib/matches/verify-final";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function checkSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  const query = request.nextUrl.searchParams.get("secret") ?? "";
  return bearer === `Bearer ${secret}` || header === secret || query === secret;
}

async function hasActiveMatchWindow(): Promise<boolean> {
  const admin = createAdminClient();
  // Buscamos matches que justifiquen disparar la sync:
  //   - status='live' (obvio: corriendo)
  //   - status='scheduled' con kickoff entre [now - 30min, now + 30min]
  //     (cubre la transición scheduled → live).
  // En reposo (sin matches en ventana) la función devuelve false y la
  // sync no llama a ESPN ni a nada.
  const nowIso = new Date().toISOString();
  const back = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const forward = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("matches")
    .select("id", { head: true, count: "exact" })
    .or(
      `status.eq.live,and(status.eq.scheduled,scheduled_at.gte.${back},scheduled_at.lte.${forward})`,
    );
  if (error) {
    // Si la query falla, conservamos el comportamiento de sí-correr.
    // Es preferible un fetch de más a perder un update.
    console.warn("[sync-live] window check failed:", error.message);
    void nowIso;
    return true;
  }
  return (count ?? 0) > 0;
}

async function runSync() {
  const started = Date.now();

  const inWindow = await hasActiveMatchWindow();
  if (!inWindow) {
    return {
      ok: true,
      skipped: true,
      reason: "no_active_window",
      ms: Date.now() - started,
    };
  }

  const espn = await syncEspnLive();

  // Después de la sync, chequear si hay matches que recién pasaron a
  // finished y todavía no están verified contra la otra fuente.
  // verifyPendingFinals corre solo cuando hay candidatos — barato.
  const verifications = await verifyPendingFinals();

  return {
    ok: true,
    skipped: false,
    espn,
    verifications,
    ms: Date.now() - started,
  };
}

export async function GET(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSync());
  } catch (error) {
    console.error("[sync-live] Error:", error);
    return NextResponse.json({ error: "Error en sync-live" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSync());
  } catch (error) {
    console.error("[sync-live] Error:", error);
    return NextResponse.json({ error: "Error en sync-live" }, { status: 500 });
  }
}
