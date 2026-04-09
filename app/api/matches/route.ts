// app/api/matches/route.ts — Endpoint para obtener partidos desde Supabase
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET — Obtener partidos almacenados en Supabase (ya sincronizados desde API-Football)
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const tournament = searchParams.get("tournament") || "worldcup_2026";
    const status = searchParams.get("status"); // optional filter: scheduled, live, finished

    let query = supabase
      .from("matches")
      .select("*")
      .eq("tournament", tournament)
      .order("scheduled_at", { ascending: true });

    if (status) {
      query = query.eq("status", status);
    }

    const { data: matches, error } = await query;

    if (error) {
      console.error("Error consultando partidos:", error.message);
      return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
    }

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error obteniendo partidos:", error);
    return NextResponse.json({ error: "Error al obtener partidos" }, { status: 500 });
  }
}
