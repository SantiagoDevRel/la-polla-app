// lib/whatsapp/outbound.ts — Interruptor general de los envíos por WhatsApp.
//
// El número del bot ahora pertenece a otra app: La Polla no debe mandar
// mensajes desde él ni mostrárselo a nadie. Todos los envíos (texto,
// interactivos y templates) pasan por este chequeo y quedan apagados salvo
// que se configure WHATSAPP_OUTBOUND_ENABLED=true con un número propio.
export function whatsappOutboundEnabled(): boolean {
  return process.env.WHATSAPP_OUTBOUND_ENABLED === "true";
}

export const WHATSAPP_OUTBOUND_DISABLED = "WhatsApp outbound disabled";
