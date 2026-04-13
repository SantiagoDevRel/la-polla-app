// app/api/webhooks/wompi/route.ts — Recibe eventos de Wompi y aprueba participantes.
// Verifica x-event-checksum con WOMPI_EVENTS_KEY (distinto de WOMPI_INTEGRITY_KEY,
// que solo firma URLs de checkout salientes).
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

interface WompiTransaction {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
}

interface WompiEvent {
  event: string;
  data: { transaction: WompiTransaction };
}

export async function POST(request: NextRequest) {
  const eventsKey = process.env.WOMPI_EVENTS_KEY;
  if (!eventsKey) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const checksum = request.headers.get("x-event-checksum") || "";

  const expected = crypto
    .createHash("sha256")
    .update(rawBody + eventsKey)
    .digest("hex");

  if (expected !== checksum) {
    console.error("[wompi] Invalid signature", { checksum });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: WompiEvent;
  try {
    event = JSON.parse(rawBody) as WompiEvent;
  } catch (err) {
    console.error("[wompi] Invalid JSON body", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    event.event === "transaction.updated" &&
    event.data?.transaction?.status === "APPROVED"
  ) {
    const reference = event.data.transaction.reference;
    const parts = reference.split("-");
    const userIdPrefix = parts[parts.length - 1];
    const slug = parts.slice(0, -1).join("-");

    const adminSupabase = createAdminClient();

    const { data: polla } = await adminSupabase
      .from("pollas")
      .select("id, prize_pool, buy_in_amount")
      .eq("slug", slug)
      .single();

    if (!polla) return NextResponse.json({ ok: true });

    const { data: participants } = await adminSupabase
      .from("polla_participants")
      .select("id, user_id")
      .eq("polla_id", polla.id)
      .eq("status", "pending_payment");

    const participant = participants?.find((p) =>
      p.user_id.replace(/-/g, "").startsWith(userIdPrefix)
    );

    if (participant) {
      await adminSupabase
        .from("polla_participants")
        .update({ status: "approved", paid: true })
        .eq("id", participant.id);

      await adminSupabase
        .from("pollas")
        .update({
          prize_pool: (polla.prize_pool || 0) + (polla.buy_in_amount || 0),
        })
        .eq("id", polla.id);
    }
  }

  // Always 200 — Wompi retries on non-200
  return NextResponse.json({ ok: true });
}
