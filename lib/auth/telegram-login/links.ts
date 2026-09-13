// lib/auth/telegram-login/links.ts — Origen del enlace de un solo uso.
//
// Las cookies de sesión son host-only: el enlace tiene que apuntar al dominio
// donde la persona va a usar la app. En producción, es → lapollacolombiana.com
// y en → chickenpicks.app (sin www: el middleware redirige www → apex y el
// token no debe viajar por un redirect extra). En local o preview,
// NEXT_PUBLIC_APP_URL manda para no sacar a nadie de su entorno.

import { SITES } from "@/lib/seo/sites";
import type { LoginLocale } from "./update";

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
  return `${loginLinkOrigin(locale, env)}/api/auth/telegram-link?t=${encodeURIComponent(token)}`;
}

/** Idioma de la página de error del enlace según el host que lo recibió. */
export function localeForHost(host: string | null | undefined): LoginLocale {
  const h = (host ?? "").toLowerCase().split(":")[0];
  return h === SITES.EN.host || h === `www.${SITES.EN.host}` ? "en" : "es";
}
