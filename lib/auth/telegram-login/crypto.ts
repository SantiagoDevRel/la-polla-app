// lib/auth/telegram-login/crypto.ts — Secretos del login por Telegram (v2).
//
// - Nonce del deep link: 32 bytes aleatorios en base64url (43 caracteres,
//   dentro del límite de 64 [A-Za-z0-9_-] del parámetro start de Telegram).
//   En la base, sha256.
// - Secreto del navegador (cookie lp_tg_req): 32 bytes en base64url. En la
//   base, sha256. Ambos tienen 256 bits de entropía: un hash sin pepper no se
//   puede revertir por fuerza bruta.
// - Enlace de un solo uso: 32 bytes en base64url. En la base, HMAC-SHA256 con
//   un pepper derivado del token del bot (igual que en v1): quien filtre la
//   tabla no puede ni verificar un enlace sin el token del bot.
//
// v1 (códigos de 6 dígitos) ya no existe: el bot no manda códigos.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PEPPER_LABEL = "la-polla/telegram-login/pepper/v1";

/** 32 bytes en base64url sin relleno. */
const TOKEN_43_RE = /^[A-Za-z0-9_-]{43}$/;
export const LINK_TOKEN_RE = TOKEN_43_RE;
export const NONCE_RE = TOKEN_43_RE;
export const BROWSER_SECRET_RE = TOKEN_43_RE;

/** Lo que dura una solicitud pendiente y un enlace desde que se emite. */
export const LOGIN_REQUEST_TTL_SECONDS = 300;

function pepper(botToken: string): Buffer {
  return createHmac("sha256", botToken).update(PEPPER_LABEL).digest();
}

function random43(): string {
  return randomBytes(32).toString("base64url");
}

export function generateLinkToken(): string {
  return random43();
}

export function generateNonce(): string {
  return random43();
}

export function generateBrowserSecret(): string {
  return random43();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
