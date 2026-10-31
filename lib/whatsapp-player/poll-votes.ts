import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneAllowed, type WhatsAppBotConfig } from "./config";
import { MAX_MESSAGE_AGE_S } from "./inbound";

export const pollSentSchema = z.object({
  pollMessageId: z.string().min(1).max(200),
  chatId: z.string().regex(/^[1-9][0-9]{0,39}@(c\.us|lid)$/),
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
});
const voteSchema = z.object({
  event: z.literal("poll.vote"),
  data: z.object({
    pollMessageId: z.string().min(1).max(200),
    chatId: z.string().regex(/^[1-9][0-9]{0,39}@(c\.us|lid)$/),
    voterId: z.string().regex(/^[1-9][0-9]{0,39}@(c\.us|lid)$/),
    selectedOptions: z.array(z.string().min(1).max(100)).length(1),
    timestamp: z.number().int().positive(), timestampMs: z.number().int().positive().optional(),
    // Added by the trusted relay after checking the session's own identity.
    selfChecked: z.literal(true), fromMe: z.literal(false),
  }),
});
export interface MappedPollVote {
  phone: string; chatId: string; callback: string; nonce: string; messageId: string;
}

/** No account is ever looked up using voterId, pollName or user supplied text. */
export async function claimPollVote(payload: unknown, db: SupabaseClient, config: WhatsAppBotConfig, now: number): Promise<MappedPollVote | null> {
  const parsed = voteSchema.safeParse(payload);
  if (!parsed.success) return null;
  const vote = parsed.data.data;
  const age = Math.floor(now / 1000) - vote.timestamp;
  if (age > MAX_MESSAGE_AGE_S || age < -300) return null;
  const { data: mapping, error } = await db.from("whatsapp_bot_polls")
    .select("phone").eq("poll_message_id", vote.pollMessageId).maybeSingle();
  if (error) throw new Error(`poll lookup: ${error.code}`);
  const phone = (mapping as { phone: string } | null)?.phone;
  if (!phone || !phoneAllowed(config, phone)) return null;
  const key = createHash("sha256").update(JSON.stringify([vote.pollMessageId, vote.selectedOptions[0], vote.timestampMs ?? vote.timestamp * 1000])).digest("hex");
  // Atomic: lock poll + chat, check the nonce/expiry, accept only the first vote.
  const { data, error: claimError } = await db.rpc("whatsapp_bot_claim_poll_vote", {
    p_poll_message_id: vote.pollMessageId, p_chat_id: vote.chatId,
    p_option: vote.selectedOptions[0], p_vote_key: key,
  });
  if (claimError) throw new Error(`poll claim: ${claimError.code}`);
  const result = (data as Array<{ phone: string; chat_id: string; callback: string; menu_nonce: string }> | null)?.[0];
  if (!result || result.phone !== phone) return null;
  return { phone: result.phone, chatId: result.chat_id, callback: result.callback, nonce: result.menu_nonce, messageId: `poll-${key}` };
}
