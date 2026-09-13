// app/api/auth/telegram/request/complete/route.ts — Retirado antes de salir a
// producción (revisión de seguridad del PR #78).
//
// Esta ruta abría la sesión de la cuenta que aprobaba en Telegram en el
// navegador que había CREADO la solicitud, con solo su cookie. Eso es phishing
// tipo device code: alguien crea la solicitud desde su servidor, le hace llegar
// el deep link a otra persona y, cuando ella toca Iniciar, entra a su cuenta.
//
// Ahora la sesión solo sale del enlace de un solo uso que el bot manda al
// Telegram de la cuenta (/api/auth/telegram/link), en el navegador que lo abre.
// Cualquier POST aquí recibe 410 sin tocar la base, la cookie ni Auth.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json(
    { error: "gone" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
