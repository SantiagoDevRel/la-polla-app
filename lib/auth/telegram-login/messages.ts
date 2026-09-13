// lib/auth/telegram-login/messages.ts — Textos del bot de login (v2).
// Registro neutro de casa seria (CLAUDE.md, Tone Rules): claro, en tú, sin jerga
// y sin emojis. HTML de Telegram: todo lo variable pasa por esc().
//
// v2 nunca manda códigos: la persona entra sola en la pestaña donde tocó
// «Entrar con Telegram», o con el botón de enlace de un solo uso.

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
    sharePlaceholder: "Toca Compartir mi número",
    promptLong: [
      "Para entrar por primera vez con Telegram necesitamos confirmar tu número.",
      "",
      "Toca el botón <b>Compartir mi número</b>. Si no lo ves, toca el ícono de teclado junto al campo de mensaje.",
    ].join("\n"),
    promptShort:
      "Toca <b>Compartir mi número</b> (ícono de teclado junto al campo de mensaje).",
    requestExpired:
      "La solicitud de ese navegador ya venció o ya se usó. Si quieres entrar desde allá, vuelve a La Polla y toca Entrar con Telegram otra vez.",
    approved: (label: string | null) =>
      [
        "Listo. Vuelve a La Polla: vas a entrar automáticamente.",
        ...(label ? ["", `Ingreso pedido desde ${esc(label)}. Si no fuiste tú, escríbenos a soporte.`] : []),
      ].join("\n"),
    linkOnly:
      "Toca el botón para entrar a La Polla. El enlace sirve una sola vez y vence en 5 minutos.",
    linkAfterApproval:
      "Si prefieres entrar desde aquí, toca <b>Entrar a La Polla</b>. El enlace sirve una sola vez y vence en 5 minutos.",
    linkButton: "Entrar a La Polla",
    linkedReady: "Tu cuenta de Telegram ya está confirmada para La Polla.",
    contactConfirmed:
      "Listo, confirmamos tu número. La próxima vez no tendrás que compartirlo.",
    foreign: [
      "Por seguridad solo aceptamos el número de tu propia cuenta de Telegram.",
      "",
      "Toca el botón <b>Compartir mi número</b>.",
    ].join("\n"),
    invalidPhone:
      "No pudimos leer ese número. Toca el botón <b>Compartir mi número</b> para intentarlo de nuevo.",
    smsOnly:
      "Por seguridad, con este número solo puedes entrar con el código por SMS. Vuelve a la pantalla de inicio de sesión y pide el SMS.",
    rateLimited:
      "Ya pediste varios enlaces. Espera 15 minutos antes de pedir otro.",
    failure:
      "No pudimos preparar tu ingreso en este momento. Inténtalo de nuevo en unos minutos.",
    signedIn: (label: string | null, supportUrl: string) =>
      `Entraste a La Polla${label ? ` desde ${esc(label)}` : ""}. Si no fuiste tú, escríbenos en ${esc(supportUrl)}.`,
  },
  en: {
    shareButton: "Share my number",
    sharePlaceholder: "Tap Share my number",
    promptLong: [
      "To sign in with Telegram for the first time we need to confirm your number.",
      "",
      "Tap the <b>Share my number</b> button. If you do not see it, tap the keyboard icon next to the message field.",
    ].join("\n"),
    promptShort:
      "Tap <b>Share my number</b> (keyboard icon next to the message field).",
    requestExpired:
      "The request from that browser already expired or was used. To sign in there, go back to Chicken Picks and tap Sign in with Telegram again.",
    approved: (label: string | null) =>
      [
        "Done. Go back to Chicken Picks: you will be signed in automatically.",
        ...(label ? ["", `Sign-in requested from ${esc(label)}. If this was not you, contact support.`] : []),
      ].join("\n"),
    linkOnly:
      "Tap the button to sign in to Chicken Picks. The link works only once and expires in 5 minutes.",
    linkAfterApproval:
      "If you prefer to sign in from here, tap <b>Sign in to Chicken Picks</b>. The link works only once and expires in 5 minutes.",
    linkButton: "Sign in to Chicken Picks",
    linkedReady: "Your Telegram account is already confirmed for Chicken Picks.",
    contactConfirmed:
      "Done, we confirmed your number. Next time you will not need to share it.",
    foreign: [
      "For your security we only accept the number of your own Telegram account.",
      "",
      "Tap the <b>Share my number</b> button.",
    ].join("\n"),
    invalidPhone:
      "We could not read that number. Tap <b>Share my number</b> to try again.",
    smsOnly:
      "For your security, this number can only sign in with the text message code. Go back to the sign-in screen and request the text message.",
    rateLimited:
      "You already requested several links. Wait 15 minutes before asking for another one.",
    failure:
      "We could not prepare your sign-in right now. Please try again in a few minutes.",
    signedIn: (label: string | null, supportUrl: string) =>
      `You signed in to Chicken Picks${label ? ` from ${esc(label)}` : ""}. If this was not you, contact us at ${esc(supportUrl)}.`,
  },
} as const;

export function loginBotCopy(locale: LoginLocale) {
  return COPY[locale];
}
