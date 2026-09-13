// lib/auth/telegram-login/request-cookie.ts — Cookie que ata la solicitud de
// login por Telegram al navegador que la pidió.
//
// lp_tg_req = secreto aleatorio (la base solo guarda su sha256). httpOnly,
// Secure en producción, SameSite=Lax, host-only (sin Domain). Dura lo mismo
// que la solicitud pendiente.
//
// Path=/: la tienen que ver los endpoints de /api/auth/telegram/* y la página
// del enlace (/login/telegram), que se dibuja con el sistema de diseño y decide
// si entra sin confirmar (mismo navegador). La cookie sola no abre sesión en
// ningún lado: solo sirve junto con el token del enlace del bot.

import type { NextResponse } from "next/server";
import { BROWSER_SECRET_RE, LOGIN_REQUEST_TTL_SECONDS, sha256Hex } from "./crypto";

export const TG_REQUEST_COOKIE = "lp_tg_req";
export const TG_REQUEST_COOKIE_PATH = "/";

type Env = Record<string, string | undefined>;

export function setRequestCookie(
  response: NextResponse,
  secret: string,
  env: Env = process.env,
): void {
  response.cookies.set(TG_REQUEST_COOKIE, secret, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: TG_REQUEST_COOKIE_PATH,
    maxAge: LOGIN_REQUEST_TTL_SECONDS,
  });
}

export function clearRequestCookie(response: NextResponse, env: Env = process.env): void {
  response.cookies.set(TG_REQUEST_COOKIE, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: TG_REQUEST_COOKIE_PATH,
    maxAge: 0,
  });
}

type CookieReader = { get(name: string): { value: string } | undefined };

/** sha256 del secreto de la cookie, o null si no hay cookie válida. */
export function readRequestBrowserHash(request: { cookies: CookieReader }): string | null {
  return browserHashFromCookies(request.cookies);
}

/** Igual, desde cookies() de next/headers (la página del enlace). */
export function browserHashFromCookies(cookies: CookieReader): string | null {
  const value = cookies.get(TG_REQUEST_COOKIE)?.value ?? "";
  return BROWSER_SECRET_RE.test(value) ? sha256Hex(value) : null;
}

// Cookies de sesión de @supabase/ssr: sb-<ref>-auth-token, a veces en trozos .0/.1.
const SESSION_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

/** ¿Este navegador trae cookie de sesión de Supabase? Solo para la UX. */
export function hasSessionCookie(cookies: { getAll(): { name: string }[] }): boolean {
  return cookies.getAll().some((c) => SESSION_COOKIE_RE.test(c.name));
}
