// lib/email/casa-issues.ts — Resend wrapper para avisar al administrador de
// cada caso nuevo de /admin/issues (migración 121). Mismo patrón que
// lib/email/feedback.ts: RESEND_API_KEY y RESEND_FROM_EMAIL del servidor.
//
// resend 6.x no lanza ante un rechazo: devuelve { data: null, error }. Este
// wrapper lo convierte en un código corto (sin mensaje del proveedor, que puede
// traer la dirección del destinatario) para guardarlo en la base y en el log.
import { Resend } from "resend";

export interface CasaIssueEmail {
  to: string[];
  subject: string;
  text: string;
}

export type CasaIssueEmailResult = { ok: true } | { ok: false; errorCode: string };

/** Destinatarios: CASA_ISSUES_NOTIFY_EMAIL, si no ADMIN_ALERT_EMAIL, si no FEEDBACK_NOTIFY_EMAIL.
 * Admite varias direcciones separadas por coma. */
export function casaIssueRecipients(env: Record<string, string | undefined> = process.env): string[] {
  const raw = [env.CASA_ISSUES_NOTIFY_EMAIL, env.ADMIN_ALERT_EMAIL, env.FEEDBACK_NOTIFY_EMAIL]
    .find((value) => typeof value === "string" && value.trim() !== "") ?? "";
  return raw.split(",").map((value) => value.trim()).filter((value) => /^[^\s@]+@[^\s@]+$/.test(value));
}

/** Código de error apto para `casa_match_issues.notify_last_error` (^[a-z0-9_.:-]{1,64}$). */
export function emailErrorCode(name: unknown, statusCode?: unknown): string {
  const base = String(name ?? "resend_error").toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "") || "resend_error";
  const status = typeof statusCode === "number" && Number.isInteger(statusCode) ? `_${statusCode}` : "";
  return `${base.slice(0, 64 - status.length)}${status}`;
}

export async function sendCasaIssueEmail({ to, subject, text }: CasaIssueEmail): Promise<CasaIssueEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, errorCode: "missing_resend_api_key" };
  if (to.length === 0) return { ok: false, errorCode: "missing_recipient" };
  const from = process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";
  try {
    const { error } = await new Resend(apiKey).emails.send({ from, to, subject, text });
    if (error) return { ok: false, errorCode: emailErrorCode(error.name, error.statusCode) };
    return { ok: true };
  } catch {
    return { ok: false, errorCode: "exception" };
  }
}
