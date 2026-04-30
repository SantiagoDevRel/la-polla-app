// app/api/users/me/route.ts — Endpoint para perfil del usuario autenticado
// GET: retorna stats del perfil (usa admin client para bypass RLS)
// PATCH: actualiza display_name en public.users
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  isValidDisplayName,
} from "@/lib/users/needs-name";

const PAYOUT_METHODS = ["nequi", "daviplata", "bancolombia", "transfiya", "otro"] as const;

const updateSchema = z.object({
  display_name: z
    .string()
    .min(DISPLAY_NAME_MIN, `El nombre debe tener al menos ${DISPLAY_NAME_MIN} caracteres`)
    .max(DISPLAY_NAME_MAX, `El nombre debe tener máximo ${DISPLAY_NAME_MAX} caracteres`)
    .refine(
      (v) => isValidDisplayName(v),
      "El nombre no puede ser tu número de teléfono",
    )
    .optional(),
  avatar_url: z.string().max(50).optional(),
  default_payout_method: z.enum(PAYOUT_METHODS).nullable().optional(),
  default_payout_account: z.string().trim().min(3).max(120).nullable().optional(),
});

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const admin = createAdminClient();

    const { data: userData } = await admin
      .from("users")
      .select("display_name, whatsapp_number, avatar_url, is_admin, default_payout_method, default_payout_account, default_payout_set_at")
      .eq("id", user.id)
      .single();

    const { data: participations } = await admin
      .from("polla_participants")
      .select("polla_id, rank")
      .eq("user_id", user.id);

    const { count: predCount } = await admin
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const ranks = (participations || []).map((p) => p.rank).filter((r): r is number => r !== null);

    // Recent activity: last 3 scored predictions
    const { data: recentPreds } = await admin
      .from("predictions")
      .select("points_earned, match_id, polla_id, matches(home_team, away_team), pollas(name)")
      .eq("user_id", user.id)
      .gt("points_earned", -1)
      .not("points_earned", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(3);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentActivity = ((recentPreds || []) as any[]).map((r) => {
      const match = Array.isArray(r.matches) ? r.matches[0] : r.matches;
      const polla = Array.isArray(r.pollas) ? r.pollas[0] : r.pollas;
      return {
        matchName: match ? `${match.home_team} vs ${match.away_team}` : "Partido",
        pollaName: polla?.name || "Polla",
        pointsEarned: r.points_earned || 0,
      };
    });

    return NextResponse.json({
      profile: userData,
      stats: {
        pollasCount: participations?.length || 0,
        predictionsCount: predCount || 0,
        bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
      },
      recentActivity,
    });
  } catch (error) {
    console.error("Error obteniendo perfil:", error);
    return NextResponse.json({ error: "Error al obtener perfil" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updateData: Record<string, string | null> = {};
    if (parsed.data.display_name) updateData.display_name = parsed.data.display_name;
    if (parsed.data.avatar_url) updateData.avatar_url = parsed.data.avatar_url;

    // Payout default: ambos campos viajan juntos. Permitimos null
    // explícito para borrar la cuenta guardada.
    const wantsPayout =
      parsed.data.default_payout_method !== undefined ||
      parsed.data.default_payout_account !== undefined;
    if (wantsPayout) {
      updateData.default_payout_method = parsed.data.default_payout_method ?? null;
      updateData.default_payout_account = parsed.data.default_payout_account ?? null;
      updateData.default_payout_set_at = updateData.default_payout_account
        ? new Date().toISOString()
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    // Admin client porque users_update_own gatea por auth.uid() = id, y
    // auth.uid() llega NULL al PostgREST. Sin esto, el UPDATE no afecta
    // ninguna fila (silencioso) y la UI confirma "guardado" pero el
    // perfil no cambia. .eq("id", user.id) sigue siendo el scope:
    // user.id viene del session getUser() validado arriba.
    const admin = createAdminClient();
    const { error } = await admin
      .from("users")
      .update(updateData)
      .eq("id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando perfil:", error);
    return NextResponse.json({ error: "Error al actualizar perfil" }, { status: 500 });
  }
}
