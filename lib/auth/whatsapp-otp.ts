import { createHash } from "node:crypto";
import { phoneOtpChannel, whatsappOtpConfigured } from "./phone-otp-channel";

// Fixed AUTHENTICATION template: never reuse marketing/utility templates.
export const WHATSAPP_OTP_TEMPLATE = "lp_login_otp";
const API = "https://zernio.com/api/v1";
type SendResult = { ok: true } | { ok: false; reason: "config" | "input" | "template" | "provider" };

/** Only delivers the six digits Supabase generated. No OTP storage or validation here. */
export async function sendWhatsAppOtp(phone: string, otp: string, webhookId: string): Promise<SendResult> {
  if (phoneOtpChannel() !== "whatsapp" || !whatsappOtpConfigured()) {
    return { ok: false, reason: "config" };
  }
  if (!/^[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(otp) || !webhookId) {
    return { ok: false, reason: "input" };
  }
  const accountId = process.env.ZERNIO_WHATSAPP_ACCOUNT_ID!;
  const headers = { Authorization: `Bearer ${process.env.ZERNIO_API_KEY!.trim()}` };
  // Supabase HTTP hooks have a short deadline. Do not retry ambiguous sends.
  const signal = AbortSignal.timeout(4500);
  try {
    const lookup = await fetch(`${API}/whatsapp/templates?${new URLSearchParams({
      accountId, name: WHATSAPP_OTP_TEMPLATE, language: "es",
    })}`, { headers, signal, cache: "no-store", redirect: "error" });
    if (!lookup.ok) return { ok: false, reason: "template" };
    const definition = await lookup.json();
    const template = definition.templates?.find((item: { name: string; language: string }) =>
      item.name === WHATSAPP_OTP_TEMPLATE && item.language === "es");
    if (template?.status !== "APPROVED" || template.category !== "AUTHENTICATION") {
      return { ok: false, reason: "template" };
    }
    const response = await fetch(`${API}/inbox/conversations`, {
      method: "POST", signal, cache: "no-store", redirect: "error",
      headers: {
        ...headers, "Content-Type": "application/json",
        "Idempotency-Key": `lp-otp-${createHash("sha256").update(webhookId).digest("hex")}`,
      },
      body: JSON.stringify({
        accountId, participantId: phone,
        templateName: WHATSAPP_OTP_TEMPLATE, templateLanguage: "es",
        // AUTHENTICATION COPY_CODE is represented by Meta as a dynamic URL
        // button: body code first, then the identical button code.
        templateParams: [otp, otp],
      }),
    });
    if (!response.ok) return { ok: false, reason: "provider" };
    const data = await response.json();
    return data.success === true && typeof data.data?.messageId === "string"
      ? { ok: true } : { ok: false, reason: "provider" };
  } catch {
    // Provider bodies/errors can contain phone numbers or codes. Never log them.
    return { ok: false, reason: "provider" };
  }
}
