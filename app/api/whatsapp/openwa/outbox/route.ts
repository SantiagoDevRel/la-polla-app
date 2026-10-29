// app/api/whatsapp/openwa/outbox/route.ts — Avisos pendientes del bot de
// WhatsApp (pago confirmado o rechazado, cupo de regalo).
//
// El relay del DGX llama cada pocos segundos:
//   {"action":"claim","limit":10}                → avisos para enviar
//   {"action":"ack","id":"<uuid>","ok":true}     → enviado (o falló, ok:false)
// Misma seguridad que /api/whatsapp/openwa: apagado → 404; firma HMAC del relay
// con timestamp antes de parsear → 401. Reclamar y confirmar son funciones SQL
// (migración 176); reclamar también limpia lo vencido.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppBotConfig } from "@/lib/whatsapp-player/config";
import { RELAY_SIGNATURE_HEADER, RELAY_TIMESTAMP_HEADER, verifyRelaySignature } from "@/lib/whatsapp-player/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), limit: z.number().int().min(1).max(20).optional() }),
  z.object({ action: z.literal("ack"), id: z.uuid(), ok: z.boolean(), error: z.string().max(300).optional() }),
]);

export async function POST(request: NextRequest) {
  const config = getWhatsAppBotConfig();
  if (!config) return new NextResponse(null, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length")) > 4096) return new NextResponse(null, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 4096) return new NextResponse(null, { status: 413, headers: NO_STORE });
  if (!verifyRelaySignature(
    config.relaySecret,
    request.headers.get(RELAY_TIMESTAMP_HEADER),
    request.headers.get(RELAY_SIGNATURE_HEADER),
    raw,
    Date.now(),
  )) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  let parsed;
  try {
    parsed = bodySchema.safeParse(JSON.parse(raw));
  } catch {
    return new NextResponse(null, { status: 400, headers: NO_STORE });
  }
  if (!parsed.success) return new NextResponse(null, { status: 400, headers: NO_STORE });

  const db = createAdminClient();
  if (parsed.data.action === "claim") {
    const { data, error } = await db.rpc("whatsapp_bot_claim_outbox", { p_limit: parsed.data.limit ?? 10 });
    if (error) {
      console.error("[whatsapp-player] avisos no reclamados:", error.code);
      return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
    }
    const messages = ((data ?? []) as Array<{ id: string; phone: string; body: string }>)
      .map((m) => ({ id: m.id, to: `${m.phone}@c.us`, text: m.body }));
    return NextResponse.json({ messages }, { headers: NO_STORE });
  }
  const { data, error } = await db.rpc("whatsapp_bot_ack_outbox", {
    p_id: parsed.data.id, p_ok: parsed.data.ok, p_error: parsed.data.error ?? null,
  });
  if (error) {
    console.error("[whatsapp-player] aviso no confirmado:", error.code);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: data === true }, { headers: NO_STORE });
}
