// app/api/webhooks/wompi/route.ts — Recibe eventos de Wompi y aprueba participantes.
//
// Wompi firma los eventos en el cuerpo (no en un header). Docs:
// https://docs.wompi.co/docs/colombia/eventos/
//   body.signature.properties: array de paths tipo "transaction.id"
//   body.signature.checksum:   SHA256( concat(values) + body.timestamp + WOMPI_EVENTS_KEY )
//
// Importante: `timestamp` en el body es un entero (segundos unix).
// WOMPI_INTEGRITY_KEY firma URLs salientes y NO debe usarse acá.
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

interface WompiSignature {
  properties: string[];
  checksum: string;
}

interface WompiEvent {
  event: string;
  data: { transaction: WompiTransaction };
  timestamp: number;
  signature: WompiSignature;
  environment?: string;
  sent_at?: string;
}

function getValueAtPath(obj: unknown, path: string): string {
  const keys = path.split(".");
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return "";
    }
  }
  return cur == null ? "" : String(cur);
}

export async function POST(request: NextRequest) {
  const eventsKey = process.env.WOMPI_EVENTS_KEY;
  if (!eventsKey) {
    console.error("[wompi] WOMPI_EVENTS_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();

  let event: WompiEvent;
  try {
    event = JSON.parse(rawBody) as WompiEvent;
  } catch (err) {
    console.error("[wompi] Invalid JSON body", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sig = event.signature;
  if (!sig?.properties || !sig?.checksum || typeof event.timestamp === "undefined") {
    console.error("[wompi] Missing signature block or timestamp");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const concatenated =
    sig.properties.map((p) => getValueAtPath(event, p)).join("") +
    String(event.timestamp) +
    eventsKey;

  const expected = crypto
    .createHash("sha256")
    .update(concatenated)
    .digest("hex");

  // Wompi returns checksum uppercase; normalize both sides to lowercase.
  if (expected.toLowerCase() !== sig.checksum.toLowerCase()) {
    console.error("[wompi] Signature mismatch", {
      expected,
      received: sig.checksum,
      properties: sig.properties,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
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

    if (!polla) {
      console.warn(`[wompi] No polla found for slug ${slug} (ref ${reference})`);
      return NextResponse.json({ ok: true });
    }

    const { data: participants } = await adminSupabase
      .from("polla_participants")
      .select("id, user_id, payment_status")
      .eq("polla_id", polla.id)
      .eq("payment_status", "pending");

    const participant = participants?.find((p) =>
      p.user_id.replace(/-/g, "").startsWith(userIdPrefix)
    );

    if (participant) {
      await adminSupabase
        .from("polla_participants")
        .update({ payment_status: "approved", paid: true })
        .eq("id", participant.id);

      await adminSupabase
        .from("pollas")
        .update({
          prize_pool: (polla.prize_pool || 0) + (polla.buy_in_amount || 0),
        })
        .eq("id", polla.id);

      console.log(
        `[wompi] Approved payment for polla ${slug} participant ${participant.id}`
      );
    } else {
      console.warn(
        `[wompi] No pending participant found for reference ${reference}`
      );
    }
  }

  // Always 200 — Wompi retries on non-200
  return NextResponse.json({ ok: true });
}
