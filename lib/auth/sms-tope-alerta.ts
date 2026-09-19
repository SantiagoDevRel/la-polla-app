// lib/auth/sms-tope-alerta.ts
// Aviso al administrador cuando un número toca el tope de códigos por hora.
//
// Por qué existe: hasta el 2026-09-19 el login cortaba en silencio. Una
// persona pedía su código, la app le respondía "espera" o "inténtalo mañana",
// y del lado nuestro no quedaba ni un rastro visible: el incidente llegaba
// días después, por correo de la propia persona ("no me llega el SMS"). El
// bloqueo puede ser correcto —un bot, o alguien con un celular que no recibe—
// pero enterarse el mismo minuto es lo que permite responderle.
//
// Reglas de este archivo:
//   · Fail-soft SIEMPRE. Nada de acá puede tumbar un login: si falta una env,
//     si Supabase no responde o si Resend falla, se loguea y se sigue.
//   · Un aviso por número y por hora. El dedupe NO se decide leyendo antes
//     (dos requests simultáneos leerían "no hay" las dos y mandarían dos
//     correos): se apoya en el índice UNIQUE de `admin_alerts.dedupe_key`.
//     Si el insert choca, es que alguien ya avisó por esa hora.
//   · El correo lleva el número COMPLETO a propósito, igual que el vigía de
//     entregas (lib/sms/entregas.ts): el sentido del aviso es poder escribirle
//     a esa persona sin tener que ir a buscarla a la base.

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

/** Últimos 4 dígitos, que es lo único que va a los logs de Vercel. */
function cola(phone: string): string {
  return `***${phone.slice(-4)}`;
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Hora Colombia legible, que es la que usa el dueño para leer estas alertas. */
function horaColombia(d: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/** Clave de dedupe: un aviso por número por hora UTC. */
export function dedupeKeyTopeHora(phone: string, ahora: Date): string {
  return `sms_tope_hora:${phone}:${ahora.toISOString().slice(0, 13)}`;
}

export interface AvisoTopeSms {
  /** E.164 sin "+", ya normalizado por start-otp. */
  phone: string;
  /** Cuántos códigos se permiten en la ventana (para que el correo no mienta). */
  maxPorHora: number;
  /** IP de quien pidió, si se pudo resolver. */
  ip?: string;
  /** Cuándo vuelve a poder pedir, según el rate limit. */
  retryAfter?: Date;
}

/**
 * Avisa (una vez por número y por hora) que alguien agotó sus códigos de la
 * hora. Devuelve true solo si este request fue el que mandó el aviso.
 */
export async function avisarTopeSmsPorHora(aviso: AvisoTopeSms): Promise<boolean> {
  const ahora = new Date();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("admin_alerts").insert({
      kind: "sms_rate_limit",
      title: `Tope de ${aviso.maxPorHora} códigos por hora alcanzado`,
      body: [
        `Celular: +${aviso.phone}`,
        `Momento: ${horaColombia(ahora)} (Colombia)`,
        aviso.ip ? `IP: ${aviso.ip}` : null,
        aviso.retryAfter ? `Puede volver a pedir: ${horaColombia(aviso.retryAfter)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      dedupe_key: dedupeKeyTopeHora(aviso.phone, ahora),
    });

    if (error) {
      // 23505 = unique_violation: ya avisamos por este número en esta hora.
      if (error.code === "23505") return false;
      console.error("[sms-tope] no se pudo registrar la alerta:", error.message);
      // Sin fila no hay dedupe confiable, así que tampoco se manda el correo:
      // es preferible perder un aviso que inundar el buzón en un bucle.
      return false;
    }
  } catch (e) {
    console.error(
      "[sms-tope] excepción registrando la alerta:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }

  console.warn(
    `[sms-tope] tel=${cola(aviso.phone)} agotó ${aviso.maxPorHora} códigos en una hora`,
  );
  await mandarCorreo(aviso, ahora);
  return true;
}

async function mandarCorreo(aviso: AvisoTopeSms, ahora: Date): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.FEEDBACK_NOTIFY_EMAIL?.trim() || process.env.ADMIN_ALERT_EMAIL?.trim();
  if (!apiKey || !to) {
    console.warn("[sms-tope] sin RESEND_API_KEY o correo de destino — no se manda el aviso");
    return;
  }

  const html = `
    <h2>Alguien pidió ${escapeHtml(aviso.maxPorHora)} códigos de acceso en una hora</h2>
    <p>Ese número ya no recibe más SMS hasta que se libere la ventana. Puede ser
       una persona que no está recibiendo los mensajes —y entonces hay que
       escribirle— o alguien probando el login a repetición.</p>
    <ul>
      <li><b>Celular:</b> +${escapeHtml(aviso.phone)}</li>
      <li><b>Momento:</b> ${escapeHtml(horaColombia(ahora))} (Colombia)</li>
      ${aviso.ip ? `<li><b>IP:</b> ${escapeHtml(aviso.ip)}</li>` : ""}
      ${aviso.retryAfter ? `<li><b>Vuelve a poder pedir:</b> ${escapeHtml(horaColombia(aviso.retryAfter))}</li>` : ""}
    </ul>
    <p>Para ver si los SMS anteriores llegaron al celular, el histórico de
       entregas está en la tabla <code>sms_entregas</code> y en el panel de
       LabsMobile.</p>
    <p><small>Un aviso por número y por hora: si esa persona sigue intentando,
       no vas a recibir un correo por intento.</small></p>
  `;

  try {
    const from = process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to,
      subject: `[La Polla] Tope de códigos por hora — +${aviso.phone}`,
      html,
    });
    if (error) {
      console.error("[sms-tope] Resend rechazó el aviso:", error.message);
    }
  } catch (e) {
    console.error("[sms-tope] excepción enviando el aviso:", e instanceof Error ? e.message : e);
  }
}
