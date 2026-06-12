// app/api/teams/news/route.ts — GET noticias de un equipo (ESPN).
// Auth-gated. Devuelve titulares de la liga filtrados por el equipo (y si
// ninguno lo menciona, los de la liga — ver fetchEspnTeamNews). Si la liga
// no tiene feed de noticias (torneo sin /news), devuelve news vacío.
//
// Cero data en nuestra DB: todo sale de ESPN (público, sin API key).
// Cacheado 30 min en el browser (las noticias rotan más seguido).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchEspnTeamNews } from "@/lib/espn/teams";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const tournament = params.get("tournament");
    const team = params.get("team");
    if (!tournament || !team) {
      return NextResponse.json({ error: "tournament y team requeridos" }, { status: 400 });
    }

    const news = await fetchEspnTeamNews(tournament, team);
    return NextResponse.json(
      { news },
      { headers: { "Cache-Control": "private, max-age=1800" } },
    );
  } catch (err) {
    console.error("[teams/news] unexpected:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
