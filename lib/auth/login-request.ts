/** Bound login waits, reject redirected/invalid responses, and never cache them. */
export async function loginRequest(endpoint: string, body: object, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), credentials: "include", cache: "no-store",
      redirect: "error", signal: controller.signal,
    });
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid login response");
    return { ok: response.ok, status: response.status, body: value as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

/** Privacy modes can block storage; persistence must never block signing in. */
export function readLoginStorage(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

export function writeLoginStorage(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* The current page continues without refresh persistence. */ }
}
