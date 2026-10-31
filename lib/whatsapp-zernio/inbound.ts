import { z } from "zod";
import { createHash } from "node:crypto";
import { zernioIncomingMessage, zernioVerifiedPhone } from "@/lib/whatsapp/zernio-preferences";
import { zernioPhoneAllowed, type ZernioBotConfig } from "./config";

const interactiveMetadata = z.object({
  interactiveType: z.string().optional(), interactiveId: z.string().max(200).optional(),
  quickReplyPayload: z.string().max(200).optional(),
}).nullish();
const schema = zernioIncomingMessage.extend({
  metadata: zernioIncomingMessage.shape.metadata.unwrap().unwrap().extend({
    interactiveType: z.string().optional(), interactiveId: z.string().max(200).optional(),
    quickReplyPayload: z.string().max(200).optional(),
    flowResponseJson: z.string().max(20_000).optional(), flowResponseData: z.record(z.string(), z.unknown()).optional(),
  }).nullish(),
  interactiveMetadata,
  message: zernioIncomingMessage.shape.message.extend({
    id: z.string().max(200).optional(), platformMessageId: z.string().max(200).optional(),
    interactiveMetadata,
    attachments: z.array(z.object({
      type: z.string().max(40), url: z.string().max(2048).nullish(), mimeType: z.string().max(100).nullish(),
    })).max(10).nullish(),
  }),
});

export interface ZernioInbound {
  key: string;
  phone: string;
  conversationId: string;
  sentAt: string;
  text: string | null;
  selection: string | null;
  attachment: { type: string; url?: string | null; mimeType?: string | null } | null;
  /** Submitted WhatsApp Flow (nfm_reply). Content is untrusted input, never identity. */
  flowResponse?: unknown;
}

/** Caller has already verified the raw-body HMAC. No text/contact/caption identity. */
export function parseZernioInbound(payload: unknown, config: ZernioBotConfig, now = Date.now()): ZernioInbound | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.account.accountId !== config.accountId || event.metadata?.standby || event.message.metadata?.standby) return null;
  const age = now - Date.parse(event.message.sentAt);
  if (age < -300_000 || age >= 600_000) return null;
  const verified = zernioVerifiedPhone(event);
  if (!verified) return null;
  const phone = verified.replace(/^\+/, "");
  if (!zernioPhoneAllowed(config, phone)) return null;
  const meta = event.metadata;
  const selection = (meta?.interactiveType === "button_reply" || meta?.interactiveType === "list_reply" ? meta.interactiveId : null)
    ?? event.interactiveMetadata?.quickReplyPayload ?? event.message.interactiveMetadata?.quickReplyPayload ?? meta?.quickReplyPayload ?? null;
  const flowResponse = meta?.flowResponseData ?? meta?.flowResponseJson ?? null;
  const attachment = flowResponse ? null : event.message.attachments?.[0] ?? null;
  const text = !attachment && !selection && !flowResponse ? event.message.text?.trim().slice(0, 500) || null : null;
  // Provider message id survives a redelivery with a different webhook envelope id.
  const providerId = event.message.platformMessageId || event.message.id || event.id;
  return { key: `z:${createHash("sha256").update(JSON.stringify([config.accountId, providerId])).digest("hex")}`,
    phone, conversationId: event.conversation.id, sentAt: event.message.sentAt, text, selection, attachment, flowResponse };
}
