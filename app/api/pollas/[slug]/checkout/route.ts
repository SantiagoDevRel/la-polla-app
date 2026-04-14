// app/api/pollas/[slug]/checkout/route.ts — Genera URL de checkout de Wompi
// y registra al usuario como participante en estado pending_payment.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildWompiCheckoutUrl } from "@/lib/wompi/checkout";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: polla, error: pollaErr } = await supabase
      .from("pollas")
      .select("id, slug, status, payment_mode, buy_in_amount, currency")
      .eq("slug", slug)
      .single();

    if (pollaErr || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }
    if (polla.status !== "active") {
      return NextResponse.json({ error: "La polla no está activa" }, { status: 400 });
    }
    if (polla.payment_mode !== "digital_pool") {
      return NextResponse.json({ error: "Esta polla no usa pago digital" }, { status: 400 });
    }
    if (!polla.buy_in_amount || polla.buy_in_amount < 1000) {
      return NextResponse.json({ error: "Cuota de entrada inválida" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Participant row uses status='approved' (CHECK constraint only allows pending/approved/rejected)
    // and payment_status='pending' as the real gate. Webhook flips payment_status to 'approved'.
    const { data: existing } = await admin
      .from("polla_participants")
      .select("id, status, payment_status")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { error: insertErr } = await admin.from("polla_participants").insert({
        polla_id: polla.id,
        user_id: user.id,
        role: "player",
        status: "approved",
        payment_status: "pending",
        paid: false,
      });
      if (insertErr) {
        console.error("Checkout participant insert failed", insertErr);
        return NextResponse.json({ error: "No se pudo registrar el participante" }, { status: 500 });
      }
    } else if (existing.payment_status === "approved") {
      return NextResponse.json({ error: "Ya pagaste esta polla" }, { status: 400 });
    } else {
      await admin
        .from("polla_participants")
        .update({ status: "approved", payment_status: "pending", paid: false })
        .eq("id", existing.id);
    }

    const reference = `${slug}-${user.id.replace(/-/g, "").substring(0, 8)}`;
    const amountCents = polla.buy_in_amount * 100;
    // Wompi requires an absolute URL for redirect-url — fall back to the
    // production host if NEXT_PUBLIC_APP_URL isn't configured.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://la-polla.vercel.app";
    const redirectUrl = `${appUrl}/pollas/${slug}?payment=success`;

    const checkoutUrl = buildWompiCheckoutUrl({
      reference,
      amountCents,
      currency: polla.currency || "COP",
      redirectUrl,
    });

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    console.error("Error creando checkout Wompi:", error);
    return NextResponse.json({ error: "Error generando el checkout" }, { status: 500 });
  }
}
