// app/api/pollas/[slug]/join/route.ts — Unirse a una polla.
//
// Todas las pollas son privadas (type='closed'). Para entrar:
//   · invite_token en el body — corresponde a pollas.invite_token (link
//     compartido por el organizador). Sin token válido → 403 invite_required.
//   · alternativa: /api/pollas/join-by-code (código de 6 caracteres).
//
// No existe estado "pending" — el usuario está IN (status='approved') o OUT.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyParticipantJoined } from "@/lib/notifications";

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

    let providedInviteToken: string | null = null;
    try {
      const body = await request.json();
      if (body && typeof body.invite_token === "string") {
        providedInviteToken = body.invite_token;
      }
    } catch {
      // No body / not JSON — fine, just means no token provided.
    }

    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id, type, status, slug, payment_mode, buy_in_amount, currency, invite_token")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    if (polla.status !== "active") {
      const msg = polla.status === "ended" ? "Esta polla ya finalizó" : "Esta polla ya no está activa";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Toda polla es privada — siempre se requiere invite_token válido.
    const tokenMatches =
      !!providedInviteToken &&
      !!polla.invite_token &&
      providedInviteToken === polla.invite_token;
    if (!tokenMatches) {
      return NextResponse.json(
        { error: "invite_required" },
        { status: 403 }
      );
    }

    // Already in?
    const { data: existing } = await supabase
      .from("polla_participants")
      .select("id")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();

    const isAdminCollects = polla.payment_mode === "admin_collects";

    // paid semantics per payment mode:
    //   admin_collects → paid=false until the organizer approves the comprobante.
    //   pay_winner     → paid=true on join (nothing to collect upfront).
    const initialPaid = !isAdminCollects;

    const admin = createAdminClient();

    if (!existing) {
      const { error: insertError } = await admin
        .from("polla_participants")
        .insert({
          polla_id: polla.id,
          user_id: user.id,
          role: "player",
          status: "approved",
          payment_status: "approved",
          paid: initialPaid,
        });
      if (insertError) {
        console.error("[join] insert participant failed:", insertError);
        return NextResponse.json({ error: "Error al unirse" }, { status: 500 });
      }
      // Ping the creator. Skip for admin_collects (the Phase 2C payment-submitted
      // notification is the meaningful event for the organizer).
      if (!isAdminCollects) {
        await notifyParticipantJoined(admin, polla.id, user.id);
      }
    } else {
      return NextResponse.json({ joined: true, alreadyIn: true });
    }

    return NextResponse.json({ joined: true });
  } catch (error) {
    console.error("Error uniéndose a polla:", error);
    return NextResponse.json({ error: "Error al unirse" }, { status: 500 });
  }
}
