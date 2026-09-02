// app/api/sms/ack/route.ts
// Acuse de entrega (DLR) de LabsMobile. Acá nos enteramos de qué pasó de verdad
// con un SMS después de que el proveedor lo aceptó.
//
// Se configura con el parámetro `ackurl` del envío (lib/sms/labsmobile.ts).
// LabsMobile pega un **GET** con estos parámetros en el query string:
//
//   subid      el id que devolvió /json/send — nuestra clave de cruce
//   acklevel   gateway | operator | handset | error
//   status     ok | ko
//   desc       DELIVRD | REJECTD | EXPIRED | UNDELIV | BLOCKED | UNKNOWN
//   msisdn     el destinatario
//   timestamp  YYYY-MM-DD HH:MM:SS (GMT)
//
// AUTENTICACIÓN. LabsMobile no firma el callback ni deja mandar headers, así
// que la única defensa disponible es un secreto en la URL: `?k=<SMS_ACK_SECRET>`,
// comparado en tiempo constante. Sin secreto configurado el endpoint se apaga
// entero (404) en vez de quedar abierto — fallar cerrado.
//
// Aun con el secreto filtrado el daño posible es acotado: quien lo tenga puede
// falsear el estado de entrega de un subid que ya conozca, o disparar un correo
// de alerta. No lee datos, no crea filas y no toca sesiones.
//
// SIEMPRE 200. Si devolvemos 4xx/5xx, LabsMobile reintenta hasta 5 veces
// (30 s, 5 min, 30 min, 6 h). Un subid desconocido o un parámetro faltante no
// se arreglan reintentando, así que se responde 200 y se loguea.
//
// ⚠️ Esta ruta TIENE que estar en `isApiWebhook` de lib/supabase/middleware.ts.
// Sin eso el middleware manda a /login con 307 y el callback muere — y el
// secreto viajaría en el returnTo.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { registrarAcuse } from "@/lib/sms/entregas";

export const runtime = "nodejs";

function igualEnTiempoConstante(a: string | null, b: string): boolean {
  if (typeof a !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual explota si difieren de largo → hay que comparar antes.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(request: Request) {
  const secreto = process.env.SMS_ACK_SECRET;
  if (!secreto) {
    console.error("[sms-ack] falta SMS_ACK_SECRET — endpoint apagado");
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  if (!igualEnTiempoConstante(url.searchParams.get("k"), secreto)) {
    console.warn("[sms-ack] callback con clave inválida — descartado");
    return new NextResponse(null, { status: 404 });
  }

  const subid = url.searchParams.get("subid");
  if (!subid) {
    console.warn("[sms-ack] callback sin subid");
    return NextResponse.json({ ok: true });
  }

  await registrarAcuse({
    subid,
    acklevel: url.searchParams.get("acklevel") ?? "",
    status: url.searchParams.get("status") ?? "",
    desc: url.searchParams.get("desc") ?? "",
    timestamp: url.searchParams.get("timestamp"),
    msisdn: url.searchParams.get("msisdn"),
  });

  return NextResponse.json({ ok: true });
}
