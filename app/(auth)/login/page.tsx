// app/(auth)/login/page.tsx — Server wrapper del login.
// Ofrece SMS, contraseña opcional y WhatsApp según configuración del servidor.
// Telegram permanece oculto por decisión del dueño; su backend se conserva.
// Toda la UI vive en LoginClient.tsx. NEXT_PUBLIC_* queda incrustado en el
// build: activar o cambiar el bot exige redeploy.
//
// Captcha del SMS: la site key PÚBLICA de Cloudflare Turnstile
// (NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY). Sin ella no se monta el widget.
// Con SMS_CAPTCHA_ENFORCED=true start-otp verifica el token con
// CLOUDFLARE_TURNSTILE_SECRET_KEY y el cliente ya no envía sin token.
// README → «Captcha de Auth (Turnstile)».
import { isSmsCaptchaEnforced } from "@/lib/auth/captcha";
import { phoneOtpChannel } from "@/lib/auth/phone-otp-channel";
import { phonePasswordEnabled } from "@/lib/auth/password-config";
import { getWhatsAppLoginHref } from "@/lib/auth/whatsapp-login";
import LoginClient from "./LoginClient";

// The label and start-otp must read the same server-side rollout setting.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? "").trim() || null;
  return (
    <LoginClient
      passwordLoginEnabled={phonePasswordEnabled()}
      whatsappLoginHref={getWhatsAppLoginHref()}
      deliveryChannel={phoneOtpChannel()}
      telegramBotUsername={null}
      turnstileSiteKey={turnstileSiteKey}
      smsCaptchaRequired={Boolean(turnstileSiteKey) && isSmsCaptchaEnforced()}
    />
  );
}
