import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const DRAW_EVIDENCE_BUCKET = "casa-draw-evidence";

export async function signedCasaUpload(bucket: string, path: string) {
  const storage = createAdminClient().storage.from(bucket);
  const { data, error } = await storage.createSignedUploadUrl(path, { upsert: false });
  if (error || !data) {
    // Storage rejects signing an immutable path that is already present.
    // Resume verification instead; existence alone never confirms a proof.
    const existing = await storage.info(path);
    if (!existing.error && existing.data) return { bucket, path, token: null };
    throw new Error("No se pudo preparar la carga. Puedes reintentar.");
  }
  return { bucket, path: data.path, token: data.token };
}

function matchesSignature(head: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (mime === "image/png") return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp") return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
  if (mime === "video/webm") return head.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (mime === "video/mp4" || mime === "video/quicktime") return head.toString("ascii", 4, 8) === "ftyp";
  return false;
}

/** Read only the server-selected immutable path; never trust a client URL or hash claim. */
export async function verifyCasaUpload(bucket: string, path: string, expected: {
  content_sha256: string; content_type: string; content_bytes: number;
}) {
  const limit = bucket === DRAW_EVIDENCE_BUCKET ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
  if (!expected.content_sha256 || expected.content_bytes < 1 || expected.content_bytes > limit) throw new Error("Metadatos de carga inválidos.");
  const { data, error } = await createAdminClient().storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data) throw new Error("La carga aún no está disponible. Intenta confirmar de nuevo.");
  const response = await fetch(data.signedUrl, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  if (!response.ok || !response.body) throw new Error("La carga aún no está completa. Intenta confirmar de nuevo.");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let bytes = 0;
  let head = Buffer.alloc(0);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > expected.content_bytes || bytes > limit) throw Object.assign(new Error("El archivo supera el tamaño registrado."), { code: "UPLOAD_MISMATCH" });
      if (head.length < 16) head = Buffer.concat([head, Buffer.from(chunk.value).subarray(0, 16 - head.length)]);
      hash.update(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (bytes !== expected.content_bytes || hash.digest("hex") !== expected.content_sha256 || !matchesSignature(head, expected.content_type)) {
    throw Object.assign(new Error("El archivo no coincide con el comprobante o la evidencia registrados. Selecciona el archivo original."), { code: "UPLOAD_MISMATCH" });
  }
}
