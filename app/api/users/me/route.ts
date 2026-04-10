// app/api/users/me/route.ts — Endpoint para perfil del usuario autenticado
// GET: retorna stats del perfil (usa admin client para bypass RLS)
// PATCH: actualiza display_name en public.users
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const updateSchema = z.object({
  display_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(50, "El nombre debe tener máximo 50 caracteres"),
});

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const admin = createAdminClient();

    const { data: userData } = await admin
      .from("users")
      .select("display_name, whatsapp_number, avatar_url")
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

    return NextResponse.json({
      profile: userData,
      stats: {
        pollasCount: participations?.length || 0,
        predictionsCount: predCount || 0,
        bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
      },
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

    const { error } = await supabase
      .from("users")
      .update({ display_name: parsed.data.display_name })
      .eq("id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando perfil:", error);
    return NextResponse.json({ error: "Error al actualizar perfil" }, { status: 500 });
  }
}
