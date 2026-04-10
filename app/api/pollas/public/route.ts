// app/api/pollas/public/route.ts — Endpoint público para listar pollas abiertas y activas
// No requiere autenticación — solo retorna datos no sensibles
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();

    const { data: pollas, error } = await supabase
      .from("pollas")
      .select("id, slug, name, description, tournament, buy_in_amount, currency, payment_mode, type, created_at")
      .eq("type", "open")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    // Contar participantes por polla
    const pollaIds = (pollas || []).map((p) => p.id);
    const participantCounts: Record<string, number> = {};

    if (pollaIds.length > 0) {
      const { data: counts } = await supabase
        .from("polla_participants")
        .select("polla_id")
        .in("polla_id", pollaIds);

      if (counts) {
        for (const c of counts) {
          participantCounts[c.polla_id] = (participantCounts[c.polla_id] || 0) + 1;
        }
      }
    }

    return NextResponse.json({
      pollas: (pollas || []).map((p) => ({
        ...p,
        participant_count: participantCounts[p.id] || 0,
      })),
    });
  } catch (error) {
    console.error("Error listando pollas públicas:", error);
    return NextResponse.json({ error: "Error al listar pollas" }, { status: 500 });
  }
}
