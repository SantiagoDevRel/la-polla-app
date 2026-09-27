// Legacy WhatsApp features are retained as code, but cannot send messages.
// Login OTP delivery is isolated in lib/auth/whatsapp-otp.ts.
export function whatsappOutboundEnabled(): boolean {
  // Owner decision 2026-09-27: WhatsApp only delivers six-digit login OTPs.
  // Legacy menus, predictions and notifications must never be reactivated by
  // an old environment variable. OTP uses lib/auth/whatsapp-otp.ts separately.
  return false;
}

export const WHATSAPP_OUTBOUND_DISABLED = "WhatsApp outbound disabled";
