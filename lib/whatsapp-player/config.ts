// lib/whatsapp-player/config.ts — Configuración del bot de jugadores por
// WhatsApp (OpenWA en el DGX + relay firmado). Apagado por defecto.
//
//   WHATSAPP_OPENWA_BOT_ENABLED=true   enciende la ruta y los avisos.
//   WHATSAPP_OPENWA_RELAY_SECRET       secreto compartido con el relay (≥ 32).
//   WHATSAPP_OPENWA_ALLOWED_PHONES     opcional: lista de números (dígitos,
//                                      separados por coma). Si existe, el bot
//                                      solo responde a esos números: sirve
//                                      para probar en producción sin abrirlo.

export interface WhatsAppBotConfig {
  relaySecret: string;
  allowedPhones: ReadonlySet<string> | null;
}

export const PHONE_RE = /^[1-9][0-9]{7,14}$/;

export function getWhatsAppBotConfig(env: Record<string, string | undefined> = process.env): WhatsAppBotConfig | null {
  if (env.WHATSAPP_OPENWA_BOT_ENABLED !== "true") return null;
  const relaySecret = env.WHATSAPP_OPENWA_RELAY_SECRET ?? "";
  if (relaySecret.length < 32) return null;
  const phones = (env.WHATSAPP_OPENWA_ALLOWED_PHONES ?? "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter((p) => PHONE_RE.test(p));
  return { relaySecret, allowedPhones: phones.length > 0 ? new Set(phones) : null };
}

export function phoneAllowed(config: WhatsAppBotConfig, phone: string): boolean {
  return !config.allowedPhones || config.allowedPhones.has(phone);
}
