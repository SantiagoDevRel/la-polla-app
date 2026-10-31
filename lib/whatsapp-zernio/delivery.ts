import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceWindowOpen, type ZernioBotConfig } from "./config";
import type { ZernioContent } from "./format";
import type { ZernioTurn } from "./channel";
import { sendZernioContent } from "./send";

export interface DeliveryTarget { key: string; phone: string; conversationId: string; sentAt?: string }
export type DeliveryOutcome = "sent" | "duplicate" | "limited" | "ignored" | "failed";

/** SQL claim serializes turns; prepared replies retry without repeating business writes. */
export async function deliverTurn(db: SupabaseClient, config: ZernioBotConfig, target: DeliveryTarget,
  build: () => Promise<ZernioTurn>, options: { now?: () => number; send?: typeof sendZernioContent } = {}): Promise<DeliveryOutcome> {
  const now = options.now ?? Date.now;
  const { data, error } = await db.rpc("whatsapp_zernio_claim", {
    p_key: target.key, p_phone: target.phone, p_conversation_id: target.conversationId, p_inbound_at: target.sentAt ?? null,
  });
  if (error || !data) throw new Error("Bot claim unavailable");
  const claim = data as { outcome: string; lease?: string; replies?: ZernioContent[] };
  if (claim.outcome === "busy") throw new Error("Bot turn busy");
  if (claim.outcome === "sent") return "duplicate";
  if (["limited", "ignored", "failed"].includes(claim.outcome)) return claim.outcome as DeliveryOutcome;
  if (!["new", "ready"].includes(claim.outcome) || !claim.lease) throw new Error("Invalid bot claim");
  const lease = claim.lease;
  let replies: ZernioContent[];
  if (claim.outcome === "new") {
    const turn = await build();
    const prepared = await db.rpc("whatsapp_zernio_prepare", { p_key: target.key, p_lease: lease, p_replies: turn.replies, p_menu: turn.menu });
    if (prepared.error || prepared.data !== true) throw new Error("Bot response unavailable");
    replies = turn.replies;
  } else {
    if (!Array.isArray(claim.replies)) throw new Error("Invalid prepared response");
    replies = claim.replies;
  }
  try {
    for (let i = 0; i < replies.length; i++) {
      // Recheck even on retry and between messages, including the exact 24 h boundary.
      const { data: chat, error: chatError } = await db.from("whatsapp_bot_chats")
        .select("zernio_last_inbound_at, zernio_conversation_id").eq("phone", target.phone).maybeSingle();
      if (chatError) throw new Error("Bot window unavailable");
      if (!chat || chat.zernio_conversation_id !== target.conversationId || !serviceWindowOpen(chat.zernio_last_inbound_at, now())) {
        const stopped = await db.from("whatsapp_zernio_deliveries").update({ status: "failed" }).eq("key", target.key).eq("lease", lease);
        if (stopped.error) throw new Error("Bot delivery unavailable");
        return "ignored";
      }
      await (options.send ?? sendZernioContent)(config, target.conversationId, replies[i], `${target.key}:${i}`);
    }
    const sent = await db.from("whatsapp_zernio_deliveries").update({ status: "sent" }).eq("key", target.key).eq("lease", lease);
    if (sent.error) throw new Error("Bot delivery acknowledgement unavailable");
    return "sent";
  } catch {
    // Release only the delivery lease, keeping the exact bodies and provider keys.
    await db.from("whatsapp_zernio_deliveries").update({ lease_until: new Date(0).toISOString() }).eq("key", target.key).eq("lease", lease);
    throw new Error("Bot delivery pending");
  }
}
