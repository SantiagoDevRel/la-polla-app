// lib/telegram-player/notify.ts — Aviso al jugador por Telegram cuando un
// administrador confirma o rechaza su comprobante.
//
// Hasta aquí ese aviso solo salía por WhatsApp, que está apagado (el número del
// bot es de otra app): la persona se enteraba solo si abría la web. Si su cuenta
// de La Polla está vinculada a Telegram (telegram_login_identities), le llega en
// el chat con el siguiente paso. Mejor esfuerzo: nunca rompe la revisión.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createLoginBotClient, type LoginBotClient } from "@/lib/auth/telegram-login/bot-api";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { formatCop } from "@/lib/casa/format";
import { redactId } from "@/lib/log";
import { cbNew, shortId } from "./ids";
import { esc } from "./context";

export interface ReviewNotice {
  userId: string;
  pollaId: string;
  pollaName: string;
  kind: string;
  approved: boolean;
  prizeKind: "pozo" | "objeto";
  prizeObject: string | null;
  pozoCop: number;
  rejectReason: string | null;
  ticketNumber: number | null;
  /** Participación en pollas de partidos/preguntas (migración 131). */
  entryNumber?: number | null;
}

export function reviewNoticeMessage(n: ReviewNotice): { text: string; buttons: Array<Array<{ text: string; callback_data: string }>> } {
  const P = shortId(n.pollaId);
  const ticket = n.ticketNumber != null ? ` (boleta ${n.ticketNumber})`
    : n.entryNumber != null && n.entryNumber > 1 ? ` (cupo ${n.entryNumber})` : "";
  if (n.approved) {
    return {
      text: [
        `✅ <b>Confirmamos tu pago de ${esc(n.pollaName)}${ticket}.</b>`,
        "",
        n.prizeKind === "objeto"
          ? `Ya participas por ${esc(n.prizeObject ?? "el premio")}.`
          : `Ya participas por el premio. El pozo va en ${formatCop(n.pozoCop)}.`,
        n.kind === "partidos" ? "Haz tus pronósticos antes de que empiece cada partido." : n.kind === "manual" ? "Responde las preguntas antes del cierre." : null,
      ].filter((l) => l !== null).join("\n"),
      // cbNew: tocar un botón no borra este aviso del chat.
      buttons: [
        ...(n.kind === "partidos" ? [[{ text: "⚽ Pronosticar", callback_data: cbNew("pk", P) }]] : []),
        ...(n.kind === "manual" ? [[{ text: "📝 Responder preguntas", callback_data: cbNew("q", P) }]] : []),
        [{ text: "👉 Ver la polla", callback_data: cbNew("p", P) }],
      ],
    };
  }
  return {
    text: [
      `❌ <b>No pudimos confirmar tu pago de ${esc(n.pollaName)}${ticket}.</b>`,
      n.rejectReason ? `Motivo: ${esc(n.rejectReason)}` : null,
      "",
      "Revisa el comprobante. Si ya transferiste, no repitas el pago: envía el comprobante correcto o escríbenos en soporte.",
    ].filter((l) => l !== null).join("\n"),
    buttons: [[
      n.kind === "rifa"
        ? n.ticketNumber != null
          ? { text: `📸 Enviar el comprobante de la boleta ${n.ticketNumber}`, callback_data: cbNew("rt", P, n.ticketNumber) }
          : { text: "👉 Ver mis boletas", callback_data: cbNew("p", P) }
        : { text: "📸 Enviar el comprobante correcto", callback_data: cbNew("j", P) },
    ]],
  };
}

type NoticeButton = { text: string; callback_data: string } | { text: string; url: string };

/** Busca el Telegram vinculado y le manda el mensaje. Devuelve si salió. */
async function sendToLinkedTelegram(
  db: SupabaseClient,
  userId: string,
  message: { text: string; buttons: NoticeButton[][] },
  client: LoginBotClient | undefined,
  label: string,
): Promise<boolean> {
  const config = getTelegramLoginConfig();
  if (!config) return false;
  try {
    const { data, error } = await db
      .from("telegram_login_identities")
      .select("telegram_user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const telegramUserId = Number((data as { telegram_user_id?: unknown } | null)?.telegram_user_id);
    if (error || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return false;
    const bot = client ?? createLoginBotClient(config.botToken);
    return await bot.send("sendMessage", {
      chat_id: telegramUserId,
      text: message.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: message.buttons },
    });
  } catch (err) {
    console.warn(`[telegram-player] aviso de ${label} no enviado:`, redactId(userId), (err as Error).name);
    return false;
  }
}

export function notifyPlayerReviewByTelegram(
  db: SupabaseClient,
  notice: ReviewNotice,
  client?: LoginBotClient,
): Promise<boolean> {
  return sendToLinkedTelegram(db, notice.userId, reviewNoticeMessage(notice), client, "revisión");
}

export interface ReferralGiftNotice {
  userId: string;
  pollaName: string;
  pollaSlug: string;
  entryNumber: number;
  /** Invitados que ya cuentan en esa polla. */
  invited: number;
}

/**
 * Cupo de regalo por invitar (migración 135). El bot todavía pronostica solo
 * con el cupo principal, así que el botón abre ese cupo en la web.
 */
export function referralGiftMessage(n: ReferralGiftNotice): { text: string; buttons: NoticeButton[][] } {
  const url = `https://lapollacolombiana.com/casa/${encodeURIComponent(n.pollaSlug)}?p=${n.entryNumber}`;
  return {
    text: [
      `🎁 <b>¡Ganaste un cupo de regalo en ${esc(n.pollaName)}!</b>`,
      "",
      n.invited > 0
        ? `${n.invited} ${n.invited === 1 ? "persona que invitaste ya pagó" : "personas que invitaste ya pagaron"} esta polla.`
        : "Las personas que invitaste ya pagaron esta polla.",
      `Tu cupo ${n.entryNumber} ya está activo y compite por el premio.`,
    ].join("\n"),
    buttons: [[{ text: `👉 Pronosticar con el cupo ${n.entryNumber}`, url }]],
  };
}

export function notifyReferralGiftByTelegram(
  db: SupabaseClient,
  notice: ReferralGiftNotice,
  client?: LoginBotClient,
): Promise<boolean> {
  return sendToLinkedTelegram(db, notice.userId, referralGiftMessage(notice), client, "cupo de regalo");
}
