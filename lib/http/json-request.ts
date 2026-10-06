/** User-facing requests must confirm JSON, not a redirect or an HTTP status alone. */
export type JsonRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "auth" | "rejected" | "uncertain"; error: string; status?: number; code?: string };

export async function requestJson<T>(
  endpoint: string,
  init: RequestInit,
  validate: (value: unknown) => value is T,
  timeoutMs = 15_000,
): Promise<JsonRequestResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { ...init, cache: "no-store", signal: controller.signal, redirect: "error" });
    if (response.status === 401) return { ok: false, kind: "auth", status: 401, error: "Tu sesión venció. Ingresa de nuevo; conservamos tus cambios." };
    let data: unknown;
    try { data = await response.json(); }
    catch {
      if (!response.ok && response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
        return { ok: false, kind: "rejected", status: response.status, error: "No se pudo completar la solicitud. Revisa tus cambios e intenta de nuevo." };
      }
      return { ok: false, kind: "uncertain", status: response.status, error: "No pudimos confirmar el resultado. Conservamos tus cambios." };
    }
    if (!response.ok) {
      const error = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error : "No se pudo completar la solicitud.";
      const code = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string" ? data.code : undefined;
      return { ok: false, kind: response.status >= 500 || [408, 429].includes(response.status) ? "uncertain" : "rejected", error, status: response.status, ...(code ? { code } : {}) };
    }
    if (!validate(data)) return { ok: false, kind: "uncertain", error: "No pudimos confirmar el resultado. Conservamos tus cambios." };
    return { ok: true, data };
  } catch {
    return { ok: false, kind: "uncertain", error: "No pudimos confirmar el resultado. Conservamos tus cambios." };
  } finally {
    clearTimeout(timer);
  }
}
