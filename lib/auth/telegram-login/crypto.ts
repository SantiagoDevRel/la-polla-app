// lib/auth/telegram-login/crypto.ts — Secretos del login por Telegram.
//
// - Código: 6 dígitos con randomInt (CSPRNG, sin sesgo de módulo).
// - Enlace: 32 bytes aleatorios en base64url (43 caracteres).
// - En la base solo viven HMAC-SHA256 con un pepper del servidor. El pepper se
//   deriva del token del bot con una etiqueta de dominio: no hace falta otra
//   variable, nunca está en la base y quien filtre la tabla no puede probar el
//   millón de códigos sin él. Rotar el token del bot invalida los códigos vivos
//   (duran 10 minutos), nada más.
// - El hash del código incluye el teléfono: un código solo sirve para su número.

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const PEPPER_LABEL = "la-polla/telegram-login/pepper/v1";

export const LOGIN_CODE_RE = /^\d{6}$/;
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const LOGIN_TOKEN_TTL_SECONDS = 600;

function pepper(botToken: string): Buffer {
  return createHmac("sha256", botToken).update(PEPPER_LABEL).digest();
}

export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashLoginCode(
  botToken: string,
  phoneE164: string,
  code: string,
): string {
  return createHmac("sha256", pepper(botToken))
    .update(`code|${phoneE164}|${code}`)
    .digest("hex");
}

export function hashLinkToken(botToken: string, token: string): string {
  return createHmac("sha256", pepper(botToken))
    .update(`link|${token}`)
    .digest("hex");
}

/**
 * Compara el header X-Telegram-Bot-Api-Secret-Token en tiempo constante.
 * Se comparan digests de longitud fija para no filtrar ni la longitud.
 */
export function secretHeaderMatches(
  given: string | null | undefined,
  expected: string,
): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
