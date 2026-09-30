import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { toE164, normalizePhone } from "@/lib/auth/phone";
import { isOptInText, isOptOutText } from "./avisos";

export function verifyZernioSignature(raw: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", secret).update(raw).digest());
}

export const zernioIncomingMessage = z.object({
  id: z.string().min(1).max(200), event: z.literal("message.received"),
  account: z.object({ accountId: z.string().regex(/^[a-f0-9]{24}$/) }),
  conversation: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }),
  message: z.object({
    platform: z.literal("whatsapp"), direction: z.literal("incoming"),
    text: z.string().nullable().optional(), sentAt: z.iso.datetime({ offset: true }),
    sender: z.object({ phoneNumber: z.string().nullable().optional(), id: z.string().min(1).max(200), businessScopedUserId: z.string().min(1).max(200).optional() }),
    metadata: z.object({ standby: z.boolean().optional() }).nullable().optional(),
  }),
  // Zernio puts WhatsApp metadata on the event, outside message.
  metadata: z.object({
    standby: z.boolean().optional(),
    contactsOrigin: z.enum(["contact_request", "other"]).optional(),
    contacts: z.array(z.object({
      phones: z.array(z.object({ phone: z.string().optional(), wa_id: z.string().optional() })).optional(),
    })).optional(),
  }).nullable().optional(),
});

/** Only a provider-identified sender or Meta's own-number share proves identity. */
export function zernioVerifiedPhone(event: z.infer<typeof zernioIncomingMessage>): string | null {
  const sender = event.message.sender;
  const phone = toE164(sender.phoneNumber ?? (!sender.businessScopedUserId ? sender.id : undefined));
  if (phone) return phone;
  const metadata = event.metadata;
  if (metadata?.contactsOrigin !== "contact_request" || metadata.contacts?.length !== 1) return null;
  const phones = metadata.contacts[0].phones;
  // A manually shared address-book card, text, username or BSUID is never a phone.
  if (phones?.length !== 1) return null;
  const ownNumber = toE164(phones[0].wa_id);
  if (!ownNumber || (phones[0].phone && toE164(phones[0].phone) !== ownNumber)) return null;
  return ownNumber;
}

export function parsePreferenceEvent(payload: unknown, accountId: string | undefined) {
  const parsed = zernioIncomingMessage.safeParse(payload);
  if (!parsed.success || !accountId || parsed.data.account.accountId !== accountId) return null;
  const { message } = parsed.data;
  if (!message.text || (!isOptOutText(message.text) && !isOptInText(message.text))) return null;
  // phoneNumber is authoritative. Do not mistake a BSUID for a phone number.
  const phone = zernioVerifiedPhone(parsed.data);
  if (!phone) throw new Error("Missing phone identity for preference");
  if (Date.parse(message.sentAt) > Date.now() + 5 * 60_000) throw new Error("Future message timestamp");
  return { phone: normalizePhone(phone), enabled: isOptInText(message.text),
    eventId: parsed.data.id, occurredAt: message.sentAt, conversationId: parsed.data.conversation.id };
}

export async function confirmPreference(conversationId: string, enabled: boolean, eventId: string): Promise<boolean> {
  if (!process.env.ZERNIO_API_KEY || !process.env.ZERNIO_WHATSAPP_ACCOUNT_ID) return false;
  try {
    const r = await fetch(`https://zernio.com/api/v1/inbox/conversations/${conversationId}/messages`, {
      method: "POST", signal: AbortSignal.timeout(2000), cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json",
        "Idempotency-Key": `wa-preference-${createHmac("sha256", "reply-v1").update(eventId).digest("hex")}` },
      body: JSON.stringify({ accountId: process.env.ZERNIO_WHATSAPP_ACCOUNT_ID, message: enabled
        ? "Has activado los avisos de pollas por WhatsApp. Puedes cancelarlos cuando quieras respondiendo BAJA o desde Perfil."
        : "No recibirás más avisos de pollas por WhatsApp. Tu cuenta sigue activa y podrás solicitar códigos de acceso. Para volver a recibir avisos, responde ALTA o actívalos en Perfil." }),
    });
    return r.ok && (await r.json()).success === true;
  } catch { return false; }
}
