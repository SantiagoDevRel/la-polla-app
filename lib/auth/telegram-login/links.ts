// lib/auth/telegram-login/links.ts — Origen del enlace de un solo uso.
//
// Las cookies de sesión son host-only: el enlace tiene que apuntar al dominio
// donde la persona va a usar la app. En producción, es → lapollacolombiana.com
// y en → chickenpicks.app (sin www: el middleware redirige www → apex y el
// token no debe viajar por un redirect extra). En local o preview,
// NEXT_PUBLIC_APP_URL manda para no sacar a nadie de su entorno.
//
// v2: el botón del bot abre la PÁGINA /login/telegram (sistema de diseño,
// fuentes de la app), que muestra la confirmación y envía el formulario al
// endpoint /api/auth/telegram/link. /api/auth/telegram-link (v1) solo explica
// que el enlace ya no sirve.

import { SITES } from "@/lib/seo/sites";
import { LOGIN_LINK_PATH } from "./link-path";
import type { LoginLocale } from "./update";

export { LOGIN_LINK_PATH } from "./link-path";
/** Endpoint que canjea el enlace (POST del formulario de esa página). */
export const LOGIN_LINK_ACTION = "/api/auth/telegram/link";

/** Estados que la página del enlace muestra sin token (después de un POST). */
export const LINK_PAGE_STATES = ["gone", "failed", "forbidden", "sms_only", "unavailable"] as const;
export type LinkPageState = (typeof LINK_PAGE_STATES)[number];

export function linkPageStateUrl(state: LinkPageState): string {
  return `${LOGIN_LINK_PATH}?estado=${state}`;
}

const PRODUCTION_HOSTS = new Set([
  SITES.ES.host,
  `www.${SITES.ES.host}`,
  SITES.EN.host,
  `www.${SITES.EN.host}`,
]);

export function loginLinkOrigin(
  locale: LoginLocale,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (!PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) return url.origin;
    } catch {
      // URL mal formada: caemos al dominio canónico.
    }
  }
  return locale === "en" ? SITES.EN.origin : SITES.ES.origin;
}

export function loginLinkUrl(
  locale: LoginLocale,
  token: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return `${loginLinkOrigin(locale, env)}${LOGIN_LINK_PATH}?t=${encodeURIComponent(token)}`;
}

/** Idioma de la página según el host que recibió el request. */
export function localeForHost(host: string | null | undefined): LoginLocale {
  const h = (host ?? "").toLowerCase().split(":")[0];
  return h === SITES.EN.host || h === `www.${SITES.EN.host}` ? "en" : "es";
}
