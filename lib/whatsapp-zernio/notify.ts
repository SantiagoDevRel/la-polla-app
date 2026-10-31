import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { referralGiftMessage, reviewNoticeMessage, type ReferralGiftNotice, type ReviewNotice } from "@/lib/telegram-player/notify";
import type { Screen } from "@/lib/telegram-player/context";
import { getZernioBotConfig, serviceWindowOpen, zernioPhoneAllowed } from "./config";
import { deliverTurn } from "./delivery";
import { adaptScreen, menuForScreen, renderZernioMenu } from "./format";

async function notify(db: SupabaseClient, userId: string, eventKey: string | undefined, kind: string, screen: Screen): Promise<boolean | null> {
  const config = getZernioBotConfig();
  // Stable source event keys distinguish two legitimate reviews of the same entry.
  if (!config || !eventKey) return null;
  try {
    const { data: chat, error } = await db.from("whatsapp_bot_chats")
      .select("phone, zernio_conversation_id, zernio_last_inbound_at").eq("user_id", userId).maybeSingle();
    if (error) return false;
    if (!chat || !chat.zernio_conversation_id || !zernioPhoneAllowed(config, chat.phone)) return null;
    if (!serviceWindowOpen(chat.zernio_last_inbound_at)) return false;
    const key = `zn:${createHash("sha256").update(JSON.stringify([kind, userId, eventKey])).digest("hex")}`;
    const outcome = await deliverTurn(db, config, { key, phone: chat.phone, conversationId: chat.zernio_conversation_id }, async () => {
      const { menu, links } = menuForScreen(adaptScreen(screen));
      return { menu, replies: [...renderZernioMenu(menu), ...links] };
    });
    return outcome === "sent" || outcome === "duplicate";
  } catch { return false; }
}

export function notifyZernioReview(db: SupabaseClient, notice: ReviewNotice, eventKey?: string) {
  return notify(db, notice.userId, eventKey, "review", reviewNoticeMessage(notice));
}
export function notifyZernioReferralGift(db: SupabaseClient, notice: ReferralGiftNotice, eventKey?: string) {
  // Keep the next action in the chat instead of sending the player to the web.
  return notify(db, notice.userId, eventKey, "referral_gift", { ...referralGiftMessage(notice),
    buttons: [[{ text: "Pollas disponibles", callback_data: "ol:0" }]] });
}
