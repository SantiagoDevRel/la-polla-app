// app/api/matches/sync-live/route.ts — Endpoint de sync rápido in-play.
//
// Llamado cada 1 min por pg_cron + pg_net cuando hay matches en
// ventana live (status='live' o scheduled próximo a kickoff). También
// se puede pegar manualmente con CRON_SECRET para debugging.
//
// Estrategia:
//   1. Gate temprano: si no hay matches en ventana live, no se lee el vivo.
//      Cuesta 1 query barata y ahorra cuota de API-Football.
//   2. syncApiFootballLive() — API-Football es la única fuente de vivo
//      (2026-09-13). El vivo nunca crea fixtures: eso es del calendario.
//   3. verifyPendingFinals() — cierre de resultados, también solo API-Football.
//
// Auth: CRON_SECRET solo (header x-cron-secret o Authorization Bearer).
// No se expone admin session. La opción ?secret=… fue removida —
// querystrings quedan persistidas en logs/CDN/Referer.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPendingFinals } from "@/lib/matches/verify-final";
import { syncApiFootballLive } from "@/lib/api-football/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function checkSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return bearer === `Bearer ${secret}` || header === secret;
}

async function hasActiveMatchWindow(): Promise<boolean> {
  const admin = createAdminClient();
  // Buscamos matches que justifiquen disparar la sync:
  //   - status='live' (obvio: corriendo)
  //   - status='scheduled' con kickoff entre [now - 30min, now + 30min]
  //     (cubre la transición scheduled → live).
  // En reposo (sin matches en ventana) la función devuelve false y la
  // sync no consulta el vivo del proveedor.
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

  // ⚠️ verifyPendingFinals corre SIEMPRE, gate abierto o no. El gate solo
  // ahorra la lectura del vivo. Razón (review 2026-06-10): la verificación
  // exige una segunda lectura del proveedor minutos después del pitazo — si el
  // partido que terminó era el último del día, el gate ya está cerrado en el
  // tick siguiente y el scoring quedaría congelado hasta la próxima ventana.
  // El path sin candidatos cuesta 1 query con inner join — barato.
  //
  // API-Football es la única fuente de vivo y resultados (2026-09-13). No hay
  // respaldo de otro proveedor: si API-Football no responde, la fila espera al
  // siguiente tick.
  const apiFootball = inWindow ? await syncApiFootballLive() : new Set<string>();
  const verifications = await verifyPendingFinals();

  return {
    ok: true,
    skipped: !inWindow,
    reason: inWindow ? undefined : "no_active_window",
    apiFootball: { covered: apiFootball.size },
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
