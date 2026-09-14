// app/(auth)/login/page.tsx — Server wrapper del login.
// Decide en el servidor si el canal de Telegram está completo (token, secreto
// del webhook y usuario del bot) y solo entonces le pasa el usuario del bot al
// cliente, que lo usa para mostrar «Entrar con Telegram». Ningún secreto cruza
// al navegador; el deep link con el nonce lo arma /api/auth/telegram/request.
// Toda la UI vive en LoginClient.tsx. NEXT_PUBLIC_* queda incrustado en el
// build: activar o cambiar el bot exige redeploy.
//
// Captcha del SMS: la site key PÚBLICA de Cloudflare Turnstile
// (NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY). Sin ella no se monta el widget.
// El secret NO vive en Vercel para esto: lo guarda Supabase Auth
// (security_captcha_secret). README → «Captcha de Auth (Turnstile)».
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  const telegram = getTelegramLoginConfig();
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? "").trim() || null;
  return (
    <LoginClient
      telegramBotUsername={telegram?.botUsername ?? null}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}
