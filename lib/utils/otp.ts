// lib/utils/otp.ts — Generación y validación de códigos OTP para autenticación por WhatsApp

// Almacenamiento temporal en memoria (en producción usar Redis o Supabase)
const otpStore = new Map<string, { code: string; expiresAt: number }>();

/**
 * Genera un código OTP de 6 dígitos para un número de teléfono.
 */
export async function generateOTP(phoneNumber: string): Promise<string> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutos

  otpStore.set(phoneNumber, { code, expiresAt });

  return code;
}

/**
 * Valida un código OTP para un número de teléfono.
 */
export async function validateOTP(
  phoneNumber: string,
  code: string
): Promise<boolean> {
  const stored = otpStore.get(phoneNumber);

  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(phoneNumber);
    return false;
  }
  if (stored.code !== code) return false;

  otpStore.delete(phoneNumber);
  return true;
}
