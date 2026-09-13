// lib/auth/telegram-login/deep-link.ts — Enlace profundo al bot de login.
// Puro y sin variables de entorno: lo usa también el cliente de /login.
// El payload fija el idioma del chat (y el dominio del enlace de un solo uso).

export function telegramLoginDeepLink(
  botUsername: string,
  locale: "es" | "en",
): string {
  return `https://t.me/${encodeURIComponent(botUsername)}?start=${locale === "en" ? "login_en" : "login"}`;
}
