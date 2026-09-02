// app/api/admin/sync-ligas/route.ts — trae desde ESPN los partidos de una liga
// que quedo sin calendario en la base, sin abrir una terminal.
//
// Por que existe: de las 8 ligas que la casa puede usar, football-data (plan
// free) no cubre Libertadores ni Liga BetPlay, y para Champions no siempre
// publica el calendario con anticipacion. Esas quedan sin partidos futuros,
// pero el formulario de crear polla las pinta igual que las demas: el
// administrador elige una liga vacia y ve "no hay partidos", que se lee como un
// error de la app. Este endpoint es el mismo trabajo que
// `scripts/sync-espn-ligas.ts`, disponible desde el panel.
//
// ⚠️ REGLA #1 del repo: toda insercion en `matches` pasa por el RPC
// `upsert_match_safe`. Aca no se escribe nada a mano — se delega en
// `discoverTournament`, que ya lo respeta.
//
// ⚠️ REGLA #2: los cruces de bracket sin equipos definidos no generan filas;
// el discover los descarta antes de llamar al RPC.
//
// Autorizacion: la columna `users.is_admin`, nunca el telefono. Se deja como
// unica puerta a proposito (mismo patron que /api/casa/admin/entries): el path
// con CRON_SECRET ya existe en /api/matches/discover para el cron.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { discoverTournament } from "@/lib/espn/discover";
import { ESPN_LEAGUE_BY_TOURNAMENT } from "@/lib/espn/client";
import { CREATABLE_TOURNAMENT_SLUGS, getTournamentName } from "@/lib/tournaments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60s es el techo del plan free de Vercel. Alcanza de sobra: la ventana por
// defecto de abajo trae decenas de partidos, no cientos.
export const maxDuration = 60;

const schema = z.object({
  tournament: z.string().trim().min(1),
  // Cuanto calendario traer. El default es mas corto que el del script (90)
  // porque aca hay un limite de 60s: cada partido es una llamada al RPC.
  diasAdelante: z.number().int().min(1).max(120).optional(),
  // Dias hacia atras, para recuperar partidos reprogramados.
  diasAtras: z.number().int().min(0).max(30).optional(),
});

const DIAS_ADELANTE_DEFAULT = 60;

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
        // Sin mapeo de ESPN el boton de sincronizar no puede hacer nada.
        sincronizable: !!ESPN_LEAGUE_BY_TOURNAMENT[slug],
        vacia: partidosFuturos === 0,
      };
    }),
  );

  return NextResponse.json({ ligas });
}

/** POST — traer el calendario de una liga desde ESPN. */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { tournament, diasAdelante, diasAtras } = parsed.data;

  // Se acepta cualquier liga mapeada en ESPN, no solo las creables: es una
  // acción manual del administrador y puede necesitar resincronizar una liga
  // que hoy no está en el formulario.
  if (!ESPN_LEAGUE_BY_TOURNAMENT[tournament]) {
    return NextResponse.json(
      { error: `ESPN no tiene esa liga. Válidas: ${Object.keys(ESPN_LEAGUE_BY_TOURNAMENT).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const r = await discoverTournament(tournament, {
      daysAhead: diasAdelante ?? DIAS_ADELANTE_DEFAULT,
      daysBack: diasAtras,
    });

    return NextResponse.json({
      ok: true,
      torneo: tournament,
      nombre: getTournamentName(tournament),
      liga: r.league,
      traidos: r.fetched,
      guardados: r.inserted_or_updated,
      errores: r.errors,
      // Los avisos suelen ser cruces de bracket todavía sin rivales. Se recorta
      // para no devolver una respuesta enorme.
      avisos: r.warnings.slice(0, 10),
    });
  } catch (error) {
    console.error("[sync-ligas] Error:", error);
    const msg = error instanceof Error ? error.message : "Error sincronizando";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
