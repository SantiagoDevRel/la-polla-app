// lib/email/feedback.ts — Resend wrapper para alertas de feedback al admin.
// El free tier de Resend deja enviar desde onboarding@resend.dev al email
// dueño de la cuenta sin verificar dominio — suficiente para alertas
// internas. Cuando mandemos email a usuarios reales, hay que verificar
// dominio propio y mover RESEND_FROM_EMAIL.
import { Resend } from "resend";

interface SendFeedbackEmailArgs {
  to: string;
  fromUser: { id: string; whatsapp_number: string | null };
  message: string;
  pageUrl: string | null;
  userAgent: string | null;
}

export async function sendFeedbackEmail({
  to,
  fromUser,
  message,
  pageUrl,
  userAgent,
}: SendFeedbackEmailArgs) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[email] Missing RESEND_API_KEY — refusing to send feedback email.",
    );
  }
  const from =
    process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";

  const resend = new Resend(apiKey);

  const subject = `[La Polla] Feedback de ${fromUser.whatsapp_number ?? fromUser.id}`;

  const text = [
    `User ID:   ${fromUser.id}`,
    `WhatsApp:  ${fromUser.whatsapp_number ?? "—"}`,
    `Página:    ${pageUrl ?? "—"}`,
    `User-Agent: ${userAgent ?? "—"}`,
    "",
    "Mensaje:",
    message,
  ].join("\n");

  return resend.emails.send({ from, to, subject, text });
}
