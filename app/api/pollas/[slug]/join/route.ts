// app/api/pollas/[slug]/join/route.ts — Unirse a una polla.
//
// A partir del rediseño Dev 5, no existe estado "pending" para participantes:
// el usuario está IN (status='approved') o OUT (sin fila).
//
// - Pollas abiertas (type='open'):
//     · digital_pool + buy_in > 0 → insert approved + payment_status='pending'
//       y devuelve checkoutUrl para mandar al usuario a Wompi.
//     · cualquier otro modo      → insert approved + payment_status='approved'.
// - Pollas cerradas (type='closed'):
//     · solo se entra por token de invitación (/invites/[token]).
//       El endpoint responde 403 con error 'invite_required'.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildWompiCheckoutUrl } from "@/lib/wompi/checkout";
import { notifyParticipantJoined } from "@/lib/notifications";

export async function POST(
  _request: NextRequest,
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

    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id, type, status, slug, payment_mode, buy_in_amount, currency")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    if (polla.status !== "active") {
      return NextResponse.json({ error: "Esta polla ya no está activa" }, { status: 400 });
    }

    if (polla.type === "closed") {
      return NextResponse.json(
        { error: "invite_required" },
        { status: 403 }
      );
    }

    // Already in?
    const { data: existing } = await supabase
      .from("polla_participants")
      .select("id, payment_status")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();

    const isDigitalPool =
      polla.payment_mode === "digital_pool" && polla.buy_in_amount > 0;

    const admin = createAdminClient();

    if (!existing) {
      const { error: insertError } = await admin
        .from("polla_participants")
        .insert({
          polla_id: polla.id,
          user_id: user.id,
          role: "player",
          status: "approved",
          payment_status: isDigitalPool ? "pending" : "approved",
          paid: !isDigitalPool,
        });
      if (insertError) {
        console.error("[join] insert participant failed:", insertError);
        return NextResponse.json({ error: "Error al unirse" }, { status: 500 });
      }
      // Ping the creator. Skip for digital_pool: payment hasn't landed yet,
      // the participant isn't really "in" until the Wompi webhook approves.
      if (!isDigitalPool) {
        await notifyParticipantJoined(admin, polla.id, user.id);
      }
    } else if (!isDigitalPool || existing.payment_status === "approved") {
      // Already in and either payment not required or already paid — just confirm.
      return NextResponse.json({
        joined: true,
        checkoutUrl: null,
        alreadyIn: true,
      });
    }

    // If digital_pool, immediately mint a Wompi checkout URL so the frontend
    // can redirect straight to payment.
    let checkoutUrl: string | null = null;
    if (isDigitalPool) {
      try {
        const reference = `${polla.slug}-${user.id.replace(/-/g, "").substring(0, 8)}`;
        const amountCents = polla.buy_in_amount * 100;
        const appUrl =
          (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";
        const redirectUrl = `${appUrl}/pollas/${polla.slug}?payment=success`;
        checkoutUrl = buildWompiCheckoutUrl({
          reference,
          amountCents,
          currency: polla.currency || "COP",
          redirectUrl,
        });
      } catch (wompiErr) {
        console.error("[join] Wompi URL build failed:", wompiErr);
      }
    }

    return NextResponse.json({ joined: true, checkoutUrl });
  } catch (error) {
    console.error("Error uniéndose a polla:", error);
    return NextResponse.json({ error: "Error al unirse" }, { status: 500 });
  }
}
