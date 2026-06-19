// app/api/pollas/[slug]/match-predictions/route.ts
// Lazy-load de los pronósticos del parche para UN partido específico.
// El GET principal de la polla solo precarga los marcadores de partidos
// con kickoff en las últimas 24h (ver route.ts). Para partidos más viejos
// el cliente pide acá on-demand cuando alguien expande "ver marcadores",
// así no transferimos miles de filas que casi nadie mira.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const matchId = request.nextUrl.searchParams.get("match_id");
    if (!matchId) {
      return NextResponse.json({ error: "match_id requerido" }, { status: 400 });
    }

    const adminSupabase = createAdminClient();

    // Resolver la polla por slug (admin client por el bug de auth.uid()).
    const { data: polla, error: pollaError } = await adminSupabase
      .from("pollas")
      .select("id, created_by")
      .eq("slug", params.slug)
      .single();
    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    // Gate de acceso: participante, organizador, o admin global (observador).
    // Mismo patrón que el GET principal.
    const { data: participant } = await adminSupabase
      .from("polla_participants")
      .select("user_id")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!participant && polla.created_by !== user.id) {
      const viewerIsGlobalAdmin = await isCurrentUserAdmin();
      if (!viewerIsGlobalAdmin) {
        return NextResponse.json({ error: "No tienes acceso a esta polla" }, { status: 403 });
      }
    }

    // El partido debe estar BLOQUEADO (live/finished o <=5 min al kickoff).
    // Si no, no revelamos pronósticos ajenos de un partido próximo (evita
    // hacer trampa espiando antes del cierre).
    const { data: match } = await adminSupabase
      .from("matches")
      .select("id, status, scheduled_at")
      .eq("id", matchId)
      .single();
    if (!match) {
      return NextResponse.json({ predictions: [] });
    }
    const kickoffMs = new Date(match.scheduled_at).getTime();
    const locked =
      match.status === "live" ||
      match.status === "finished" ||
      (Number.isFinite(kickoffMs) && Date.now() >= kickoffMs - 5 * 60 * 1000);
    if (!locked) {
      return NextResponse.json({ predictions: [] });
    }

    // Pronósticos del parche para ese partido (scoped a la polla por
    // polla_id, así un match_id ajeno no devuelve nada). Paginado por si
    // la polla tuviera más de 1000 participantes.
    const PAGE = 1000;
    const predictions: Array<{
      match_id: string;
      user_id: string;
      predicted_home: number;
      predicted_away: number;
      points_earned: number | null;
    }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: pageErr } = await adminSupabase
        .from("predictions")
        .select("match_id, user_id, predicted_home, predicted_away, points_earned")
        .eq("polla_id", polla.id)
        .eq("match_id", matchId)
        .order("user_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (pageErr) break;
      const rows = page || [];
      predictions.push(...rows);
      if (rows.length < PAGE) break;
    }

    return NextResponse.json({ predictions });
  } catch (e) {
    console.error("[match-predictions] error", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
