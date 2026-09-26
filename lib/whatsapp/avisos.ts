// lib/whatsapp/avisos.ts — Avisos de WhatsApp que el bot envía primero
// (plantillas aprobadas por Meta), compartidos por los crons de Casa.
//
// (2026-09-26) Número propio +1 856-483-1652 (WABA «La Polla Colombiana»).
// Tres plantillas, todas con un botón «https://lapollacolombiana.com/polla/{{1}}»
// cuyo parámetro es el slug de la polla Casa:
//   - lp_pronosticos_hoy      {{1}} nombre · {{2}} polla · {{3}} partidos sin pronóstico
//   - lp_polla_cierra  {{1}} nombre · {{2}} polla · {{3}} «3 horas» / «40 minutos»
//   - lp_polla_nueva  {{1}} nombre · {{2}} polla
// Las tres terminan en «Responde BAJA si no quieres más avisos»: el webhook
// guarda la baja en wa_avisos_opt_out (migración 152) y aquí se respeta.
//
// Límite de Meta: TIER_250 = 250 destinatarios ÚNICOS por 24 h móviles en
// mensajes que inicia el negocio. RecipientBudget lo cuenta contra
// wa_template_sends para no pasarse (el excedente Meta lo rechaza igual, pero
// quedaría como fallo cobrado en nuestra bitácora).

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/auth/phone";
import {
  sendTemplateMessage,
  estimateTemplateCost,
  type TemplateComponent,
} from "./template";

export type AvisoTemplate = "lp_pronosticos_hoy" | "lp_polla_cierra" | "lp_polla_nueva";

export const AVISO_LANGUAGE = "es";

// Se enviaron a revisión como UTILITY, pero Meta suele reclasificar los
// recordatorios a MARKETING (pasó con la primera tanda). Se registra el costo
// del peor caso hasta confirmar la categoría aprobada.
export const AVISO_CATEGORY = "marketing" as const;

type Db = ReturnType<typeof createAdminClient>;

// ─── Funciones puras (tests/whatsapp-avisos.test.ts) ───

function normalizeWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z ]/g, "")
    .trim()
    .toUpperCase();
}

/** «BAJA», «baja.», «Stop» → dar de baja. Solo el mensaje completo, no una frase que la contenga. */
export function isOptOutText(text: string): boolean {
  return ["BAJA", "STOP", "DARME DE BAJA"].includes(normalizeWord(text));
}

/** «ALTA» → volver a recibir avisos. */
export function isOptInText(text: string): boolean {
  return normalizeWord(text) === "ALTA";
}

/** Nombre de pila para el saludo; nunca vacío. */
export function firstNameFor(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  return first || "hola";
}

/** Tiempo hasta el cierre en palabras: «3 horas», «1 hora», «40 minutos». */
export function formatTimeLeft(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

/** Meta rechaza parámetros con saltos de línea, tabs o 4+ espacios seguidos. */
export function cleanParam(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 60);
}

// ─── Datos ───

/** Lee una consulta completa, página por página (PostgREST corta en 1000 filas). */
export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export async function loadOptedOutPhones(db: Db): Promise<Set<string>> {
  const rows = await selectAllPages<{ phone: string }>((from, to) =>
    db.from("wa_avisos_opt_out").select("phone").range(from, to));
  return new Set(rows.map((r) => r.phone));
}

export async function setOptOut(phoneRaw: string, optedOut: boolean): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  if (!/^[0-9]{8,15}$/.test(phone)) return;
  const db = createAdminClient();
  const { error } = optedOut
    ? await db.from("wa_avisos_opt_out").upsert({ phone }, { onConflict: "phone", ignoreDuplicates: true })
    : await db.from("wa_avisos_opt_out").delete().eq("phone", phone);
  if (error) throw new Error(error.message);
}

/** Usuarios con número, sin baja. Clave = user_id. */
export interface AvisoRecipient { userId: string; phone: string; firstName: string }

export async function loadRecipients(db: Db, userIds: string[]): Promise<Map<string, AvisoRecipient>> {
  const optOut = await loadOptedOutPhones(db);
  const out = new Map<string, AvisoRecipient>();
  for (let i = 0; i < userIds.length; i += 300) {
    const { data, error } = await db
      .from("users")
      .select("id, display_name, whatsapp_number")
      .in("id", userIds.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const u of data ?? []) {
      const phone = normalizePhone(u.whatsapp_number ?? "");
      if (!/^[0-9]{8,15}$/.test(phone) || optOut.has(phone)) continue;
      out.set(u.id, { userId: u.id, phone, firstName: firstNameFor(u.display_name) });
    }
  }
  return out;
}

/**
 * Tope de destinatarios únicos en 24 h móviles. Un número que ya recibió algo
 * en esa ventana no gasta cupo nuevo.
 */
export class RecipientBudget {
  private constructor(private contacted: Set<string>, private remaining: number) {}

  static async load(db: Db, now = Date.now()): Promise<RecipientBudget> {
    const cap = Number(process.env.WHATSAPP_DAILY_RECIPIENT_CAP ?? "240");
    const since = new Date(now - 24 * 60 * 60_000).toISOString();
    const rows = await selectAllPages<{ phone: string }>((from, to) =>
      db.from("wa_template_sends").select("phone").eq("status", "sent").gte("created_at", since).range(from, to));
    const contacted = new Set(rows.map((r) => normalizePhone(r.phone)));
    return new RecipientBudget(contacted, Math.max(0, (Number.isFinite(cap) ? cap : 240) - contacted.size));
  }

  canSend(phone: string): boolean {
    return this.contacted.has(phone) || this.remaining > 0;
  }

  markSent(phone: string): void {
    if (this.contacted.has(phone)) return;
    this.contacted.add(phone);
    this.remaining--;
  }
}

/** Envía una plantilla y deja el registro en wa_template_sends (con o sin éxito). */
export async function sendAviso(db: Db, input: {
  recipient: AvisoRecipient;
  template: AvisoTemplate;
  bodyParams: string[];
  pollaSlug: string;
  variables: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string; optedOut?: boolean }> {
  // La baja se vuelve a mirar justo antes de enviar: alguien pudo responder
  // BAJA mientras la corrida avanzaba con la lista que cargó al empezar.
  const { data: optOut } = await db
    .from("wa_avisos_opt_out").select("phone").eq("phone", input.recipient.phone).maybeSingle();
  if (optOut) return { ok: false, optedOut: true };

  const components: TemplateComponent[] = [
    { type: "body", parameters: input.bodyParams.map((text) => ({ type: "text" as const, text: cleanParam(text) })) },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: input.pollaSlug }] },
  ];
  const result = await sendTemplateMessage(input.recipient.phone, input.template, AVISO_LANGUAGE, components);
  const { error: logError } = await db.from("wa_template_sends").insert({
    user_id: input.recipient.userId,
    phone: input.recipient.phone,
    template_name: input.template,
    variables: input.variables,
    meta_message_id: result.messageId ?? null,
    status: result.ok ? "sent" : "failed",
    error: result.error ?? null,
    cost_usd: result.ok ? estimateTemplateCost(AVISO_CATEGORY) : 0,
    category: AVISO_CATEGORY,
  });
  // Sin este registro, la siguiente corrida no sabe que ya se envió.
  if (logError) console.error(`[wa-avisos] ${input.template} enviado sin registro:`, logError.message);
  return { ok: result.ok, error: result.error };
}
