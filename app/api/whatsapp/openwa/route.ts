// app/api/whatsapp/openwa/route.ts — Mensajes del bot de jugadores por WhatsApp.
//
// Quien llama es el relay del DGX (ops/whatsapp-openwa/relay.mjs), que recibe
// los webhooks de OpenWA y envía por OpenWA las respuestas que devuelve esta
// ruta. La lógica está en lib/whatsapp-player/handler.ts.
//
// Orden de seguridad:
//   1. Apagado (sin WHATSAPP_OPENWA_BOT_ENABLED=true y secreto) → 404, sin leer
//      el body ni tocar la base.
//   2. Firma HMAC del relay sobre el body exacto, con timestamp a ±5 minutos,
//      ANTES de parsear → 401 si no coincide.
//   3. Solo después se parsea el evento.
//
// Exenta del gate de sesión en lib/supabase/middleware.ts: quien llama es el
// relay, no un navegador.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppBotConfig } from "@/lib/whatsapp-player/config";
import { handleWhatsAppEvent } from "@/lib/whatsapp-player/handler";
import { RELAY_SIGNATURE_HEADER, RELAY_TIMESTAMP_HEADER, verifyRelaySignature } from "@/lib/whatsapp-player/signature";
import { whatsappWebLink } from "@/lib/whatsapp-player/web-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Un comprobante se guarda, se sube y se verifica antes de responder.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };
// Imagen de hasta 3 MB en base64 + sobre de OpenWA (límite de Vercel: 4,5 MB).
const MAX_BODY_BYTES = 4_400_000;

export async function POST(request: NextRequest) {
  const config = getWhatsAppBotConfig();
  if (!config) return new NextResponse(null, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413, headers: NO_STORE });
  if (!verifyRelaySignature(
    config.relaySecret,
    request.headers.get(RELAY_TIMESTAMP_HEADER),
    request.headers.get(RELAY_SIGNATURE_HEADER),
    raw,
    Date.now(),
  )) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ outcome: "ignored", replies: [] }, { headers: NO_STORE });
  }
  try {
    const db = createAdminClient();
    const result = await handleWhatsAppEvent(payload, { db, config, webLink: (phone) => whatsappWebLink(db, phone) });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    // Sin números, textos ni errores del proveedor en los logs.
    console.error("[whatsapp-player] evento no procesado:", (err as Error).name);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
