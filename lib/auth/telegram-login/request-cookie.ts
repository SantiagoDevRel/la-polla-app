// lib/auth/telegram-login/request-cookie.ts — Cookie que ata la solicitud de
// login por Telegram al navegador que la pidió.
//
// lp_tg_req = secreto aleatorio (la base solo guarda su sha256). httpOnly,
// Secure en producción, SameSite=Lax, host-only (sin Domain) y Path limitado a
// /api/auth/telegram: solo la ven los endpoints de solicitud y el del enlace
// (/api/auth/telegram/link). Dura lo mismo que la solicitud pendiente.
//
// El Path decide dónde vive el enlace: una cookie con Path=/api/auth/telegram
// NO viaja a /api/auth/telegram-link (RFC 6265: tras el prefijo tiene que venir
// "/"), por eso el enlace v2 está en /api/auth/telegram/link.

import type { NextRequest, NextResponse } from "next/server";
import { BROWSER_SECRET_RE, LOGIN_REQUEST_TTL_SECONDS, sha256Hex } from "./crypto";

export const TG_REQUEST_COOKIE = "lp_tg_req";
export const TG_REQUEST_COOKIE_PATH = "/api/auth/telegram";

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

/** sha256 del secreto de la cookie, o null si no hay cookie válida. */
export function readRequestBrowserHash(request: NextRequest): string | null {
  const value = request.cookies.get(TG_REQUEST_COOKIE)?.value ?? "";
  return BROWSER_SECRET_RE.test(value) ? sha256Hex(value) : null;
}
