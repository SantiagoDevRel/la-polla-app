import "server-only";
import { PHONE_RE } from "@/lib/whatsapp-player/config";

export interface ZernioBotConfig {
  accountId: string;
  apiKey: string;
  allowedPhones: ReadonlySet<string> | null;
}

export function getZernioBotConfig(env: Record<string, string | undefined> = process.env): ZernioBotConfig | null {
  if (env.WHATSAPP_ZERNIO_BOT_ENABLED !== "true") return null;
  const accountId = env.ZERNIO_WHATSAPP_ACCOUNT_ID;
  const apiKey = env.ZERNIO_API_KEY;
  if (!accountId || !/^[a-f0-9]{24}$/.test(accountId) || !apiKey) return null;
  const raw = env.WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES?.trim();
  // A configured but malformed allowlist fails closed, never opens the bot.
  const allowedPhones = raw ? new Set(raw.split(",").map(p => p.trim()).filter(p => PHONE_RE.test(p))) : null;
  return { accountId, apiKey, allowedPhones };
}

export function zernioPhoneAllowed(config: ZernioBotConfig, phone: string): boolean {
  return PHONE_RE.test(phone) && (!config.allowedPhones || config.allowedPhones.has(phone));
}

export const SERVICE_WINDOW_MS = 24 * 60 * 60_000;
export function serviceWindowOpen(lastInbound: string | null, now = Date.now()): boolean {
  const elapsed = now - Date.parse(lastInbound ?? "");
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < SERVICE_WINDOW_MS;
}
