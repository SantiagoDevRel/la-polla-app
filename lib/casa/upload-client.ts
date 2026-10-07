"use client";
import { CASA_HEADERS } from "./contract";

export async function fileDigest(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

const CONNECTION_MESSAGE = "No pudimos confirmar el envío por una interrupción de conexión. Reintenta con el mismo comprobante.";

export function casaConnectionError() {
  return Object.assign(new Error(CONNECTION_MESSAGE), { code: "REQUEST_UNCERTAIN" });
}

export async function casaPost(url: string, body: unknown, options: {
  /** Enable only for operations protected by the same request/attempt ID. */
  retrySafe?: boolean;
  onRetry?: () => void;
} = {}) {
  const payload = JSON.stringify(body);
  const attempts = options.retrySafe ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers: CASA_HEADERS, body: payload, signal: controller.signal, cache: "no-store" });
      } catch { throw casaConnectionError(); }
      let data;
      try { data = await res.json(); } catch { throw casaConnectionError(); }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw casaConnectionError();
      if (!res.ok) {
        // A transient gateway failure can follow a committed operation. Keep
        // its identity when retrying; business errors need the user's action.
        if (!data.code && [408, 429, 500, 502, 503, 504].includes(res.status)) throw casaConnectionError();
        throw Object.assign(new Error(data.error ?? "No se pudo completar la operación."), { code: data.code, status: res.status });
      }
      if (data.ok !== true || data.error) throw casaConnectionError();
      return data;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "REQUEST_UNCERTAIN" || attempt === attempts - 1) throw cause;
      options.onRetry?.();
    } finally { clearTimeout(timeout); }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw casaConnectionError();
}

export async function uploadSignedFile(upload: { bucket: string; path: string; token: string | null }, file: Blob) {
  if (upload.token === null) return null;
  // The signed token already authorizes this immutable path. A browser auth
  // refresh must not block an upload that the server has already authorized.
  const path = [upload.bucket, ...upload.path.split("/")].map(encodeURIComponent).join("/");
  const url = new URL(`/storage/v1/object/upload/sign/${path}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.searchParams.set("token", upload.token);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, {
      method: "PUT", body: file, signal: controller.signal, credentials: "omit", cache: "no-store",
      headers: { "Content-Type": file.type, "Cache-Control": "max-age=3600", "x-upsert": "false" },
    });
    // Confirmation checks the actual bytes even after a timeout or a duplicate
    // response; neither outcome authorizes an overwrite or a new inscription.
    return response.ok ? null : casaConnectionError();
  } catch { return casaConnectionError(); }
  finally { clearTimeout(timeout); }
}
