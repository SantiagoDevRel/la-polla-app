// app/api/auth/sms-hook/route.ts
// "Send SMS Hook" de Supabase Auth: acá NO se genera ni se valida el código.
//
// Supabase Auth solo sabe hablar de fábrica con Twilio, MessageBird, Vonage y
// TextLocal — Twilio es el proveedor activo HOY (~COP 167/SMS). El hook es la
// puerta oficial para meter LabsMobile (~COP 8,28/SMS) sin tocar el login:
// Supabase genera el OTP, lo guarda, y nos llama a nosotros SOLO para
// entregarlo. El cutover es un switch en el dashboard de Auth, no un deploy
// de /login ni de start-otp.
//
// Reparto de responsabilidades (importante no confundirlo):
//   · Supabase  → genera el código, lo guarda, y lo valida en verifyOtp
//   · este hook → solo lo ENTREGA por SMS
//
// De ahí una trampa que vale la pena dejar escrita: hay que usar el envío de
// SMS PLANO del proveedor (`https://api.labsmobile.com/json/send`), nunca su
// endpoint "2FA"/"OTP". Esos endpoints generan su PROPIO código — al usuario
// le llegaría un número distinto al que Supabase espera, y toda verificación
// fallaría con un error incomprensible.
//
// El rate limit NO vive acá: ya está en /api/auth/start-otp (por teléfono y
// por IP), que es la puerta por donde entra el usuario. Este endpoint solo
// lo alcanza Supabase, y su defensa es la firma HMAC.
//
// Env vars (Vercel, production + preview):
//   SEND_SMS_HOOK_SECRET   el secreto que da Supabase, formato "v1,whsec_..."
//   LABSMOBILE_USERNAME    el email de la cuenta de LabsMobile
//   LABSMOBILE_TOKEN       token de API (Mi cuenta → Configuración API)
//   LABSMOBILE_DRY_RUN=1   opcional: simula el envío sin gastar créditos
//
// Config en Supabase: Auth → Hooks → Send SMS Hook → HTTP →
//   https://lapollacolombiana.com/api/auth/sms-hook
// ⚠️ El host tiene que ser el que NO redirige. Supabase no sigue un 308 y el
// SMS no saldría. www ya redirige a apex en proxy.ts; apuntar al apex.

import { NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sendSms } from "@/lib/sms/labsmobile";
import {
  registrarEnvio,
  registrarFalloEnvio,
  registrarResultadoDespacho,
} from "@/lib/sms/entregas";

export const runtime = "nodejs";

// Ventana anti-replay. Standard Webhooks recomienda 5 min: si alguien captura
// un request válido, no puede reproducirlo mañana.
const TOLERANCIA_SEG = 5 * 60;

/**
 * Verifica la firma del estándar "Standard Webhooks" (el mismo de Svix) que usa
 * Supabase. Se implementa a mano con node:crypto en vez de traer la librería
 * `standardwebhooks`: son 20 líneas y evita una dependencia más en el bundle.
 *
 * Contenido firmado = `${id}.${timestamp}.${body_crudo}`
 * Firma = base64(HMAC-SHA256(secreto_en_bytes, contenido))
 */
function firmaValida(raw: string, headers: Headers, secret: string): boolean {
  // Supabase manda `webhook-*`; Svix histórico manda `svix-*`. Aceptamos ambos.
  const id = headers.get("webhook-id") ?? headers.get("svix-id");
  const ts = headers.get("webhook-timestamp") ?? headers.get("svix-timestamp");
  const sigHeader = headers.get("webhook-signature") ?? headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > TOLERANCIA_SEG) return false;

  // El secreto viene como "v1,whsec_<base64>"; la clave real es ese base64.
  const b64 = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let key: Buffer;
  try {
    key = Buffer.from(b64, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const esperada = createHmac("sha256", key)
    .update(`${id}.${ts}.${raw}`)
    .digest("base64");

  // El header puede traer varias firmas separadas por espacio ("v1,aaa v1,bbb")
  // durante una rotación de secreto: basta que UNA coincida.
  const esperadaBuf = Buffer.from(esperada);
  return sigHeader.split(" ").some((parte) => {
    const val = parte.includes(",") ? parte.slice(parte.indexOf(",") + 1) : parte;
    const buf = Buffer.from(val);
    // timingSafeEqual explota si difieren de largo → se compara antes.
    return buf.length === esperadaBuf.length && timingSafeEqual(buf, esperadaBuf);
  });
}

interface HookPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
}

/**
 * E.164 sin "+". NO usamos `normalizePhone` de lib/auth/phone.ts: ese helper
 * solo saca espacios/guiones/paréntesis y DEJA PASAR LETRAS, así que un payload
 * basura podría llegar hasta LabsMobile y gastar un crédito. Acá se tira
 * TODO lo que no sea dígito y se exige forma de E.164 antes de despachar.
 */
function phoneE164SinPlus(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  // ITU E.164: 8-15 dígitos en total, el indicativo no empieza por 0.
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

export async function POST(request: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret) {
    // Sin secreto no se puede autenticar a Supabase → se rechaza TODO. Fallar
    // cerrado a propósito: si esto quedara abierto, cualquiera podría hacernos
    // mandar SMS a costa nuestra.
    console.error("[sms-hook] falta SEND_SMS_HOOK_SECRET");
    return NextResponse.json({ error: "hook no configurado" }, { status: 500 });
  }

  // El cuerpo CRUDO es lo que se firma: hay que leerlo como texto antes de
  // parsear. Si se usara request.json() el re-serializado no coincidiría.
  const raw = await request.text();

  if (!firmaValida(raw, request.headers, secret)) {
    console.warn("[sms-hook] firma inválida o vencida — request descartado");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }

  const otp = payload.sms?.otp;
  const phone = phoneE164SinPlus(payload.user?.phone ?? "");
  if (!otp || !phone) {
    console.error("[sms-hook] payload sin otp o con phone inválido");
    return NextResponse.json({ error: "payload incompleto" }, { status: 400 });
  }

  // ⚠️ RIESGO DE COSTO ABIERTO. los-del-sur filtra a teléfonos colombianos
  // (`isColombianLoginPhone`). La Polla NO: PhoneInput llama getCountries()
  // sin filtro y el login acepta cualquier país. LabsMobile cobra distinto
  // por destino — un SMS a US/EU sale mucho más caro que los ~COP 8,28 de
  // Colombia. No cerramos a 57 por nuestra cuenta: el producto es
  // internacional. Antes de decidir un filtro hay que medir cuántos
  // `auth.users.phone` NO empiezan por 57. Hasta entonces este hook manda
  // a cualquier E.164 válido.

  // Sin tildes, sin ñ, sin emoji y SIN DOMINIO, a propósito:
  //
  // · Un acento saca el mensaje de GSM-7 (160 chars/segmento) y lo pasa a
  //   UCS-2 (70) → el mismo SMS cuesta el doble.
  // · Un emoji (la regla 🐥 del CLAUDE.md es del bot de WhatsApp, NO del SMS)
  //   hace lo mismo.
  // · Un dominio dispara el filtro de seguridad de LabsMobile: retienen el
  //   SMS para revisión manual. Confirmado POR ELLOS en un ticket (2026-08-11):
  //   con un `@dominio #codigo` (WebOTP) dos códigos quedaron trabados 2h35m
  //   y se liberaron los dos en el MISMO segundo, cuando un humano aprobó.
  //   El OTP vive 10 minutos (SMS_OTP_EXP=600), así que un SMS retenido no
  //   llega tarde: llega INSERVIBLE. Y aquella vez pasó de madrugada, en
  //   silencio.
  //
  // QUÉ SE PIERDE: en Android ya no hay autocompletado por WebOTP; el usuario
  // teclea 6 dígitos. En iPhone casi no cambia, porque Safari igual lo ofrece
  // sobre el teclado por heurística del texto ("codigo es 123456").
  //
  // CÓMO SE REVIERTE, el día que LabsMobile tenga aprobado
  // lapollacolombiana.com: volver a concatenar la línea del dominio sacándolo
  // de NEXT_PUBLIC_APP_URL, y mandar UN SMS de prueba EN HORARIO HÁBIL — así,
  // si el filtro lo retiene, la revisión cae con alguien despierto.
  //
  // 61 caracteres con un OTP de 6 dígitos → un solo segmento GSM-7.
  // No se anuncia una duración concreta: quien decide cuánto vive el código
  // es Supabase (SMS_OTP_EXP), no este archivo.
  const texto = `Tu codigo es ${otp} para La Polla. No lo compartas con nadie.`;

  // LabsMobile admite un subid propio de hasta 20 caracteres. Lo generamos y
  // registramos ANTES del fetch: así el callback nunca puede adelantarse a la
  // fila, ni siquiera si llega antes de que el API termine de responder.
  const subid = randomBytes(10).toString("hex");
  const registrado = await registrarEnvio(subid, phone);
  if (!registrado) {
    // Sin fila no hay forma de correlacionar DLR ni detectar un usuario mudo.
    // Fallamos antes de gastar/enviar: Supabase propaga el error.
    return NextResponse.json({ error: "no se pudo preparar el envío" }, { status: 503 });
  }
  const r = await sendSms(phone, texto, { subid });

  if (!r.ok) {
    // `code` implica rechazo explícito. Sin code puede ser timeout/red: el
    // proveedor quizá sí alcanzó a aceptarlo, así que la fila queda pendiente y
    // el vigía la resolverá por DLR/silencio sin mentir con un fallo definitivo.
    if (r.code) await registrarFalloEnvio(subid, phone, r.code, r.error);
    else await registrarResultadoDespacho(subid, "ambiguous", r.error);
    // No se loguea el teléfono completo ni el código (quedarían en los logs de
    // Vercel). Los últimos 4 dígitos alcanzan para rastrear un caso puntual.
    console.error(
      `[sms-hook] fallo envío code=${r.code ?? "-"} err=${r.error ?? "-"} tel=***${phone.slice(-4)}`,
    );
    // 500 → Supabase lo reporta como error de envío.
    return NextResponse.json({ error: "no se pudo enviar el sms" }, { status: 500 });
  }

  await registrarResultadoDespacho(subid, "accepted");

  // El envío salió. Dejar rastro del `subid` NO es decoración: es la única
  // clave que cruza nuestros logs con el histórico de LabsMobile. Sin ella, el
  // incidente del 2026-08-10 hubo que reconstruirlo cruzando a mano Vercel,
  // auth.users y el panel del proveedor.
  console.log(`[sms-hook] enviado subid=${r.subid ?? "-"} tel=***${phone.slice(-4)}`);

  // Supabase espera 200 con un objeto vacío.
  return NextResponse.json({});
}
