// app/api/auth/telegram-link/route.ts — Enlace del login por Telegram v1.
//
// Retirado en v2 (migración 119). El bot ya no emite estos enlaces y los que
// alcanzó a emitir vencían a los 10 minutos. El enlace v2 vive en
// /api/auth/telegram/link, bajo el Path de la cookie lp_tg_req.
//
// GET → página 410 con la salida clara; POST → 410. Ninguno toca la base ni
// las cookies. HEAD 405 (Next derivaría HEAD de GET).

import { NextRequest, NextResponse } from "next/server";
import { authErrorPage } from "@/lib/auth/auth-error-page";
import { localeForHost } from "@/lib/auth/telegram-login/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GONE = {
  es: "Este enlace ya se usó o venció. Pide uno nuevo en el bot.",
  en: "This link was already used or expired. Request a new one in the bot.",
} as const;

export function GET(request: NextRequest) {
  const locale = localeForHost(request.headers.get("host"));
  return authErrorPage(GONE[locale], 410, locale);
}

export function POST(request: NextRequest) {
  const locale = localeForHost(request.headers.get("host"));
  return authErrorPage(GONE[locale], 410, locale);
}

export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
  });
}
