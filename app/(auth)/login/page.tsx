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
import { getPollaBySlug } from "@/lib/casa/queries";
import LoginClient from "./LoginClient";

// The label and start-otp must read the same server-side rollout setting.
export const dynamic = "force-dynamic";

/**
 * «Vas a entrar a <polla>» (informe de participación, 2026-10-29): solo con un
 * returnTo a /polla/<slug> de una polla publicada. Nombre y entrada son lo que
 * ya muestra la página pública de la polla; si la lectura falla, no hay tarjeta.
 */
async function pollaDestino(returnTo: string | string[] | undefined) {
  const slug = typeof returnTo === "string" ? /^\/polla\/([a-z0-9-]{1,80})(?:\/pagar)?(?:[?#].*)?$/i.exec(returnTo)?.[1] : undefined;
  if (!slug) return null;
  const polla = await getPollaBySlug(slug).catch(() => null);
  if (!polla || polla.status === "anulada") return null;
  return { name: polla.name, entryCop: polla.entry_price_cop };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? "").trim() || null;
  const destino = await pollaDestino((await searchParams).returnTo);
  return (
    <LoginClient
      passwordLoginEnabled={phonePasswordEnabled()}
      whatsappLoginHref={getWhatsAppLoginHref()}
      deliveryChannel={phoneOtpChannel()}
      telegramBotUsername={null}
      turnstileSiteKey={turnstileSiteKey}
      smsCaptchaRequired={Boolean(turnstileSiteKey) && isSmsCaptchaEnforced()}
      pollaDestino={destino}
    />
  );
}
