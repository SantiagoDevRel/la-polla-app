// app/api/admin/matches/purge/route.ts — Elimina partidos anteriores a 2026-01-01
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const validSecret = process.env.CRON_SECRET;
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    // Solo eliminar partidos con fecha anterior al 1 de enero de 2026
    const { data, error } = await supabase
      .from("matches")
      .delete()
      .lt("scheduled_at", "2026-01-01T00:00:00Z")
      .select("id");

    if (error) {
      console.error("[purge] Error eliminando partidos:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deleted = data?.length || 0;
    console.log(`[purge] ${deleted} partidos eliminados (anteriores a 2026-01-01)`);
    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("[purge] Error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
