import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppBotConfig } from "@/lib/whatsapp-player/config";
import { pollSentSchema } from "@/lib/whatsapp-player/poll-votes";
import { RELAY_SIGNATURE_HEADER, RELAY_TIMESTAMP_HEADER, verifyRelaySignature } from "@/lib/whatsapp-player/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const config = getWhatsAppBotConfig();
  if (!config) return new NextResponse(null, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length")) > 4096) return new NextResponse(null, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 4096) return new NextResponse(null, { status: 413, headers: NO_STORE });
  if (!verifyRelaySignature(config.relaySecret, request.headers.get(RELAY_TIMESTAMP_HEADER), request.headers.get(RELAY_SIGNATURE_HEADER), raw, Date.now())) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  let parsed;
  try { parsed = pollSentSchema.safeParse(JSON.parse(raw)); }
  catch { return new NextResponse(null, { status: 400, headers: NO_STORE }); }
  if (!parsed.success) return new NextResponse(null, { status: 400, headers: NO_STORE });
  try {
    const { data, error } = await createAdminClient().rpc("whatsapp_bot_register_poll", {
      p_poll_message_id: parsed.data.pollMessageId, p_chat_id: parsed.data.chatId, p_nonce: parsed.data.nonce,
    });
    if (error) throw new Error("poll_registration_failed");
    return NextResponse.json({ ok: data === true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
