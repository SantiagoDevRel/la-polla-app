// lib/whatsapp/messages.ts — Plantillas de mensajes de WhatsApp en español colombiano
export function getOTPMessage(otp: string): string {
  return `🔐 Tu código de verificación es: *${otp}*\n\nEste código vence en 5 minutos. No lo compartas con nadie.`;
}
