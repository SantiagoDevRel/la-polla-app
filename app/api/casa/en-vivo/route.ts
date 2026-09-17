// app/api/casa/en-vivo/route.ts — los partidos en juego de MIS pollas, con mi
// pronóstico. Lo consulta la franja «En vivo» de /casa cada 30 s mientras la
// pestaña está visible; el vivo lo escribe el cron cada minuto.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listMyLiveMatches } from "@/lib/casa/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return privateJson({ error: "Sin sesión." }, 401);
    const rows = await listMyLiveMatches(user.id);
    return privateJson({ rows, now: new Date().toISOString() });
  } catch {
    return privateJson({ error: "No se pudieron cargar los partidos en vivo." }, 500);
  }
}
