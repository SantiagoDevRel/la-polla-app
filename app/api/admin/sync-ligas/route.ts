// app/api/admin/sync-ligas/route.ts — actualiza desde el panel el calendario de
// una liga que quedó sin partidos en la base, sin abrir una terminal.
//
// Por que existe: el formulario de crear polla pinta todas las ligas igual. Si
// una liga no tiene partidos futuros guardados, el administrador ve "no hay
// partidos", que se lee como un error de la app. Este endpoint trae la
// temporada completa de API-Football, la única fuente de partidos desde el
// 2026-09-13, con la misma reserva de 15 minutos del cron de calendario.
//
// ⚠️ REGLA #1 del repo: toda insercion en `matches` pasa por el RPC
// `upsert_match_safe`. Aca no se escribe nada a mano — se delega en
// `refreshTournamentScheduleDetailed` → lib/api-football/calendar.ts.
//
// Autorizacion: la columna `users.is_admin`, nunca el telefono. Se deja como
// unica puerta a proposito (mismo patron que /api/casa/admin/entries): el path
// con CRON_SECRET ya existe en /api/matches/discover para el cron.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { CREATABLE_TOURNAMENT_SLUGS, getTournamentName } from "@/lib/tournaments";
import { refreshTournamentScheduleDetailed } from "@/lib/matches/refresh-schedule";
import { afLeagueIdForTournament } from "@/lib/api-football/season";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60s es el techo del plan free de Vercel; el refresco se corta a los 45 s.
export const maxDuration = 60;

const schema = z.object({
  tournament: z.string().trim().min(1),
});

/**
 * GET — que tan vacia esta cada liga que la casa puede usar.
 *
 * Sirve para que el panel muestre "esta liga no tiene partidos" ANTES de que el
 * administrador la elija y se encuentre con una lista vacia. Se cuenta con
 * `head: true` (solo el count, cero filas) para no chocar con el tope de ~1000
 * filas de PostgREST.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  const db = createAdminClient();
  const ahora = new Date().toISOString();

  const ligas = await Promise.all(
    CREATABLE_TOURNAMENT_SLUGS.map(async (slug) => {
      const { count } = await db
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("tournament", slug)
        .gte("scheduled_at", ahora);

      const partidosFuturos = count ?? 0;
      return {
        slug,
        nombre: getTournamentName(slug),
        partidosFuturos,
        // Sin liga de API-Football el boton de sincronizar no puede hacer nada.
        sincronizable: !!afLeagueIdForTournament(slug),
        vacia: partidosFuturos === 0,
      };
    }),
  );

  return NextResponse.json({ ligas });
}

/** POST — traer el calendario de una liga desde API-Football. */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { tournament } = parsed.data;

  if (!afLeagueIdForTournament(tournament)) {
    return NextResponse.json({ error: "No encontramos esa liga en la fuente de partidos." }, { status: 400 });
  }
  try {
    const r = await refreshTournamentScheduleDetailed(tournament);
    if (!r.refreshed) {
      const error = r.state === "pending"
        ? "Ya hay una actualización de este calendario en curso. Intenta de nuevo en unos minutos."
        : "No pude actualizar el calendario. Intenta de nuevo en unos minutos.";
      return NextResponse.json({ error, estado: r.state }, { status: r.state === "pending" ? 409 : 502 });
    }
    return NextResponse.json({
      ok: true,
      torneo: tournament,
      nombre: getTournamentName(tournament),
      fuente: "api-football",
      traidos: r.af?.fetched ?? 0,
      guardados: (r.af?.inserted ?? 0) + (r.af?.updated ?? 0) + (r.af?.linked ?? 0),
      errores: r.af?.errors ?? 0,
      avisos: [],
    });
  } catch (error) {
    // Nunca el objeto de error completo: un error de Axios lleva la clave del proveedor.
    console.error("[sync-ligas] Error:", error instanceof Error ? error.message : "desconocido");
    return NextResponse.json({ error: "No pude actualizar el calendario. Intenta de nuevo en unos minutos." }, { status: 500 });
  }
}
