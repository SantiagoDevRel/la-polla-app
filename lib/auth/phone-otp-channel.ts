// One server-controlled delivery channel for Supabase Phone Auth.
// Keep the switch off until the AUTHENTICATION template and a real login pass.
export type PhoneOtpChannel = "sms" | "whatsapp";

export function phoneOtpChannel(): PhoneOtpChannel {
  return process.env.WHATSAPP_OTP_ENABLED === "true" ? "whatsapp" : "sms";
}

export function whatsappOtpConfigured(): boolean {
  return Boolean(
    process.env.ZERNIO_API_KEY?.trim() &&
    /^[a-f0-9]{24}$/.test(process.env.ZERNIO_WHATSAPP_ACCOUNT_ID ?? ""),
  );
}
