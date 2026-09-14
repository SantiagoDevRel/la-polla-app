// lib/auth/telegram-login/link-path.ts — Ruta de la página del enlace de un
// solo uso. Sin imports: la usan también componentes de cliente (el splash del
// layout raíz y la bienvenida del login) para no taparla.
//
// Quien llega desde el botón del bot abre esta página casi siempre en el
// navegador de Telegram, con almacenamiento nuevo: el splash de primera visita
// y la bienvenida taparían «Confirma tu ingreso» mientras el enlace corre sus
// 5 minutos. En esta ruta no se muestra ninguno de los dos.

/** Página que abre el botón del bot. */
export const LOGIN_LINK_PATH = "/login/telegram";

export function isLoginLinkPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === LOGIN_LINK_PATH || pathname.startsWith(`${LOGIN_LINK_PATH}/`);
}
