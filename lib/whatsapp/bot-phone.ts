// lib/whatsapp/bot-phone.ts — Número público del bot de WhatsApp.
//
// El número que usaba La Polla ahora pertenece a otra app, así que no hay
// valor por defecto: sin NEXT_PUBLIC_WHATSAPP_BOT_NUMBER no existe enlace
// al bot. Hoy ninguna pantalla lo usa.

export const BOT_PHONE: string =
  (process.env.NEXT_PUBLIC_WHATSAPP_BOT_NUMBER ?? "").trim();

// Enlace wa.me al bot con un mensaje precargado, o null si no hay número.
export function botDeepLink(prefilledText: string = "hola"): string | null {
  if (!BOT_PHONE) return null;
  const text = encodeURIComponent(prefilledText);
  return `https://wa.me/${BOT_PHONE}?text=${text}`;
}
