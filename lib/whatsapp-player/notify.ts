// lib/whatsapp-player/notify.ts — Avisos del bot de WhatsApp (pago confirmado
// o rechazado, cupo de regalo).
//
// La app no puede llamar a OpenWA: el aviso queda en whatsapp_bot_outbox y el
// relay del DGX lo reclama y lo envía. Solo a quien ya le escribió al bot
// (tiene fila en whatsapp_bot_chats): nunca mensajes a números que no
// iniciaron la conversación. Mejor esfuerzo: nunca rompe la revisión.

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactId } from "@/lib/log";
import type { Screen } from "@/lib/telegram-player/context";
import { referralGiftMessage, reviewNoticeMessage, type ReferralGiftNotice, type ReviewNotice } from "@/lib/telegram-player/notify";
import { getWhatsAppBotConfig, phoneAllowed } from "./config";
import { renderScreen } from "./format";
import { getZernioBotConfig } from "@/lib/whatsapp-zernio/config";
import { notifyZernioReview, notifyZernioReferralGift } from "@/lib/whatsapp-zernio/notify";

type OutboxKind = "review" | "referral_gift";

async function enqueue(db: SupabaseClient, userId: string, kind: OutboxKind, screen: Screen): Promise<boolean> {
  const config = getWhatsAppBotConfig();
  if (!config) return false;
  try {
    const { data, error } = await db.from("whatsapp_bot_chats").select("phone").eq("user_id", userId).maybeSingle();
    const phone = (data as { phone?: string } | null)?.phone;
    if (error || !phone || !phoneAllowed(config, phone)) return false;
    const rendered = renderScreen(screen, "num");
    const { error: insertError } = await db.from("whatsapp_bot_outbox").insert({
      phone, user_id: userId, kind, body: rendered.text, menu: rendered.menu,
    });
    if (insertError) {
      console.warn(`[whatsapp-player] aviso de ${kind} no encolado:`, insertError.code);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[whatsapp-player] aviso de ${kind} no encolado:`, redactId(userId), (err as Error).name);
    return false;
  }
}

export async function notifyPlayerReviewByWhatsApp(db: SupabaseClient, notice: ReviewNotice, eventKey?: string): Promise<boolean> {
  if (getZernioBotConfig()) {
    const sent = await notifyZernioReview(db, notice, eventKey);
    if (sent !== null) return sent;
  }
  return enqueue(db, notice.userId, "review", reviewNoticeMessage(notice));
}

export async function notifyReferralGiftByWhatsApp(db: SupabaseClient, notice: ReferralGiftNotice, eventKey?: string): Promise<boolean> {
  if (getZernioBotConfig()) {
    const sent = await notifyZernioReferralGift(db, notice, eventKey);
    if (sent !== null) return sent;
  }
  return enqueue(db, notice.userId, "referral_gift", referralGiftMessage(notice));
}
