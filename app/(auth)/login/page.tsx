// app/(auth)/login/page.tsx — Server wrapper del login.
// Decide en el servidor si el canal de Telegram está completo (token, secreto
// del webhook y usuario del bot) y solo entonces le pasa el usuario del bot al
// cliente, que lo usa para mostrar «Entrar con Telegram». Ningún secreto cruza
// al navegador; el deep link con el nonce lo arma /api/auth/telegram/request.
// Toda la UI vive en LoginClient.tsx. NEXT_PUBLIC_* queda incrustado en el
// build: activar o cambiar el bot exige redeploy.
//
// Facebook (2026-09-19, migración 145): FACEBOOK_LOGIN_ENABLED decide si se
// ofrece «Entrar con Facebook». El proveedor se configura en Supabase Auth, no
// acá; este flag solo muestra u oculta la opción (env + redeploy).
//
// Captcha del SMS: la site key PÚBLICA de Cloudflare Turnstile
// (NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY). Sin ella no se monta el widget.
// Con SMS_CAPTCHA_ENFORCED=true start-otp verifica el token con
// CLOUDFLARE_TURNSTILE_SECRET_KEY y el cliente ya no envía sin token.
// README → «Captcha de Auth (Turnstile)».
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { isFacebookLoginEnabled } from "@/lib/auth/facebook-login";
import { isSmsCaptchaEnforced } from "@/lib/auth/captcha";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  const telegram = getTelegramLoginConfig();
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? "").trim() || null;
  return (
    <LoginClient
      telegramBotUsername={telegram?.botUsername ?? null}
      turnstileSiteKey={turnstileSiteKey}
      smsCaptchaRequired={Boolean(turnstileSiteKey) && isSmsCaptchaEnforced()}
      facebookEnabled={isFacebookLoginEnabled()}
    />
  );
}
