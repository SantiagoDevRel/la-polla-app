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
//     · se entra por token de invitación abierto (URL ?token=xxx que coincide
//       con pollas.invite_token) — body { invite_token: 'xxx' }.
//     · sin token válido el endpoint responde 403 con error 'invite_required'.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildWompiCheckoutUrl } from "@/lib/wompi/checkout";
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

    if (polla.type === "closed") {
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
    const isAdminCollects = polla.payment_mode === "admin_collects";

    // paid semantics per payment mode, decided explicitly so future readers
    // see the intent instead of a cryptic boolean:
    //   digital_pool   → paid=false until the Wompi webhook confirms.
    //   admin_collects → paid=false until the organizer approves the comprobante.
    //   pay_winner     → paid=true on join (nothing to collect upfront).
    const initialPaid = !(isDigitalPool || isAdminCollects);

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
          paid: initialPaid,
        });
      if (insertError) {
        console.error("[join] insert participant failed:", insertError);
        return NextResponse.json({ error: "Error al unirse" }, { status: 500 });
      }
      // Ping the creator. Skip for digital_pool (Wompi webhook will finalize
      // the join) and for admin_collects (the Phase 2C payment-submitted
      // notification is the meaningful event for the organizer).
      if (!isDigitalPool && !isAdminCollects) {
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
