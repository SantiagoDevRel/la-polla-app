// lib/auth/telegram-login/open-mode.ts — Dónde abre /login el deep link de
// Telegram. Sin imports de servidor: lo usa LoginClient.tsx en el navegador.
//
// En teléfonos y tabletas se abre Telegram en la MISMA pestaña: con una pestaña
// nueva, al volver de Telegram el navegador muestra esa pestaña (t.me) y no la
// que espera. En escritorio la ventana nueva se ve y la espera queda a la mano.
//
// v2 usaba solo (pointer: coarse), que también es verdad en un PC con pantalla
// táctil y mouse o trackpad: ahí navegaba la misma pestaña y la persona perdía
// la espera. (hover: none) and (pointer: coarse) describe el puntero PRINCIPAL
// de un teléfono o una tableta; un portátil táctil tiene hover y puntero fino.

export const SAME_TAB_MEDIA_QUERY = "(hover: none) and (pointer: coarse)";

type MatchMedia = (query: string) => { matches: boolean };

export function prefersSameTab(
  matchMedia: MatchMedia | undefined = typeof window === "undefined"
    ? undefined
    : window.matchMedia?.bind(window),
): boolean {
  try {
    return matchMedia ? matchMedia(SAME_TAB_MEDIA_QUERY).matches === true : false;
  } catch {
    return false;
  }
}
