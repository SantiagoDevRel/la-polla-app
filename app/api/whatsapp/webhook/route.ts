// app/api/whatsapp/webhook/route.ts — Webhook para recibir mensajes entrantes de Meta Cloud API (WhatsApp)
import { NextRequest, NextResponse } from "next/server";
import { processIncomingMessage } from "@/lib/whatsapp/bot";

// Verificación del webhook (GET) - Meta envía un challenge para validar
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WA_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Token inválido" }, { status: 403 });
}

// Recepción de mensajes (POST)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
      await processIncomingMessage({
        from: message.from,
        type: message.type,
        text: message.text,
      });
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Error procesando webhook de WhatsApp:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
