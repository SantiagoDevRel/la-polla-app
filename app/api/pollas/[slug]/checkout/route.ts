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

    // Upsert participant in pending_payment (webhook flips to approved)
    const { data: existing } = await admin
      .from("polla_participants")
      .select("id, status")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { error: insertErr } = await admin.from("polla_participants").insert({
        polla_id: polla.id,
        user_id: user.id,
        role: "member",
        status: "pending_payment",
        paid: false,
      });
      if (insertErr) {
        return NextResponse.json({ error: "No se pudo registrar el participante" }, { status: 500 });
      }
    } else if (existing.status !== "approved" && existing.status !== "pending_payment") {
      await admin
        .from("polla_participants")
        .update({ status: "pending_payment", paid: false })
        .eq("id", existing.id);
    } else if (existing.status === "approved") {
      return NextResponse.json({ error: "Ya estás aprobado en esta polla" }, { status: 400 });
    }

    const reference = `${slug}-${user.id.replace(/-/g, "").substring(0, 8)}`;
    const amountCents = polla.buy_in_amount * 100;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const redirectUrl = `${appUrl}/pollas/${slug}?payment=result`;

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
