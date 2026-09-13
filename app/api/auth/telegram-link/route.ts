// app/api/auth/telegram-link/route.ts — Enlace del login por Telegram v1.
//
// Retirado en v2 (migración 119). El bot ya no emite estos enlaces y los que
// alcanzó a emitir vencían a los 10 minutos. El enlace v2 abre la página
// /login/telegram.
//
// GET → 303 a /login/telegram?estado=gone (la página explica que el enlace ya
// no sirve, con el sistema de diseño); POST → 410. Ninguno toca la base ni las
// cookies. HEAD 405 (Next derivaría HEAD de GET).

import { NextRequest, NextResponse } from "next/server";
import { linkPageStateUrl } from "@/lib/auth/telegram-login/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL(linkPageStateUrl("gone"), request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function POST() {
  return NextResponse.json(
    { error: "gone" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
  });
}
