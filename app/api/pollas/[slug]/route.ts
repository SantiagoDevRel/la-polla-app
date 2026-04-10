// app/api/pollas/[slug]/route.ts — GET de una polla por slug con participantes, partidos y predicciones del usuario
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Cargar la polla por slug
    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("*")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    // Verificar que el usuario es participante o creador
    const { data: participant } = await supabase
      .from("polla_participants")
      .select("*")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (!participant && polla.created_by !== user.id) {
      return NextResponse.json({ error: "No tienes acceso a esta polla" }, { status: 403 });
    }

    // Cargar participantes con sus puntos y rank
    const { data: participants } = await supabase
      .from("polla_participants")
      .select(`
        *,
        users:user_id (
          id,
          display_name,
          whatsapp_number,
          avatar_url
        )
      `)
      .eq("polla_id", polla.id)
      .order("total_points", { ascending: false });

    // Cargar partidos — por match_ids si existen, sino por torneo (legacy)
    let matchQuery = supabase.from("matches").select("*");

    if (polla.match_ids && polla.match_ids.length > 0) {
      matchQuery = matchQuery.in("id", polla.match_ids);
    } else {
      matchQuery = matchQuery.eq("tournament", polla.tournament);
    }

    const { data: matches } = await matchQuery.order("scheduled_at", { ascending: true });

    // Cargar predicciones del usuario en esta polla
    const { data: predictions } = await supabase
      .from("predictions")
      .select("*")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id);

    return NextResponse.json({
      polla,
      participants: participants || [],
      matches: matches || [],
      predictions: predictions || [],
      currentUserRole: participant?.role || (polla.created_by === user.id ? "admin" : "player"),
      currentUserId: user.id,
    });
  } catch (error) {
    console.error("Error cargando polla:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
