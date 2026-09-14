// lib/auth/telegram-login/deep-link.ts — Enlace profundo al bot de login.
// Puro y sin variables de entorno.
//
// v2: el parámetro start lleva el nonce de la solicitud del navegador (43
// caracteres base64url; Telegram admite hasta 64 de [A-Za-z0-9_-]). El idioma y
// el dominio viajan en la solicitud, no en el enlace.

import { NONCE_RE } from "./crypto";

export function telegramLoginDeepLink(botUsername: string, nonce: string): string {
  if (!NONCE_RE.test(nonce)) throw new Error("nonce inválido para el deep link");
  return `https://t.me/${encodeURIComponent(botUsername)}?start=${nonce}`;
}
