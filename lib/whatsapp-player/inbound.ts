// lib/whatsapp-player/inbound.ts — Clasifica un evento de OpenWA. Función pura.
//
// El relay reenvía el sobre del webhook de OpenWA tal cual (message.received),
// con la imagen en data.media.data cuando pesa hasta 3 MB. Reglas:
//   - Solo chats individuales: nada de grupos, estados, canales ni difusión.
//   - Nunca mensajes propios (fromMe).
//   - El número sale del remitente que WhatsApp verificó: «57300…@c.us», o el
//     senderPhone que OpenWA resuelve para un id privado («…@lid»). Un número
//     escrito en el texto o un contacto compartido NUNCA identifican a nadie.
//   - Mensajes viejos (OpenWA entrega el atraso al reconectar) se ignoran.
// Texto, imagen e id son DATO: se comparan con formatos conocidos.

import { z } from "zod";
import { PHONE_RE } from "./config";

/** 3 MB decodificados: base64 + sobre caben en el límite de 4,5 MB de Vercel. */
export const MAX_WHATSAPP_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_MESSAGE_AGE_S = 30 * 60;

const mediaSchema = z.object({
  mimetype: z.string().max(100).optional().nullable(),
  data: z.string().max(4_200_000).optional().nullable(),
  omitted: z.boolean().optional().nullable(),
  sizeBytes: z.number().optional().nullable(),
});

const envelopeSchema = z.object({
  event: z.string().max(64),
  data: z.object({
    id: z.string().min(1).max(200),
    from: z.string().min(1).max(200),
    chatId: z.string().max(200).optional().nullable(),
    body: z.string().max(10_000).optional().nullable(),
    type: z.string().max(40).optional().nullable(),
    timestamp: z.number(),
    isGroup: z.boolean().optional().nullable(),
    kind: z.string().max(40).optional().nullable(),
    fromMe: z.boolean().optional().nullable(),
    senderPhone: z.string().max(40).optional().nullable(),
    media: mediaSchema.optional().nullable(),
  }),
});

export type WhatsAppMedia =
  | { kind: "inline"; base64: string; mimetype: string | null; bytes: number; source: "photo" | "document" }
  | { kind: "too_large" };

export type WhatsAppInbound =
  | { kind: "ignore"; reason: string }
  /** Id privado (@lid) sin número resuelto: no se puede saber de quién es la cuenta. */
  | { kind: "unverified"; messageId: string; replyTo: string }
  | {
      kind: "message";
      messageId: string;
      phone: string;
      replyTo: string;
      text: string | null;
      media: WhatsAppMedia | null;
      /** Audio, video, sticker, ubicación, documento que no es imagen… */
      otherMedia: boolean;
    };

const INDIVIDUAL_JID = /^([1-9][0-9]{7,14})@c\.us$/;
const LID_JID = /^[0-9]{1,40}@lid$/;

/** Bytes que representa un base64 (sin decodificarlo). */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export function classifyOpenWaEvent(payload: unknown, nowMs: number): WhatsAppInbound {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) return { kind: "ignore", reason: "invalid" };
  const { event, data } = parsed.data;
  if (event !== "message.received") return { kind: "ignore", reason: "event" };
  if (data.fromMe) return { kind: "ignore", reason: "from_me" };
  if (data.isGroup || (data.kind && data.kind !== "individual")) return { kind: "ignore", reason: "not_individual" };
  const replyTo = data.chatId || data.from;
  if (!/@(c\.us|lid)$/.test(replyTo)) return { kind: "ignore", reason: "not_individual" };
  const ageS = Math.floor(nowMs / 1000) - data.timestamp;
  if (ageS > MAX_MESSAGE_AGE_S || ageS < -300) return { kind: "ignore", reason: "stale" };

  let phone: string | null = INDIVIDUAL_JID.exec(data.from)?.[1] ?? null;
  if (!phone) {
    if (!LID_JID.test(data.from)) return { kind: "ignore", reason: "not_individual" };
    const resolved = (data.senderPhone ?? "").replace(/\D/g, "");
    if (!PHONE_RE.test(resolved)) return { kind: "unverified", messageId: data.id, replyTo };
    phone = resolved;
  }

  const type = (data.type ?? "").toLowerCase();
  const mime = data.media?.mimetype?.toLowerCase() ?? null;
  const isImage = type === "image" || (type === "document" && Boolean(mime?.startsWith("image/")));
  let media: WhatsAppMedia | null = null;
  let otherMedia = false;
  if (isImage) {
    if (data.media?.data) {
      const bytes = base64Bytes(data.media.data);
      media = bytes > MAX_WHATSAPP_MEDIA_BYTES
        ? { kind: "too_large" }
        : { kind: "inline", base64: data.media.data, mimetype: mime, bytes, source: type === "image" ? "photo" : "document" };
    } else {
      // OpenWA no la incluyó (más pesada que su tope o sin descargar).
      media = { kind: "too_large" };
    }
  } else if (type && type !== "text" && type !== "chat") {
    otherMedia = true;
  }

  // El pie de foto de un comprobante no es un comando ni una respuesta.
  const text = media || otherMedia ? null : (data.body ?? "").trim().slice(0, 500) || null;
  if (!text && !media && !otherMedia) return { kind: "ignore", reason: "empty" };
  return { kind: "message", messageId: data.id, phone, replyTo, text, media, otherMedia };
}
