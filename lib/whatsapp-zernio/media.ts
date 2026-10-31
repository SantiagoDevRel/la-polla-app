import "server-only";
import type { ProofContentType } from "@/lib/casa/proof-server";

// Migration 176 stages at most 4,200,000 base64 characters. Keep both transports compatible.
export const MAX_ZERNIO_PROOF_BYTES = 3 * 1024 * 1024;
export type MediaResult = { ok: true; bytes: Buffer; mime: ProofContentType } | { ok: false; reason: "unsupported" | "too_large" | "download" };

/** The documented WhatsApp attachment endpoint proxies Meta bytes with Zernio authentication. */
export function trustedMediaUrl(raw: string, accountId: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.origin !== "https://zernio.com" || url.username || url.password || url.hash
      || !/^\/api\/v1\/whatsapp\/media\/[0-9]+$/.test(url.pathname)) return null;
    // Pin account scope ourselves; never forward arbitrary query fields or credentials.
    if ([...url.searchParams.keys()].some(k => k !== "accountId")) return null;
    if (url.searchParams.has("accountId") && url.searchParams.get("accountId") !== accountId) return null;
    url.searchParams.set("accountId", accountId);
    return url;
  } catch { return null; }
}

export function imageMime(bytes: Buffer): ProofContentType | null {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function downloadZernioProof(attachment: { type: string; url?: string | null; mimeType?: string | null }, config: { apiKey: string; accountId: string }, fetcher: typeof fetch = fetch): Promise<MediaResult> {
  if (!["image", "document", "file"].includes(attachment.type) || attachment.mimeType === "application/pdf") return { ok: false, reason: "unsupported" };
  const url = trustedMediaUrl(attachment.url ?? "", config.accountId);
  if (!url) return { ok: false, reason: "download" };
  try {
    const response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${config.apiKey}` } });
    if (!response.ok || !response.body) return { ok: false, reason: "download" };
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_ZERNIO_PROOF_BYTES) { await response.body.cancel(); return { ok: false, reason: "too_large" }; }
    const mimeHeader = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const allowedMime = (mime?: string | null) => !mime || ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/octet-stream"].includes(mime.toLowerCase());
    if (!allowedMime(mimeHeader) || !allowedMime(attachment.mimeType)) { await response.body.cancel(); return { ok: false, reason: "unsupported" }; }
    const reader = response.body.getReader();
    const parts: Buffer[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ZERNIO_PROOF_BYTES) { await reader.cancel(); return { ok: false, reason: "too_large" }; }
      parts.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(parts);
    // Actual bytes win over filenames or an incorrect image MIME (PNG named .jpg).
    const mime = imageMime(bytes);
    return mime ? { ok: true, bytes, mime } : { ok: false, reason: "unsupported" };
  } catch { return { ok: false, reason: "download" }; }
}
