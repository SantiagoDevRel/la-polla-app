// lib/sms/paises.ts — Países a los que La Polla envía SMS (decisión del dueño,
// 2026-09-17). El selector de /login solo ofrece estos, /api/auth/start-otp
// rechaza los demás antes de que Supabase genere el código, y sendSms no
// despacha a ningún otro destino: así ningún camino gasta créditos afuera.
//
// Por qué una lista cerrada: LabsMobile cobra por destino y un SMS a Venezuela
// o Europa vale 23–49 veces uno a Colombia. Con la lista abierta, pedir códigos
// a números extranjeros vaciaba el saldo en pocas decenas de envíos.
//
// El país se deduce con libphonenumber-js y no por el prefijo: +1 lo comparten
// Estados Unidos, Canadá y el Caribe, y solo Estados Unidos está permitido.

import { parsePhoneNumberFromString } from "libphonenumber-js/min";

export const PAISES_SMS = ["CO", "US", "PA", "AR", "PE", "CL", "BR", "EC", "ES"] as const;

export type PaisSms = (typeof PAISES_SMS)[number];

const PERMITIDOS = new Set<string>(PAISES_SMS);

/** País permitido del número (con o sin "+"), o null si no se puede enviar. */
export function paisSmsPermitido(phone: string): PaisSms | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const country = parsePhoneNumberFromString(`+${digits}`)?.country;
  return country && PERMITIDOS.has(country) ? (country as PaisSms) : null;
}
