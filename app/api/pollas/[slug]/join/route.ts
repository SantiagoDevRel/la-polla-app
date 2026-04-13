// app/api/pollas/[slug]/join/route.ts — Unirse a una polla abierta
// POST: inserta al usuario como participante con role='player'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Obtener la polla
    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id, type, status, slug, payment_mode, buy_in_amount")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    if (polla.status !== "active") {
      return NextResponse.json({ error: "Esta polla ya no está activa" }, { status: 400 });
    }

    if (polla.type === "closed") {
      return NextResponse.json({ error: "Esta polla es privada" }, { status: 403 });
    }

    // Verificar si ya es participante
    const { data: existing } = await supabase
      .from("polla_participants")
      .select("id")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (existing) {
      return NextResponse.json({ error: "Ya eres participante", polla: { slug: polla.slug } }, { status: 409 });
    }

    // digital_pool pollas gate on payment_status instead of admin approval:
    // status goes 'approved' immediately so the user can see the polla, and
    // payment_status='pending' blocks predictions until the Wompi webhook flips it.
    const isDigitalPool =
      polla.payment_mode === "digital_pool" && polla.buy_in_amount > 0;

    const { error: insertError } = await supabase
      .from("polla_participants")
      .insert({
        polla_id: polla.id,
        user_id: user.id,
        role: "player",
        status: isDigitalPool ? "approved" : "pending",
        payment_status: isDigitalPool ? "pending" : "approved",
        paid: false,
      });

    if (insertError) throw insertError;

    return NextResponse.json(
      { success: true, status: "pending", message: "Solicitud enviada. El admin debe aprobarte.", polla: { slug: polla.slug } },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error uniéndose a polla:", error);
    return NextResponse.json({ error: "Error al unirse" }, { status: 500 });
  }
}
