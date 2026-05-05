// lib/whatsapp/media.ts — Download de media files de Meta WhatsApp Cloud API.
//
// Cuando un user manda una foto, el webhook recibe el `media_id` (no el
// archivo directo). Para acceder al binario:
//   1. GET https://graph.facebook.com/v21.0/<media_id> con Bearer token
//      → devuelve { url: "https://lookaside.fbsbx.com/..." }
//   2. GET esa URL con el mismo Bearer token → devuelve el binario.
//
// Las URLs son one-time y expiran en ~5 minutos. No las guardes — bajalo
// de una y persistilo en Storage.

const GRAPH_API_VERSION = "v21.0";

export interface MediaDownload {
  buffer: Buffer;
  mediaType: string; // ej "image/jpeg"
  size: number;
}

export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<MediaDownload> {
  const token = process.env.META_WA_ACCESS_TOKEN;
  if (!token) {
    throw new Error("META_WA_ACCESS_TOKEN missing");
  }

  // Step 1: meta info → URL temporal
  const metaResp = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!metaResp.ok) {
    const text = await metaResp.text().catch(() => "");
    throw new Error(`media meta fetch ${metaResp.status}: ${text.slice(0, 200)}`);
  }
  const meta = (await metaResp.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  };
  if (!meta.url) {
    throw new Error("media meta missing url");
  }

  // Step 2: download binary
  const binResp = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!binResp.ok) {
    throw new Error(`media binary fetch ${binResp.status}`);
  }
  const arr = await binResp.arrayBuffer();
  const buffer = Buffer.from(arr);

  return {
    buffer,
    mediaType: meta.mime_type ?? binResp.headers.get("content-type") ?? "application/octet-stream",
    size: meta.file_size ?? buffer.length,
  };
}
