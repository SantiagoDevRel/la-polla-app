// app/api/whatsapp/webhook/route.ts — Webhook para recibir mensajes entrantes de Meta Cloud API (WhatsApp)
import { NextRequest, NextResponse } from "next/server";
import { processIncomingMessage } from "@/lib/whatsapp/bot";

export const dynamic = "force-dynamic";

// Verificación del webhook (GET) - Meta envía un challenge para validar
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.META_WA_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === expectedToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Token inválido" }, { status: 403 });
}

// Recepción de mensajes (POST)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("[Webhook POST] body keys:", Object.keys(body));

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      console.log("[Webhook POST] message from:", message.from, "type:", message.type);
      await processIncomingMessage({
        from: message.from,
        type: message.type,
        text: message.text,
        interactive: message.interactive,
        wa_message_id: message.id,
      });
      console.log("[Webhook POST] processIncomingMessage completed");
    } else {
      console.log("[Webhook POST] no message in payload — status update or other event");
    }

    return NextResponse.json({ status: "ok" });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Webhook POST] ERROR:", err.message);
    console.error("[Webhook POST] Stack:", err.stack);
    return NextResponse.json(
      { error: "Error interno", detail: err.message },
      { status: 500 }
    );
  }
}
