import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/whatsapp/bot";
import { sendFeedbackEmail } from "@/lib/email/feedback";

async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work(controller.signal)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("notification deadline")); }, 8_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Best-effort notices run after receipt confirmation and never trigger a retry. */
export async function notifyFeedback(input: { userId: string; message: string; pageUrl: string | null; userAgent: string | null }) {
  const notifyPhone = process.env.FEEDBACK_NOTIFY_WHATSAPP;
  const notifyEmail = process.env.FEEDBACK_NOTIFY_EMAIL;
  if (!notifyPhone && !notifyEmail) return;
  let phone: string | null = null;
  try {
    const { data } = await bounded((signal) => createAdminClient().from("users").select("whatsapp_number").eq("id", input.userId).abortSignal(signal).maybeSingle());
    phone = data?.whatsapp_number ?? null;
  } catch { console.warn("[feedback] notification profile lookup unavailable"); }
  const summary = ["Nuevo feedback en La Polla", `User: ${phone ?? input.userId}`,
    input.pageUrl ? `Página: ${input.pageUrl}` : null, "", input.message.slice(0, 900)].filter(Boolean).join("\n");
  await Promise.allSettled([
    notifyPhone ? bounded((signal) => sendTextMessage(notifyPhone, summary, { signal })).catch(() => { console.warn("[feedback] WhatsApp notice not confirmed"); }) : Promise.resolve(),
    notifyEmail ? bounded((signal) => sendFeedbackEmail({ to: notifyEmail, fromUser: { id: input.userId, whatsapp_number: phone },
      message: input.message, pageUrl: input.pageUrl, userAgent: input.userAgent, signal })).catch(() => { console.warn("[feedback] email notice not confirmed"); }) : Promise.resolve(),
  ]);
}
