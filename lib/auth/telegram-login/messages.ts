// lib/auth/telegram-login/messages.ts — Textos del bot de login (v2).
// Registro neutro de casa seria (CLAUDE.md, Tone Rules): claro, en tú, sin jerga
// y sin emojis. HTML de Telegram: todo lo variable pasa por esc().
//
// v2 nunca manda códigos: la persona entra con el botón del enlace de un solo
// uso, que solo llega a su propio Telegram. Un solo mensaje con una sola
// instrucción: nada de «vuelve a la web, vas a entrar sola» compitiendo con el
// botón (la sesión la abre el enlace, nunca la pestaña que pidió).
//
// El control que muestra el teclado del bot no se ve igual en todos los
// clientes (en Telegram Web es un ícono de cuatro lóbulos junto a la carita):
// se describe por su forma y su lugar, no como «ícono de teclado».
//
// (2026-09-15) Aun así la persona no lo encontraba: el pedido del número ahora
// lleva un botón pegado al mensaje que abre public/telegram/numero.html, una
// mini app que muestra la ventana nativa de Telegram para compartir el número.
// El teclado queda de respaldo (y es lo único que hay sin https, en desarrollo).

import type { LoginLocale } from "./update";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const COPY = {
  es: {
    shareButton: "Compartir mi número",
    sharePlaceholder: "Toca Compartir mi número",
    // Con el botón pegado al mensaje (mini app): dos mensajes, el primero deja
    // el teclado de respaldo y el segundo lleva el botón que siempre se ve.
    promptIntro: "Para entrar por primera vez con Telegram necesitamos confirmar tu número.",
    promptTap:
      "Toca el botón <b>Compartir mi número</b> que está justo debajo de este mensaje. Telegram te pide confirmar y listo.",
    promptLong: [
      "Para entrar por primera vez con Telegram necesitamos confirmar tu número.",
      "",
      "Toca el botón <b>Compartir mi número</b> que aparece abajo. Si no lo ves, toca el ícono de cuatro cuadritos que está en la barra donde escribes, junto a la carita.",
    ].join("\n"),
    promptShort:
      "Toca <b>Compartir mi número</b> abajo. Si no lo ves, toca el ícono de cuatro cuadritos junto a la carita, en la barra donde escribes.",
    requestExpired:
      "La solicitud de ese navegador ya venció o ya se usó. Si quieres entrar desde allá, vuelve a La Polla y toca Entrar con Telegram otra vez.",
    linkOnly:
      "Toca el botón para entrar a La Polla. El enlace sirve una sola vez y vence en 5 minutos.",
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
    promptIntro: "To sign in with Telegram for the first time we need to confirm your number.",
    promptTap:
      "Tap the <b>Share my number</b> button right below this message. Telegram asks you to confirm and that is it.",
    promptLong: [
      "To sign in with Telegram for the first time we need to confirm your number.",
      "",
      "Tap the <b>Share my number</b> button below. If you do not see it, tap the four-squares icon in the bar where you type, next to the smiley face.",
    ].join("\n"),
    promptShort:
      "Tap <b>Share my number</b> below. If you do not see it, tap the four-squares icon next to the smiley face, in the bar where you type.",
    requestExpired:
      "The request from that browser already expired or was used. To sign in there, go back to Chicken Picks and tap Sign in with Telegram again.",
    linkOnly:
      "Tap the button to sign in to Chicken Picks. The link works only once and expires in 5 minutes.",
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
