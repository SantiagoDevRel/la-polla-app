// app/api/whatsapp/webhook/route.ts — Webhook para recibir mensajes entrantes de Meta Cloud API (WhatsApp)
import { NextRequest, NextResponse } from "next/server";
import { processIncomingMessage, type IncomingMessage } from "@/lib/whatsapp/bot";
import { redactPhone } from "@/lib/log";
import { createHmac, timingSafeEqual } from "crypto";

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

// Recepción de mensajes (POST) — with signature verification
export async function POST(request: NextRequest) {
  try {
    // Step 1: read raw body as text (must happen before any parsing)
    const rawBody = await request.text();

    // Step 2: verify X-Hub-Signature-256 from Meta
    const appSecret = process.env.META_WA_APP_SECRET;

    if (appSecret) {
      const signature = request.headers.get("x-hub-signature-256");

      if (!signature) {
        console.warn("[Webhook POST] Missing X-Hub-Signature-256 — rejected");
        return new NextResponse("Forbidden", { status: 403 });
      }

      const expectedSignature =
        "sha256=" +
        createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (
        sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        console.warn("[Webhook POST] Signature mismatch — rejected");
        return new NextResponse("Forbidden", { status: 403 });
      }
    } else {
      // META_WA_APP_SECRET not configured — log warning but allow (for development)
      console.warn(
        "[Webhook POST] META_WA_APP_SECRET not set — skipping signature verification"
      );
    }

    // Step 3: parse verified body
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new NextResponse("Bad Request", { status: 400 });
    }

    // Step 4: validate this is a WhatsApp Business payload
    if (body.object !== "whatsapp_business_account") {
      // Not a WhatsApp payload — Meta sends test pings, acknowledge silently
      return NextResponse.json({ status: "ok" });
    }

    console.log("[Webhook POST] body keys:", Object.keys(body));

    // Step 5: extract and process message (same logic as before)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = (body as any).entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      console.log(
        "[Webhook POST] message from:",
        redactPhone(message.from),
        "type:",
        message.type,
      );
      await processIncomingMessage({
        from: message.from,
        type: message.type,
        text: message.text,
        interactive: message.interactive,
        wa_message_id: message.id,
      } as IncomingMessage);
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
