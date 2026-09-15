// lib/telegram-player/ids.ts — Datos de los botones del bot de jugadores.
//
// Telegram limita callback_data a 64 BYTES. Un uuid con guiones son 36, así que
// dos no caben con un prefijo. Se mandan los 16 bytes del uuid en base64url (22
// caracteres): polla + partido + opción entran con holgura.
//
// callback_data llega del cliente de Telegram: es DATO NO CONFIABLE. Todo se
// decodifica con formato estricto y después se vuelve a validar contra la base
// (que la polla sea visible, que el partido sea de esa polla, etc.).

import { createHash } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_RE = /^[A-Za-z0-9_-]{22}$/;

export const CALLBACK_MAX_BYTES = 64;

/** uuid → 22 caracteres base64url. */
export function shortId(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error("uuid inválido");
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

/** 22 caracteres base64url → uuid en minúsculas, o null. */
export function longId(short: string | undefined): string | null {
  if (!short || !SHORT_RE.test(short)) return null;
  const bytes = Buffer.from(short, "base64url");
  if (bytes.length !== 16 || bytes.toString("base64url") !== short) return null;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Arma callback_data y falla si pasa de 64 bytes (error de programación). */
export function cb(...parts: Array<string | number>): string {
  const data = parts.join(":");
  if (Buffer.byteLength(data, "utf8") > CALLBACK_MAX_BYTES) throw new Error(`callback_data demasiado largo: ${parts[0]}`);
  return data;
}

/** Marca de callback_data: la pantalla va en un mensaje NUEVO (no edita el del botón). */
export const NEW_MESSAGE_MARK = "!";

/**
 * Igual que cb(), pero el botón abre su pantalla en un mensaje nuevo. Para
 * botones de mensajes que la persona tiene que poder releer después
 * («Recibimos tu comprobante», «Confirmamos tu pago»): si el toque editara ese
 * mensaje, la confirmación desaparecería del chat.
 */
export function cbNew(...parts: Array<string | number>): string {
  return cb(`${NEW_MESSAGE_MARK}${parts[0]}`, ...parts.slice(1));
}

/**
 * uuid estable a partir de un texto (sha256 con los bits de versión 4/variante):
 * el mismo comprobante reenviado o un update que Telegram reintenta vuelven al
 * mismo intento de carga en vez de crear otro.
 */
export function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
