// lib/whatsapp/messages.ts — Plantillas de mensajes de WhatsApp en español colombiano
export function getWelcomeMessage(): string {
  return `¡Hola parcero! 🇨🇴⚽\n\nBienvenido a *La Polla App*, la mejor polla deportiva de Colombia.\n\nEscribe *código* para recibir tu código de acceso.`;
}

export function getOTPMessage(otp: string): string {
  return `🔐 Tu código de verificación es: *${otp}*\n\nEste código vence en 5 minutos. No lo compartas con nadie.`;
}

export function getErrorMessage(): string {
  return `No entendí tu mensaje, parcero. 🤔\n\nEscribe *hola* para empezar o *código* para obtener tu código de acceso.`;
}

export function getMatchReminderMessage(matchInfo: string): string {
  return `⚽ ¡Ey parcero! No olvides hacer tu pronóstico.\n\n${matchInfo}\n\n¡Mucha suerte! 🍀`;
}
