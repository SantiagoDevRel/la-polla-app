// app/api/auth/telegram-verify/route.ts — Canje de código del login por
// Telegram v1.
//
// Retirado en v2 (migración 119): el bot ya no manda códigos. La persona entra
// sola en la pestaña de /login (/api/auth/telegram/request/*) o con el enlace
// de un solo uso. Una pestaña vieja que todavía mande el código recibe 410 sin
// tocar la base ni el límite de intentos.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json(
    { error: "gone" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
