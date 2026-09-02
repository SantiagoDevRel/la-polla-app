// lib/sms/entregas.ts
// Registro y vigilancia de la ENTREGA de los SMS de login.
//
// El problema que resuelve está contado en supabase/migrations/088: LabsMobile
// devolviendo `code 0` solo dice que ACEPTÓ el mensaje. La noche del 2026-08-10
// (en los-del-sur-app) aceptó dos y los entregó 2h35m después, con el código
// ya vencido — y no había forma de saberlo. Acá se cierra ese lazo: cada envío
// queda anotado y el acuse de entrega (DLR) lo vuelve a buscar.
//
// REGLA DE ORO DE ESTE ARCHIVO: nada de acá puede tumbar un login. Todas las
// funciones son fail-soft — si la tabla no existe, si Supabase está caído o si
// el correo falla, se loguea y se sigue. Un usuario tratando de entrar no puede
// pagar el precio de nuestra telemetría.
//
// Excepción: `registrarEnvio` SÍ es fail-closed para el hook (devuelve false).
// Sin fila no hay forma de correlacionar el DLR; el hook prefiere no gastar
// el crédito a declarar éxito a ciegas.

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseLabsMobileTimestamp } from "@/lib/sms/labsmobile-ack";

/**
 * Cuánto silencio tolera el vigía antes de avisar que un SMS no llegó.
 *
 * 5 minutos con un código que vive 10 es deliberado: cuando salta la alerta
 * todavía quedan ~5 minutos de validez, así que hay margen para reaccionar
 * en vez de enterarse del entierro.
 *
 * El código de Supabase vive **600 segundos** (`SMS_OTP_EXP`). A los 120 s el
 * código TODAVÍA SIRVE: el umbral de "llegó tarde" en `aplicar_sms_ack` no
 * marca "se murió", marca "algo va mal en la ruta". Lo normal medido en la
 * cuenta de LabsMobile son 2 s, 3 s y 14 s.
 */
export const UMBRAL_SILENCIO_MIN = 5;

/** Últimos 4 dígitos, para los logs de Vercel (el número entero no va a logs). */
function cola(phone: string): string {
  return `***${phone.slice(-4)}`;
}

/**
 * Escapa HTML para meter texto (teléfono, subid, detalle) dentro del correo
 * de alerta. El correo es una superficie de render más.
 */
function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Anota un SMS antes de despacharlo. El `subid` lo generamos nosotros y es la
 * clave con la que LabsMobile nos va a hablar después.
 */
export async function registrarEnvio(subid: string, phone: string): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("sms_entregas")
      .insert({ subid, phone, dispatch_status: "pending" });
    if (error) {
      console.error(`[sms-entregas] no se pudo anotar el envío ${subid}:`, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sms-entregas] excepción anotando el envío:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Guarda si el POST fue aceptado o quedó sin respuesta. Un DLR posterior
 * promueve pending/ambiguous a accepted dentro de `aplicar_sms_ack`. */
export async function registrarResultadoDespacho(
  subid: string,
  status: "accepted" | "ambiguous",
  detalle?: string,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("sms_entregas")
      .update({
        dispatch_status: status,
        dispatch_updated_at: new Date().toISOString(),
        ...(status === "ambiguous"
          ? { descripcion: (detalle ?? "respuesta_ambigua").slice(0, 120) }
          : {}),
      })
      .eq("subid", subid)
      .in("dispatch_status", ["pending", "ambiguous"]);
    if (error) {
      console.error(`[sms-entregas] no se pudo marcar despacho ${subid}:`, error.message);
    }
  } catch (error) {
    console.error(
      "[sms-entregas] excepción marcando despacho:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Marca un rechazo inequívoco del proveedor; un timeout queda pendiente. */
export async function registrarFalloEnvio(
  subid: string,
  phone: string,
  code: string | undefined,
  error: string | undefined,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const ahora = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("sms_entregas")
      .update({
        dispatch_status: "rejected",
        dispatch_updated_at: ahora,
        last_ack_at: ahora,
        acklevel: "error",
        status: "ko",
        descripcion: (code ? `code_${code}` : error ?? "envio_rechazado").slice(0, 120),
        alertado_at: ahora,
      })
      .eq("subid", subid);
    if (updateError) {
      console.error(`[sms-entregas] no se pudo marcar fallo ${subid}:`, updateError.message);
      return;
    }
    await avisar({
      titulo: "Un SMS de login fue rechazado antes de salir",
      phone,
      subid,
      detalle: `LabsMobile rechazó el envío (${code ?? error ?? "sin detalle"}).`,
    });
  } catch (e) {
    console.error("[sms-entregas] excepción marcando fallo:", e instanceof Error ? e.message : e);
  }
}

interface Acuse {
  subid: string;
  /** gateway | operator | handset | error */
  acklevel: string;
  /** ok | ko */
  status: string;
  /** DELIVRD | REJECTD | EXPIRED | UNDELIV | BLOCKED | UNKNOWN */
  desc: string;
  /** Momento del evento en el proveedor, `YYYY-MM-DD HH:MM:SS` GMT. */
  timestamp?: string | null;
  /** Destinatario reportado por el proveedor, E.164 sin +. */
  msisdn?: string | null;
}

/**
 * Procesa un acuse de entrega y, si pinta mal, avisa.
 *
 * LabsMobile puede llamar VARIAS veces por el mismo mensaje, una por nivel
 * (gateway → operator → handset). Solo `handset` significa que el celular lo
 * tiene; los otros son escalas del camino. Por eso `delivered_at` se llena
 * únicamente con ese nivel y `last_ack_at` va guardando todos.
 */
export async function registrarAcuse(a: Acuse): Promise<void> {
  try {
    const supabase = createAdminClient();

    // Leemos solo lo necesario para validar el reloj del proveedor. La
    // transición y el claim de alerta ocurren luego dentro de una RPC con
    // SELECT FOR UPDATE; este SELECT no decide ningún estado.
    const { data: fila, error: errLectura } = await supabase
      .from("sms_entregas")
      .select("subid, phone, sent_at")
      .eq("subid", a.subid)
      .maybeSingle();

    if (errLectura) {
      console.error(`[sms-ack] no se pudo leer ${a.subid}:`, errLectura.message);
      return;
    }
    if (!fila) {
      // Puede pasar legítimamente: un acuse de un SMS anterior a esta feature,
      // o un reintento muy tardío. No es un error nuestro y no hay nada que
      // actualizar — pero se deja constancia por si aparece un patrón.
      console.warn(`[sms-ack] acuse de un subid desconocido: ${a.subid}`);
      return;
    }

    const ahora = new Date();
    // `ahora` mide cuándo NOS llegó el callback; no cuándo llegó el SMS. En el
    // incidente original el callback tardó 33-66 s, aunque el handset ACK del
    // proveedor ocurrió en 2-4 s. Para delivered_at/demora usamos el reloj de
    // LabsMobile y solo degradamos al nuestro si el parámetro viene inválido.
    const timestampParseado = parseLabsMobileTimestamp(a.timestamp);
    const sentAt = new Date(fila.sent_at);
    const timestampCoherente =
      timestampParseado &&
      timestampParseado.getTime() >= sentAt.getTime() - 5_000 &&
      timestampParseado.getTime() <= ahora.getTime() + 5 * 60_000;
    const momentoProveedor = timestampCoherente ? timestampParseado : ahora;
    if (a.timestamp && !timestampCoherente) {
      console.warn(`[sms-ack] timestamp inválido/incoherente para ${a.subid}; se usa recepción`);
    }

    const msisdn = a.msisdn?.replace(/\D/g, "") ?? "";
    if (msisdn && msisdn !== fila.phone) {
      console.error(`[sms-ack] destinatario no coincide para ${a.subid}; se descarta`);
      return;
    }

    const { data: rpcData, error: errUpdate } = await supabase.rpc("aplicar_sms_ack", {
      p_subid: a.subid,
      p_acklevel: a.acklevel,
      p_status: a.status,
      p_descripcion: a.desc,
      p_event_at: momentoProveedor.toISOString(),
      p_msisdn: msisdn || null,
    });
    if (errUpdate) {
      console.error(`[sms-ack] no se pudo aplicar ${a.subid}:`, errUpdate.message);
      return;
    }
    const resultado = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
      | { applied: boolean; phone: string; alert_kind: "failed" | "late" | null; demora_seg: number }
      | null;
    if (!resultado?.applied) {
      console.warn(`[sms-ack] acuse no aplicable para ${a.subid}; se ignora`);
      return;
    }
    const demoraSeg = resultado.demora_seg;

    console.log(
      `[sms-ack] subid=${a.subid} tel=${cola(fila.phone)} nivel=${a.acklevel} estado=${a.status} desc=${a.desc} demora=${demoraSeg}s`,
    );

    if (resultado.alert_kind) {
      await avisar({
        titulo: resultado.alert_kind === "failed"
          ? "Un SMS de login NO se pudo entregar"
          : `Un SMS de login llegó ${Math.round(demoraSeg / 60)} min tarde`,
        phone: resultado.phone,
        subid: a.subid,
        detalle: resultado.alert_kind === "failed"
          ? `El operador lo rechazó (${a.desc}). Esa persona no pudo entrar por SMS.`
          : `Tardó ${demoraSeg} s en llegar al celular, cuando lo normal en esta cuenta son 2-14 s. El código vive 10 minutos, así que ${demoraSeg > 600 ? "cuando llegó ya no servía" : "todavía alcanzó a servir — pero la ruta está lenta"}.`,
      });
    }
  } catch (e) {
    console.error("[sms-ack] excepción procesando el acuse:", e instanceof Error ? e.message : e);
  }
}

/**
 * El correo de alerta. Va con el número COMPLETO a propósito: el sentido de
 * esta alerta es poder escribirle a la persona que se quedó afuera. Con los
 * últimos 4 dígitos habría que ir a buscar a la base, y eso convierte un aviso
 * accionable en una tarea pendiente. Solo se manda a FEEDBACK_NOTIFY_EMAIL,
 * nunca a un tercero.
 *
 * Fail-soft: si faltan envs o Resend falla, se loguea y se sigue.
 */
async function avisar(p: {
  titulo: string;
  phone: string;
  subid: string;
  detalle: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.FEEDBACK_NOTIFY_EMAIL?.trim();
  if (!apiKey || !to) {
    console.warn("[sms-entregas] alerta sin RESEND_API_KEY o FEEDBACK_NOTIFY_EMAIL — no se manda correo");
    return;
  }

  const html = `
    <h2>${escapeHtml(p.titulo)}</h2>
    <p>${escapeHtml(p.detalle)}</p>
    <ul>
      <li><b>Celular:</b> +${escapeHtml(p.phone)}</li>
      <li><b>subid LabsMobile:</b> ${escapeHtml(p.subid)}</li>
    </ul>
    <p>El histórico completo del envío está en el panel de LabsMobile
       (Histórico → buscar por subid).</p>
    <p><small>Si esto se repite varias veces en la misma franja horaria, es la
       ruta del proveedor, no un caso suelto.</small></p>
  `;

  try {
    const from = process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to,
      subject: `[La Polla] ${p.titulo}`,
      html,
    });
    if (error) {
      console.error("[sms-entregas] Resend rechazó el aviso:", error.message);
    }
  } catch (e) {
    console.error(
      "[sms-entregas] excepción enviando aviso:",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * El vigía: SMS despachados hace más de UMBRAL_SILENCIO_MIN que todavía no
 * tienen acuse de entrega. Este es el caso del incidente del 2026-08-10 — el
 * acuse no llegó nunca (hasta 2h35m después), así que esperar el DLR para
 * enterarse no alcanza: hay que ir a buscar el silencio.
 *
 * Devuelve cuántos avisó, para que un cron lo loguee.
 *
 * ⚠️ En este puerto todavía no hay cron cableado (`/api/cron/sms-vigia`). La
 * función queda lista; el DLR por `/api/sms/ack` sí corre desde el día uno.
 */
export async function revisarSilencios(): Promise<number> {
  const corte = new Date(Date.now() - UMBRAL_SILENCIO_MIN * 60_000).toISOString();

  const supabase = createAdminClient();
  const { data: colgados, error } = await supabase
    .from("sms_entregas")
    .select("subid, phone, sent_at, dispatch_status")
    .is("delivered_at", null)
    .is("alertado_at", null)
    .lt("sent_at", corte)
    .order("sent_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[sms-vigia] no se pudo leer la cola:", error.message);
    return 0;
  }
  if (!colgados?.length) return 0;

  // Se marcan ANTES de mandar el correo: si el envío falla o la función se
  // corta a la mitad, el peor caso es no avisar de uno. Al revés (avisar y no
  // marcar) el próximo tick repetiría el correo cada 5 minutos para siempre.
  const ahora = new Date().toISOString();
  await supabase
    .from("sms_entregas")
    .update({ alertado_at: ahora })
    .in(
      "subid",
      colgados.map((c) => c.subid),
    );

  for (const c of colgados) {
    const minutos = Math.round((Date.now() - new Date(c.sent_at).getTime()) / 60_000);
    console.warn(`[sms-vigia] sin acuse hace ${minutos} min: subid=${c.subid} tel=${cola(c.phone)}`);
    await avisar({
      titulo: "Un SMS de login lleva minutos sin llegar",
      phone: c.phone,
      subid: c.subid,
      detalle:
        (c.dispatch_status === "ambiguous"
          ? `El POST a LabsMobile quedó sin respuesta hace ${minutos} minutos; pudo haberlo aceptado, pero no sabemos si llegó al celular. `
          : `LabsMobile lo aceptó hace ${minutos} minutos y todavía no confirma que `) +
        (c.dispatch_status === "ambiguous" ? "" : "haya llegado al celular. ") +
        `El código vive 10 minutos, así que si el SMS ` +
        `aparece en los próximos ${Math.max(0, 10 - minutos)} todavía sirve — ` +
        `después esa persona se queda afuera. Si hay varios juntos, la ruta del ` +
        `proveedor está atascada (pasó el 2026-08-10).`,
    });
  }

  return colgados.length;
}
