// lib/whatsapp-player/signature.ts — Firma entre el relay del DGX y la app.
//
// El relay firma cada solicitud con HMAC-SHA256 sobre «<timestamp>.<cuerpo>»
// (cuerpo exacto, sin parsear). La app rechaza firmas inválidas y timestamps a
// más de 5 minutos: una solicitud capturada no se puede repetir después. Los
// reintentos dentro de la ventana los frena el id del mensaje (whatsapp_bot_
// inbound) y el estado de cada aviso (whatsapp_bot_outbox).

import { createHmac, timingSafeEqual } from "node:crypto";

export const RELAY_TIMESTAMP_HEADER = "x-lapolla-timestamp";
export const RELAY_SIGNATURE_HEADER = "x-lapolla-signature";
export const RELAY_MAX_SKEW_S = 300;

export function signRelayBody(secret: string, timestamp: number, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function verifyRelaySignature(
  secret: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  rawBody: string,
  nowMs: number,
): boolean {
  if (!timestampHeader || !signatureHeader || !/^\d{9,11}$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  if (Math.abs(Math.floor(nowMs / 1000) - timestamp) > RELAY_MAX_SKEW_S) return false;
  const expected = Buffer.from(signRelayBody(secret, timestamp, rawBody));
  const received = Buffer.from(signatureHeader);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
