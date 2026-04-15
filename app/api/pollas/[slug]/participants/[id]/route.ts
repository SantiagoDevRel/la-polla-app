// app/api/pollas/[slug]/participants/[id]/route.ts — Admin-only participant
// management. Currently supports PATCH { status: "rejected" } to expel a
// participant from a polla.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: polla } = await admin
      .from("pollas")
      .select("id")
      .eq("slug", params.slug)
      .maybeSingle();
    if (!polla) return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });

    const { data: caller } = await admin
      .from("polla_participants")
      .select("role")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!caller || caller.role !== "admin") {
      return NextResponse.json({ error: "Solo el admin puede modificar participantes" }, { status: 403 });
    }

    const { data: target } = await admin
      .from("polla_participants")
      .select("id, role, polla_id")
      .eq("id", params.id)
      .eq("polla_id", polla.id)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
    if (target.role === "admin") {
      return NextResponse.json({ error: "No se puede expulsar a un admin" }, { status: 400 });
    }

    const { error: updErr } = await admin
      .from("polla_participants")
      .update({ status: parsed.data.status })
      .eq("id", target.id);
    if (updErr) {
      console.error("[participants:patch] failed:", updErr);
      return NextResponse.json({ error: "Error actualizando participante" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[participants:patch] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
