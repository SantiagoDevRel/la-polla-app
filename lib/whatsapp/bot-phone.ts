// lib/whatsapp/bot-phone.ts — Single source of truth for the bot's public
// WhatsApp number. Used by login UI, /verify page, and the WhatsApp
// floating bubble. Reads from NEXT_PUBLIC_WHATSAPP_BOT_NUMBER (no plus,
// no spaces) and falls back to the production number so dev/preview
// builds without the env still work.
//
// To override per environment, set:
//   NEXT_PUBLIC_WHATSAPP_BOT_NUMBER=573117312391

const FALLBACK_BOT_PHONE = "573117312391";

export const BOT_PHONE: string =
  (process.env.NEXT_PUBLIC_WHATSAPP_BOT_NUMBER ?? "").trim() ||
  FALLBACK_BOT_PHONE;

// Build a wa.me deep link to the bot with a pre-filled message. The text
// is URL-encoded so the user lands in the chat with the message already
// typed; the bot answers with the main menu regardless of the exact
// wording (see lib/whatsapp/flows.ts greeting handler).
export function botDeepLink(prefilledText: string = "hola parce"): string {
  const phone = BOT_PHONE;
  const text = encodeURIComponent(prefilledText);
  return `https://wa.me/${phone}?text=${text}`;
}
