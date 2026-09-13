// lib/auth/telegram-login/notify.ts — Aviso en Telegram después de entrar.
//
// Una solicitud del navegador se aprueba con un solo toque en Telegram. Si
// alguien le hace llegar a otra persona el deep link de SU navegador, esa
// persona podría aprobarle el ingreso sin darse cuenta. El aviso llega al
// Telegram de la cuenta en el momento en que se abre la sesión, con desde
// dónde se pidió, para que lo note y escriba a soporte. Mejor esfuerzo: nunca
// bloquea ni rompe el login.

import { after } from "next/server";
import type { TelegramLoginConfig } from "./config";
import { createLoginBotApi, type BotApiCall } from "./bot-api";
import { loginLinkOrigin } from "./links";
import { loginBotCopy } from "./messages";
import type { LoginLocale } from "./update";

/** after() fuera de un request (pruebas) lanza: ahí se corre directo. */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () => task().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}

export function notifySignedIn(
  config: Pick<TelegramLoginConfig, "botToken">,
  input: { telegramUserId: number; locale: LoginLocale; label: string | null },
  send: BotApiCall = createLoginBotApi(config.botToken),
  env: Record<string, string | undefined> = process.env,
): void {
  const copy = loginBotCopy(input.locale);
  const support = `${loginLinkOrigin(input.locale, env)}/soporte`;
  runAfterResponse(() =>
    send("sendMessage", {
      chat_id: input.telegramUserId,
      text: copy.signedIn(input.label, support),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  );
}
