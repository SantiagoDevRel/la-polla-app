// app/api/pollas/public/route.ts — Endpoint público para listar pollas abiertas y activas
// No requiere autenticación — solo retorna datos no sensibles
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TOURNAMENTS } from "@/lib/tournaments";
import { TERMINAL_MATCH_STATUSES } from "@/lib/matches/constants";

const VALID_TOURNAMENTS = TOURNAMENTS.map((t) => t.slug);

export async function GET() {
  try {
    const supabase = createClient();

    const { data: pollas, error } = await supabase
      .from("pollas")
      .select("id, slug, name, description, tournament, buy_in_amount, currency, payment_mode, type, match_ids, created_at")
      .eq("type", "open")
      .eq("status", "active")
      .in("tournament", VALID_TOURNAMENTS)
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

    // Match counts for progress footer ("Y de X partidos")
    const allMatchIds = Array.from(
      new Set((pollas || []).flatMap((p) => (p.match_ids as string[] | null) || []))
    );
    const matchById = new Map<string, { status: string }>();
    if (allMatchIds.length > 0) {
      const { data: matchRows } = await supabase
        .from("matches")
        .select("id, status")
        .in("id", allMatchIds);
      for (const m of matchRows || []) {
        matchById.set(m.id, { status: m.status });
      }
    }

    return NextResponse.json({
      pollas: (pollas || []).map((p) => {
        const matchIds = (p.match_ids as string[] | null) || [];
        const finishedCount = matchIds.filter((id) => {
          const m = matchById.get(id);
          return m ? TERMINAL_MATCH_STATUSES.has(m.status) : false;
        }).length;
        return {
          ...p,
          participant_count: participantCounts[p.id] || 0,
          total_matches: matchIds.length,
          finished_matches: finishedCount,
        };
      }),
    });
  } catch (error) {
    console.error("Error listando pollas públicas:", error);
    return NextResponse.json({ error: "Error al listar pollas" }, { status: 500 });
  }
}
