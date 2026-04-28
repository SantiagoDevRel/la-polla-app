// lib/notifications/admin-alert.ts — Helper para alertar al admin
// (vía WhatsApp + email) cuando algo importante pasa: discrepancia de
// scores entre fuentes, sync con errores acumulados, partido sin
// verificar después de mucho tiempo, etc.
//
// Reusa los helpers existentes de lib/whatsapp/bot.ts y
// lib/email/feedback.ts. Free-tier friendly: best-effort, ignora
// fallos para no romper la sync.
//
// Env vars:
//   FEEDBACK_NOTIFY_WHATSAPP — número admin (E.164 sin +).
//   FEEDBACK_NOTIFY_EMAIL    — email admin.
//   RESEND_API_KEY           — para email.
//   META_WA_ACCESS_TOKEN     — para WhatsApp.
//
// Si una env var falta, ese canal se skipea silently. La función
// nunca lanza — return de status para logging del caller.

import { sendTextMessage } from "@/lib/whatsapp/bot";
import { Resend } from "resend";

export interface AdminAlertArgs {
  /** Título corto. Se muestra como subject del email + primer línea WA. */
  title: string;
  /** Cuerpo más detallado. Markdown-ish acceptado. */
  body: string;
  /** Tag para categorizar y deduplicar alerts. */
  category: "score_mismatch" | "sync_failure" | "verification_timeout" | "espn_outage" | "other";
}

export interface AdminAlertResult {
  whatsapp: { sent: boolean; error?: string };
  email: { sent: boolean; error?: string };
}

export async function notifyAdmin({ title, body, category }: AdminAlertArgs): Promise<AdminAlertResult> {
  const result: AdminAlertResult = {
    whatsapp: { sent: false },
    email: { sent: false },
  };

  // ── WhatsApp ──────────────────────────────────────────────────────
  const waPhone = process.env.FEEDBACK_NOTIFY_WHATSAPP?.trim();
  if (waPhone) {
    try {
      const text = `⚠️ *${title}*\n\n${body}\n\n_Alert: ${category}_\n_${new Date().toISOString()}_`;
      await sendTextMessage(waPhone, text);
      result.whatsapp.sent = true;
    } catch (err) {
      result.whatsapp.error = err instanceof Error ? err.message : String(err);
      console.error("[admin-alert] WhatsApp failed:", result.whatsapp.error);
    }
  }

  // ── Email ─────────────────────────────────────────────────────────
  const adminEmail = process.env.FEEDBACK_NOTIFY_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (adminEmail && apiKey) {
    try {
      const from = process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from,
        to: adminEmail,
        subject: `[La Polla][${category}] ${title}`,
        text: `${body}\n\n---\nCategory: ${category}\nTimestamp: ${new Date().toISOString()}`,
      });
      result.email.sent = true;
    } catch (err) {
      result.email.error = err instanceof Error ? err.message : String(err);
      console.error("[admin-alert] Email failed:", result.email.error);
    }
  }

  return result;
}
