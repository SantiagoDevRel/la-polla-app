"use client";
import { createClient } from "@/lib/supabase/client";
import { CASA_HEADERS } from "./contract";

export async function fileDigest(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function casaPost(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: CASA_HEADERS, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: "No se pudo leer la respuesta. Puedes reintentar." }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? "No se pudo completar la operación."), { code: data.code });
  return data;
}

export async function uploadSignedFile(upload: { bucket: string; path: string; token: string | null }, file: File) {
  if (upload.token === null) return null;
  // Never overwrite a previous proof. If a retry finds an existing file, the
  // confirmation endpoint verifies its digest before accepting that result.
  const { error } = await createClient().storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, {
    contentType: file.type, upsert: false,
  });
  return error;
}
