// lib/auth/telegram-login/messages.ts — Textos del bot de login.
// Registro neutro de casa seria (CLAUDE.md, Tone Rules): claro, en tú, sin jerga
// y sin emojis. HTML de Telegram: todo lo variable pasa por esc().

import type { LoginLocale } from "./update";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "+573001234567" → "+57 ••• ••• 4567": suficiente para reconocer el número. */
export function maskPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  const last = digits.slice(-4);
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
  return `+${cc}${cc ? " " : ""}••• ••• ${last}`;
}

const COPY = {
  es: {
    shareButton: "Compartir mi número",
    prompt: [
      "<b>La Polla Colombiana</b>",
      "",
      "Con este bot recibes un código para entrar a la app cuando el SMS no llega.",
      "",
      "Toca el botón <b>Compartir mi número</b> que aparece abajo. Por seguridad solo aceptamos el número de esta cuenta de Telegram.",
    ].join("\n"),
    foreign: [
      "Por seguridad solo aceptamos el número de tu propia cuenta de Telegram.",
      "",
      "Toca el botón <b>Compartir mi número</b> que aparece abajo.",
    ].join("\n"),
    invalidPhone:
      "No pudimos leer ese número. Toca el botón <b>Compartir mi número</b> para intentarlo de nuevo.",
    rateLimited:
      "Ya pediste varios códigos. Espera 15 minutos antes de pedir otro.",
    failure:
      "No pudimos generar tu código en este momento. Inténtalo de nuevo en unos minutos.",
    code: (code: string, masked: string) =>
      [
        "Tu código para entrar a <b>La Polla Colombiana</b> es:",
        "",
        `<code>${esc(code)}</code>`,
        "",
        `Escríbelo en la pantalla de inicio de sesión con el número ${esc(masked)}. Vence en 10 minutos y sirve una sola vez.`,
        "",
        "También puedes tocar <b>Entrar a La Polla</b>. Si lo abres desde Telegram, la sesión puede quedar dentro del navegador de Telegram y no en tu navegador ni en la app instalada. Por eso te recomendamos escribir el código.",
        "",
        "No compartas este código con nadie. Nunca te lo vamos a pedir. Si no lo pediste, ignora este mensaje.",
      ].join("\n"),
    linkButton: "Entrar a La Polla",
  },
  en: {
    shareButton: "Share my number",
    prompt: [
      "<b>Chicken Picks</b>",
      "",
      "Use this bot to get a sign-in code when the text message does not arrive.",
      "",
      "Tap the <b>Share my number</b> button below. For your security we only accept the number of this Telegram account.",
    ].join("\n"),
    foreign: [
      "For your security we only accept the number of your own Telegram account.",
      "",
      "Tap the <b>Share my number</b> button below.",
    ].join("\n"),
    invalidPhone:
      "We could not read that number. Tap <b>Share my number</b> to try again.",
    rateLimited:
      "You already requested several codes. Wait 15 minutes before asking for another one.",
    failure:
      "We could not create your code right now. Please try again in a few minutes.",
    code: (code: string, masked: string) =>
      [
        "Your <b>Chicken Picks</b> sign-in code is:",
        "",
        `<code>${esc(code)}</code>`,
        "",
        `Enter it on the sign-in screen with the number ${esc(masked)}. It expires in 10 minutes and works only once.`,
        "",
        "You can also tap <b>Sign in to Chicken Picks</b>. If you open it from Telegram, the session may stay inside Telegram's browser instead of your browser or installed app, so we recommend typing the code.",
        "",
        "Do not share this code with anyone. We will never ask you for it. If you did not request it, ignore this message.",
      ].join("\n"),
    linkButton: "Sign in to Chicken Picks",
  },
} as const;

export function loginBotCopy(locale: LoginLocale) {
  return COPY[locale];
}
