import "server-only";
import { createHash, createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, toE164 } from "@/lib/auth/phone";
import { zernioIncomingMessage } from "@/lib/whatsapp/zernio-preferences";

const TTL_MS = 10 * 60_000;
const ORIGIN = "https://lapollacolombiana.com";
export const WHATSAPP_LINK_ACTION = "/api/auth/wa-magic";
export function validWhatsAppToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function whatsappTokenHash(token: string): string {
  return `wa2:${createHash("sha256").update(token).digest("hex")}`;
}

function config() {
  const accountId = process.env.ZERNIO_WHATSAPP_ACCOUNT_ID;
  const apiKey = process.env.ZERNIO_API_KEY;
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  const number = toE164(process.env.WHATSAPP_LOGIN_NUMBER);
  const enabled = process.env.WHATSAPP_LOGIN_ENABLED === "true";
  const testPhone = toE164(process.env.WHATSAPP_LOGIN_TEST_PHONE);
  if (!accountId || !/^[a-f0-9]{24}$/.test(accountId) || !apiKey || !secret || !number || (!enabled && !testPhone)) return null;
  return { accountId, apiKey, secret, number, enabled, testPhone };
}
export function whatsappLoginAllowed(phone: string): boolean {
  const c = config();
  return Boolean(c && (c.enabled || c.testPhone === toE164(phone)));
}
export function getWhatsAppLoginHref(): string | null {
  const c = config();
  return c?.enabled ? `https://wa.me/${normalizePhone(c.number)}?text=${encodeURIComponent("dame el link para entrar a la polla")}` : null;
}

/** Call only after the Zernio webhook's raw-body HMAC has been checked. */
export async function replyWithWhatsAppLogin(payload: unknown): Promise<"ignored" | "sent" | "limited"> {
  const c = config();
  if (!c) return "ignored";
  const parsed = zernioIncomingMessage.safeParse(payload);
  if (!parsed.success || parsed.data.account.accountId !== c.accountId) return "ignored";
  const { message, conversation, id } = parsed.data;
  if (message.metadata?.standby) return "ignored";
  const phone = toE164(message.sender.phoneNumber ?? (!message.sender.businessScopedUserId ? message.sender.id : undefined));
  const age = Date.now() - Date.parse(message.sentAt);
  if (!phone || !whatsappLoginAllowed(phone) || age < -5 * 60_000 || age >= TTL_MS) return "ignored";
  // Stable across webhook retries, unpredictable without our private signing secret.
  const token = createHmac("sha256", c.secret)
    .update(JSON.stringify(["wa-login-v2", c.accountId, id, phone])).digest("hex");
  const hash = whatsappTokenHash(token);
  const db = createAdminClient();
  const { data: issued, error } = await db.rpc("wa_issue_login_link", {
    p_token_hash: hash, p_phone: normalizePhone(phone),
    p_expires_at: new Date(Date.parse(message.sentAt) + TTL_MS).toISOString(),
  });
  if (error) throw new Error("WhatsApp login reservation unavailable");
  if (issued === "limited") return "limited";
  if (issued !== "issued" && issued !== "retry") return "ignored";
  const url = `${ORIGIN}/login/whatsapp?t=${token}`;
  const response = await fetch(`https://zernio.com/api/v1/inbox/conversations/${conversation.id}/messages`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500),
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `wa-login-${hash.slice(4)}` },
    body: JSON.stringify({ accountId: c.accountId, interactive: {
      type: "cta_url",
      body: { text: "Haz clic aquí para entrar a La Polla.\nEl enlace es personal y vence en 10 minutos. No lo compartas." },
      action: { name: "cta_url", parameters: { display_text: "Haz clic para entrar", url } },
    } }),
  });
  if (!response.ok || (await response.json()).success !== true) throw new Error("WhatsApp login reply pending");
  return "sent";
}

/** Read only: link previews and crawlers must never consume a login. */
export async function peekWhatsAppLogin(token: unknown) {
  if (!config() || !validWhatsAppToken(token)) return null;
  const { data, error } = await createAdminClient().from("wa_magic_tokens")
    .select("phone_number, expires_at, consumed_at").eq("token", whatsappTokenHash(token)).maybeSingle();
  if (error) throw new Error("WhatsApp login lookup unavailable");
  if (!data || data.consumed_at || Date.parse(data.expires_at) <= Date.now() || !whatsappLoginAllowed(data.phone_number)) return null;
  return data as { phone_number: string; expires_at: string; consumed_at: null };
}
