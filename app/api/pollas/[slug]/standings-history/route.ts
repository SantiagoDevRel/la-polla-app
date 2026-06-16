// app/api/pollas/[slug]/standings-history/route.ts
// GET lazy para el "bump chart" / carrera de posiciones (feature 2026-06-16).
// Devuelve la evolución de posiciones de la polla agrupada por DÍA. Pesado
// → endpoint aparte (no se carga en el GET principal de la polla), se pide
// solo cuando el usuario abre la pestaña Evolución.
//
// Auth: igual que el resto del codebase (workaround auth.uid()): validamos
// sesión, leemos por admin client y gateamos nosotros. Standings = solo
// miembros de la polla (o admin global en modo observador).
//
// La agregación pesada vive en el RPC get_polla_standings_history (migration
// 070), que corre en SQL para no chocar con el cap de ~1000 filas de
// PostgREST en pollas grandes. Acá solo resolvemos scope→match_ids y
// adornamos cada racer con nombre + pollito.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePollaMatchIds } from "@/lib/matches/resolve-scope";
import { POLLA_COLUMNS } from "@/lib/db/columns";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

interface RpcRacer {
  user_id: string;
  cum: number[];
}
interface RpcResult {
  days: string[];
  racers: RpcRacer[];
}

// "2026-06-11" → "11/6" (sin Date() para evitar corrimientos de timezone:
// el string ya representa el día local de Bogotá calculado en el RPC).
function dayLabel(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${Number(d)}/${Number(m)}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: polla, error: pollaError } = await admin
      .from("pollas")
      .select(POLLA_COLUMNS)
      .eq("slug", params.slug)
      .single();
    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    // Gate: participante de la polla, o el creador, o admin global (observador).
    const { data: participant } = await admin
      .from("polla_participants")
      .select("id")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!participant && polla.created_by !== user.id) {
      const isAdmin = await isCurrentUserAdmin();
      if (!isAdmin) {
        return NextResponse.json(
          { error: "No tienes acceso a esta polla" },
          { status: 403 },
        );
      }
    }

    // scope → match_ids (mismo resolver que el leaderboard, así octavos
    // publicados después entran solos).
    const matchIds = await resolvePollaMatchIds(admin, {
      id: polla.id,
      scope: polla.scope,
      tournament: polla.tournament,
      match_ids: polla.match_ids,
      starts_at: polla.starts_at,
      created_at: polla.created_at,
    });

    if (matchIds.length === 0) {
      return NextResponse.json({ days: [], racers: [] });
    }

    const { data: rpcData, error: rpcError } = await admin.rpc(
      "get_polla_standings_history",
      { p_polla_id: polla.id, p_match_ids: matchIds },
    );
    if (rpcError) {
      console.error("[standings-history] rpc error:", rpcError.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    const result = (rpcData as RpcResult | null) ?? { days: [], racers: [] };

    // Adornar cada racer con nombre + tipo de pollito (avatar_url).
    const userIds = result.racers.map((r) => r.user_id);
    let meta: Record<string, { name: string; avatarType: string | null }> = {};
    if (userIds.length > 0) {
      const { data: users } = await admin
        .from("users")
        .select("id, display_name, avatar_url")
        .in("id", userIds);
      meta = Object.fromEntries(
        (users || []).map((u) => [
          u.id,
          { name: u.display_name || "Jugador", avatarType: u.avatar_url },
        ]),
      );
    }

    const racers = result.racers.map((r) => ({
      id: r.user_id,
      name: meta[r.user_id]?.name ?? "Jugador",
      avatarType: meta[r.user_id]?.avatarType ?? null,
      isMe: r.user_id === user.id,
      cumPoints: r.cum,
    }));

    return NextResponse.json({
      days: result.days.map(dayLabel),
      racers,
    });
  } catch (error) {
    console.error("[standings-history] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
