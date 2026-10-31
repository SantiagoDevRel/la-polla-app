import "server-only";
import { createHash } from "node:crypto";
import type { ZernioBotConfig } from "./config";
import type { ZernioContent } from "./format";

/** No templates and no recipient lookup: only a verified inbound conversation. */
export async function sendZernioContent(config: ZernioBotConfig, conversationId: string, content: ZernioContent, key: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!/^[a-f0-9]{24}$/.test(conversationId)) throw new Error("Invalid conversation");
  const response = await fetcher(`https://zernio.com/api/v1/inbox/conversations/${conversationId}/messages`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500),
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json",
      "Idempotency-Key": `lp-z-${createHash("sha256").update(key).digest("hex")}` },
    body: JSON.stringify({ accountId: config.accountId, ...content }),
  });
  if (!response.ok || (await response.json()).success !== true) throw new Error("Zernio reply pending");
}
