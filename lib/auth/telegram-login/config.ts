// lib/auth/telegram-login/config.ts — Configuración del bot de LOGIN de
// Telegram. Es un bot distinto del panel de admin (@LaPollaColombianaAdminBot):
// la cara pública no expone la superficie de comandos del admin.
//
// Tres variables, todas obligatorias. Si falta o está mal formada alguna, el
// canal queda APAGADO: /login no muestra la opción, el webhook responde 503 sin
// tocar la base y los endpoints de verificación no aceptan códigos.
//   TELEGRAM_LOGIN_BOT_TOKEN              servidor — token de @BotFather
//   TELEGRAM_LOGIN_WEBHOOK_SECRET         servidor — secret_token del setWebhook
//   NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME  público — usuario del bot, sin @
//
// Opcional, decisión del dueño (lib/auth/telegram-login/identity.ts):
//   TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=true  deja entrar por Telegram a
//   cuentas que ya existían sin Telegram. Apagado por defecto: un número
//   reciclado que el dueño anterior conserva en Telegram no entra a la cuenta
//   que el dueño nuevo creó por SMS.

export interface TelegramLoginConfig {
  botToken: string;
  webhookSecret: string;
  botUsername: string;
  allowExistingAccounts: boolean;
}

type Env = Record<string, string | undefined>;

const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
// Telegram admite 1-256 caracteres [A-Za-z0-9_-]; exigimos 32+ para que no se
// pueda adivinar.
const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;
const BOT_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

let warned = false;

export function getTelegramLoginConfig(
  env: Env = process.env,
): TelegramLoginConfig | null {
  const botToken = env.TELEGRAM_LOGIN_BOT_TOKEN?.trim() ?? "";
  const webhookSecret = env.TELEGRAM_LOGIN_WEBHOOK_SECRET?.trim() ?? "";
  const botUsername = (env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME ?? "")
    .trim()
    .replace(/^@/, "");

  if (!botToken && !webhookSecret && !botUsername) return null;

  const problems: string[] = [];
  if (!BOT_TOKEN_RE.test(botToken)) problems.push("TELEGRAM_LOGIN_BOT_TOKEN");
  if (!WEBHOOK_SECRET_RE.test(webhookSecret)) {
    problems.push("TELEGRAM_LOGIN_WEBHOOK_SECRET");
  }
  if (!BOT_USERNAME_RE.test(botUsername)) {
    problems.push("NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME");
  }
  if (problems.length > 0) {
    if (!warned) {
      warned = true;
      // Solo los NOMBRES de las variables, jamás sus valores.
      console.warn(
        "[telegram-login] canal apagado; variables ausentes o mal formadas:",
        problems.join(", "),
      );
    }
    return null;
  }

  const allowExistingAccounts =
    env.TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS?.trim().toLowerCase() === "true";

  return { botToken, webhookSecret, botUsername, allowExistingAccounts };
}
