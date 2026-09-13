// app/(auth)/login/page.tsx — Server wrapper del login.
// Decide en el servidor si el canal de Telegram está completo (token, secreto
// del webhook y usuario del bot) y solo entonces le pasa el usuario del bot al
// cliente. Ningún secreto cruza al navegador: solo el nombre público del bot.
// Toda la UI vive en LoginClient.tsx. NEXT_PUBLIC_* queda incrustado en el
// build: activar o cambiar el bot exige redeploy.
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  const telegram = getTelegramLoginConfig();
  return <LoginClient telegramBotUsername={telegram?.botUsername ?? null} />;
}
